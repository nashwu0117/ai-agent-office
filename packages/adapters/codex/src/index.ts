import type { Agent, CredentialRouter, JsonLine, RuntimeAdapter, RuntimeEvent, RuntimeHandle, Task } from "@ai-office/core";
import { spawnRuntimeProcess } from "@ai-office/core/node";

const PROVIDER = "codex-native";

/**
 * v0.15: talks to the real `codex` CLI (OpenAI Codex, a genuinely different
 * runtime from `claude` — see the user request that prompted this: they
 * specifically flagged it as not running "on top of" Claude Code). Verified
 * against codex-cli 0.154.0: `exec <prompt> --json --sandbox workspace-write
 * -C <path>` emits newline-delimited JSON objects. Observed shapes, by hand,
 * against two real runs (one that wrote a file successfully, one where the
 * agent ran a deliberately failing shell command):
 *   {type:"thread.started",thread_id}
 *   {type:"turn.started"}
 *   {type:"item.started"|"item.completed", item:{id,type,...}}
 *     item.type "agent_message" -> {text}
 *     item.type "file_change" -> {changes:[{path,kind}], status}
 *     item.type "command_execution" -> {command,aggregated_output,exit_code,status}
 *   {type:"turn.completed", usage:{...}}
 * Like every other adapter here, this is not a stable public contract, so
 * every line is parsed defensively and anything unrecognized becomes a plain
 * "log" event instead of crashing the adapter. Whether the run actually
 * succeeded is judged by the process exit code (spawnRuntimeProcess/
 * Orchestrator), same as claude/opencode — codex exec exits 0 even when the
 * agent's own shell commands failed along the way, it just narrates that in
 * its own agent_message/command_execution items.
 *
 * Authenticates via its own `codex login` session (this environment: a
 * ChatGPT subscription, per `codex doctor`'s `auth file ~/.codex/auth.json`)
 * — nothing to inject into env, same story as OpenCodeAdapter.
 */
export class CodexAdapter implements RuntimeAdapter {
  constructor(private readonly credentials: CredentialRouter) {}

  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Not used to gate dispatch — a resolve() miss must never stop the CLI
    // from actually trying, since it manages its own login independently
    // (same reasoning as OpenCodeAdapter's credentials.resolve call).
    this.credentials.resolve(PROVIDER);

    return spawnRuntimeProcess({
      command: "codex",
      args: [
        "exec",
        task.description,
        "--json",
        "--sandbox",
        "workspace-write",
        "-C",
        task.workspacePath,
        ...(agent.model ? ["--model", agent.model] : []),
      ],
      cwd: task.workspacePath,
      env,
      mapLine: mapCodexLine,
    });
  }
}

function mapCodexLine(line: JsonLine): RuntimeEvent {
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
    case "thread.started":
      return { type: "log", text: "session started" };
    case "turn.started":
      return { type: "log", text: "turn started" };
    case "turn.completed":
      return { type: "done", text: "turn completed" };
    case "item.started":
    case "item.completed": {
      const item = obj.item && typeof obj.item === "object" ? (obj.item as Record<string, unknown>) : {};
      return messageFromItem(item, obj.type === "item.completed");
    }
    default:
      return { type: "log", text: `${String(obj.type)} event` };
  }
}

function messageFromItem(item: Record<string, unknown>, completed: boolean): { type: RuntimeEvent["type"]; text: string } {
  switch (item.type) {
    case "agent_message": {
      const text = typeof item.text === "string" ? item.text : "";
      return { type: "progress", text: truncate(text) };
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const paths = changes
        .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).path : undefined))
        .filter((p): p is string => typeof p === "string");
      return { type: "progress", text: `${completed ? "Edited" : "Editing"}: ${paths.join(", ") || "file"}` };
    }
    case "command_execution": {
      const command = typeof item.command === "string" ? item.command : "command";
      if (completed && item.status === "failed") {
        return { type: "error", text: `Command failed: ${truncate(command, 120)}` };
      }
      return { type: "progress", text: `${completed ? "Ran" : "Running"}: ${truncate(command, 120)}` };
    }
    default:
      return { type: "log", text: `${String(item.type ?? "item")} ${completed ? "completed" : "started"}` };
  }
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
