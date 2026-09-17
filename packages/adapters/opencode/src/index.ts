import type { Agent, CredentialRouter, JsonLine, RuntimeAdapter, RuntimeEvent, RuntimeHandle, Task } from "@ai-office/core";
import { spawnRuntimeProcess } from "@ai-office/core/node";

const PROVIDER = "opencode-native";

/**
 * Talks to the real `opencode` CLI in headless mode. Verified against
 * opencode 1.18.31: `run <message> --format json --dir <path> --auto`
 * emits newline-delimited JSON objects shaped like
 * {type: "step_start"|"text"|"tool_use"|"step_finish"|"error", ..., part?: {...}}.
 * Like the Claude Code adapter, that shape is not a stable public contract,
 * so every line is parsed defensively and anything unrecognized becomes a
 * plain "log" event instead of crashing the adapter.
 *
 * Model is hardcoded to a model confirmed fast and reliable in this
 * environment (`opencode/nemotron-3.5-lightning-free`) — see README for how
 * to point this at a different provider/model. `opencode/muse-spark-1.3-
 * contributor-free` (this account's CLI default) also works but was
 * observed taking 7+ minutes on a simple single-file write during manual
 * verification, which makes it a poor fit for a live demo.
 */
const DEFAULT_MODEL = "opencode/nemotron-3.5-lightning-free";

export class OpenCodeAdapter implements RuntimeAdapter {
  constructor(private readonly credentials: CredentialRouter) {}

  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // v0.7: OpenCode authenticates entirely through its own login-session
    // store, not an env var (see README "Setting up OpenCode"), so there's
    // nothing to inject here — but the availability check still goes through
    // CredentialRouter (packages/core/src/credentials) like every other
    // provider, so the startup log/UI status pill can show it consistently.
    // Not used to gate dispatch: a false negative here must never stop the
    // CLI from actually trying, since it manages its own login independently.
    this.credentials.resolve(PROVIDER);

    return spawnRuntimeProcess({
      command: "opencode",
      args: [
        "run",
        task.description,
        "--format",
        "json",
        "--dir",
        task.workspacePath,
        "--model",
        agent.model ?? DEFAULT_MODEL,
        // Same story as Claude Code's --permission-mode acceptEdits: a
        // headless worker with nobody present to click "allow" needs this
        // to make any real progress. Confirmed by hand that this actually
        // lets the CLI write files, not just run without erroring.
        "--auto",
      ],
      cwd: task.workspacePath,
      env,
      mapLine: mapOpenCodeLine,
    });
  }
}

function mapOpenCodeLine(line: JsonLine): RuntimeEvent {
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
  const part = obj.part && typeof obj.part === "object" ? (obj.part as Record<string, unknown>) : undefined;

  switch (obj.type) {
    case "step_start":
      return { type: "log", text: "step started" };
    case "step_finish":
      return { type: "log", text: "step finished" };
    case "text": {
      const text = typeof part?.text === "string" ? part.text : "thinking...";
      return { type: "progress", text };
    }
    case "tool_use": {
      const toolName = typeof part?.tool === "string" ? part.tool : "tool";
      const state = part?.state && typeof part.state === "object" ? (part.state as Record<string, unknown>) : {};
      const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {};
      const path = input.filePath ?? input.path;
      const hint = path ?? input.command ?? "";
      const rendered = path ? String(path) : truncate(String(hint), 80);
      return { type: "progress", text: `Using ${toolName}${hint ? `: ${rendered}` : ""}` };
    }
    case "error": {
      const error = obj.error && typeof obj.error === "object" ? (obj.error as Record<string, unknown>) : {};
      const data = error.data && typeof error.data === "object" ? (error.data as Record<string, unknown>) : {};
      const text = typeof data.message === "string" ? data.message : String(error.name ?? "unknown error");
      return { type: "error", text };
    }
    default:
      return { type: "log", text: `${String(obj.type)} event` };
  }
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
