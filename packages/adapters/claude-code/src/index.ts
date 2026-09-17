import type { Agent, CredentialRouter, JsonLine, RuntimeAdapter, RuntimeEvent, RuntimeHandle, Task } from "@ai-office/core";
import { EnvVarCredentialSource, spawnRuntimeProcess } from "@ai-office/core/node";

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
  constructor(private readonly credentials: CredentialRouter) {}

  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;

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
    if (agent.model) env.ANTHROPIC_MODEL = agent.model;

    return spawnRuntimeProcess({
      command: "claude",
      args: [
        "-p",
        task.description,
        "--output-format",
        "stream-json",
        "--verbose",
        // Headless workers act on a single directory the operator supplied
        // via the task form; auto-accepting file edits (but not e.g.
        // arbitrary Bash) is what lets them actually make progress without
        // a human present to click "allow" on every write.
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
