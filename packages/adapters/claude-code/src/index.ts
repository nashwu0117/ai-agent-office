import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Agent, RuntimeAdapter, RuntimeEvent, RuntimeHandle, Task } from "@ai-office/core";

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
  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (process.env.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (process.env.ANTHROPIC_AUTH_TOKEN) env.ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
    if (agent.model) env.ANTHROPIC_MODEL = agent.model;

    const child = spawn(
      "claude",
      [
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
      {
        cwd: task.workspacePath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    return new ClaudeCodeHandle(child);
  }
}

class ClaudeCodeHandle implements RuntimeHandle {
  private eventCbs: Array<(e: RuntimeEvent) => void> = [];
  private exitCbs: Array<(code: number | null) => void> = [];
  private stderrBuffer = "";

  constructor(private readonly child: ChildProcess) {
    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line: string) => this.handleLine(line));

    child.stderr!.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code !== 0 && this.stderrBuffer.trim()) {
        this.emit({
          type: "error",
          message: this.stderrBuffer.trim(),
          timestamp: new Date().toISOString(),
        });
      }
      for (const cb of this.exitCbs) cb(code);
    });

    child.on("error", (err) => {
      this.emit({ type: "error", message: err.message, timestamp: new Date().toISOString() });
    });
  }

  onEvent(cb: (e: RuntimeEvent) => void): void {
    this.eventCbs.push(cb);
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCbs.push(cb);
  }

  stop(): void {
    if (!this.child.killed) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (!this.child.killed) this.child.kill("SIGKILL");
      }, 3000);
    }
  }

  private emit(event: RuntimeEvent): void {
    for (const cb of this.eventCbs) cb(event);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.emit({ type: "log", message: trimmed, timestamp: new Date().toISOString() });
      return;
    }

    const message = messageFromParsedLine(parsed);
    this.emit({
      type: message.type,
      message: message.text,
      raw: parsed,
      timestamp: new Date().toISOString(),
    });
  }
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
