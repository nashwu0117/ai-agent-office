import type {
  Agent,
  BackendProfileRegistry,
  CredentialRouter,
  JsonLine,
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeHandle,
  Task,
} from "@ai-office/core";
import { EnvVarCredentialSource, resolveBackendEnv, spawnRuntimeProcess } from "@ai-office/core/node";

const PROVIDER = "anthropic";

/**
 * Talks to the real `claude` CLI in headless/print mode. Verified against
 * claude-code 2.1.273: `--print --output-format stream-json --verbose`
 * emits newline-delimited JSON objects shaped like
 * {type: "system"|"assistant"|"user"|"result"|"rate_limit_event", ...}.
 * That shape is not a stable public contract, so every line is parsed
 * defensively and anything that doesn't parse (or doesn't match a known
 * shape) is surfaced as a plain "log" event instead of crashing the adapter.
 */
export class ClaudeCodeAdapter implements RuntimeAdapter {
  constructor(
    private readonly credentials: CredentialRouter,
    // v0.8: agents whose backendProfile isn't "official"/unset get their
    // ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN overridden per spawned
    // process instead of resolving the shared CredentialRouter pool below —
    // see docs/cc-switch-research.md for why this is direct env injection
    // rather than going through cc-switch.
    private readonly backendProfiles: BackendProfileRegistry = {},
    // v0.9: base URL of this server's own local format-translation proxy
    // (apps/server/src/proxy-server.ts), e.g. "http://127.0.0.1:43120".
    // A backendProfile-routed agent's spawned process is pointed at
    // `${proxyBaseUrl}/${profileId}/` instead of the real third-party
    // backend directly — the proxy resolves the real base URL/token and,
    // for apiFormat "openai-chat-completions" profiles, translates the
    // request/response. Undefined only in tests that don't exercise a
    // backendProfile-routed agent.
    private readonly proxyBaseUrl?: string
  ) {}

  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;

    // resolveBackendEnv still throws BackendProfileError (caught by
    // Orchestrator.runTask, surfaced as task_failed with
    // backendProfileError: true) before any process is spawned if
    // agent.backendProfile is set but unresolvable — unregistered id, or
    // its real baseUrlEnvVar/authTokenEnvVar aren't set on this server's
    // own process env. Its *return value* (the real backend's base
    // URL/token) is deliberately unused below: as of v0.9 those are read by
    // proxy-server.ts per-request instead, never by the spawned CLI process
    // itself, so a backend switch or an apiFormat change never requires
    // touching this adapter.
    const backendOverride = resolveBackendEnv(agent.backendProfile, this.backendProfiles);
    if (backendOverride) {
      if (!this.proxyBaseUrl) {
        throw new Error(
          `Agent "${agent.id}" has backendProfile "${agent.backendProfile}" but this server's format-translation proxy isn't available.`
        );
      }
      env.ANTHROPIC_BASE_URL = `${this.proxyBaseUrl.replace(/\/$/, "")}/${agent.backendProfile}/`;
      // The CLI still requires a non-empty token to treat the endpoint as
      // authenticated; the proxy ignores it and authenticates to the real
      // backend itself with the credential resolveBackendEnv just verified
      // is present — this value is never sent past the local proxy hop.
      env.ANTHROPIC_AUTH_TOKEN = "ai-office-local-proxy";
      delete env.ANTHROPIC_API_KEY;
    } else {
      // v0.7: routed through CredentialRouter (packages/core/src/credentials)
      // instead of reading ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN directly, so
      // a backup credential added there — or one AnthropicMasterBrain already
      // marked the primary as failed — is picked up here too. A resolve() miss
      // isn't fatal: the CLI falls back to its own `claude auth` login session,
      // exactly as before this existed.
      const source = this.credentials.resolve(PROVIDER);
      if (source instanceof EnvVarCredentialSource) {
        const value = source.readValue();
        if (value) {
          if (source.envVar.includes("AUTH_TOKEN")) env.ANTHROPIC_AUTH_TOKEN = value;
          else env.ANTHROPIC_API_KEY = value;
        }
      }
    }
    if (agent.model) env.ANTHROPIC_MODEL = agent.model;

    return spawnRuntimeProcess({
      command: "claude",
      args: [
        "-p",
        task.description,
        "--output-format",
        "stream-json",
        "--verbose",
        // Headless workers act on the operator-selected workspace. Auto-accept
        // file edits so they can make progress without a human approving each
        // write, while keeping Claude Code's permission checks for other tools.
        "--permission-mode",
        "acceptEdits",
      ],
      cwd: task.workspacePath,
      env,
      mapLine: mapClaudeCodeLine,
    });
  }
}

function mapClaudeCodeLine(line: JsonLine): RuntimeEvent {
  const timestamp = new Date().toISOString();
  if (line.parsed === undefined) {
    return { type: "log", message: line.raw, timestamp };
  }

  const message = messageFromParsedLine(line.parsed);
  return { type: message.type, message: message.text, raw: line.parsed, timestamp };
}

function messageFromParsedLine(parsed: unknown): { type: RuntimeEvent["type"]; text: string } {
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return { type: "log", text: JSON.stringify(parsed) };
  }
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case "system": {
      return { type: "log", text: `session started (${String(obj.subtype ?? "init")})` };
    }
    case "assistant": {
      const content = extractContent(obj);
      return { type: "progress", text: content ?? "thinking..." };
    }
    case "user": {
      const content = extractContent(obj);
      return { type: "log", text: content ? `result: ${truncate(content)}` : "tool result received" };
    }
    case "result": {
      const text = typeof obj.result === "string" ? obj.result : "task finished";
      return { type: "done", text };
    }
    default:
      return { type: "log", text: `${String(obj.type)} event` };
  }
}

function extractContent(obj: Record<string, unknown>): string | undefined {
  const message = obj.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (!Array.isArray(content)) return undefined;

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      const input = block.input && typeof block.input === "object" ? (block.input as Record<string, unknown>) : {};
      const path = input.file_path ?? input.path;
      const hint = path ?? input.command ?? "";
      // File paths are kept whole (the Orchestrator parses them back out of
      // this string for the completion card's filesChanged list); only
      // free-form command text gets truncated for bubble/log readability.
      const rendered = path ? String(path) : truncate(String(hint), 80);
      parts.push(`Using ${block.name}${hint ? `: ${rendered}` : ""}`);
    } else if (block.type === "tool_result" || block.content) {
      const c = block.content;
      if (typeof c === "string") parts.push(truncate(c));
    }
  }
  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
