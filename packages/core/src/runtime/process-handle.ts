import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { RuntimeEvent, RuntimeHandle } from "./adapter.js";
import { parseJsonLine, type JsonLine } from "./json-lines.js";

export interface SpawnRuntimeOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Maps one stdout line (JSON-parsed if possible, raw text otherwise) to a RuntimeEvent. */
  mapLine: (line: JsonLine) => RuntimeEvent;
}

/**
 * Shared spawn -> line-by-line JSON-tolerant parse -> exit skeleton used by
 * every CLI-backed RuntimeAdapter (ClaudeCodeAdapter, OpenCodeAdapter, ...
 * a future one just needs its own mapLine). A line that isn't valid JSON
 * never crashes the process — it's handed to mapLine as {raw} with no
 * `parsed`, and the adapter decides how to render that (usually a plain
 * "log" event echoing the raw text).
 */
export function spawnRuntimeProcess(options: SpawnRuntimeOptions): RuntimeHandle {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const eventCbs: Array<(e: RuntimeEvent) => void> = [];
  const exitCbs: Array<(code: number | null) => void> = [];
  let stderrBuffer = "";

  function emit(event: RuntimeEvent): void {
    for (const cb of eventCbs) cb(event);
  }

  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line: string) => {
    if (!line.trim()) return;
    emit(options.mapLine(parseJsonLine(line)));
  });

  child.stderr!.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
  });

  child.on("exit", (code) => {
    if (code !== 0 && stderrBuffer.trim()) {
      emit({ type: "error", message: stderrBuffer.trim(), timestamp: new Date().toISOString() });
    }
    for (const cb of exitCbs) cb(code);
  });

  child.on("error", (err) => {
    emit({ type: "error", message: err.message, timestamp: new Date().toISOString() });
  });

  return {
    onEvent(cb) {
      eventCbs.push(cb);
    },
    onExit(cb) {
      exitCbs.push(cb);
    },
    stop() {
      if (!child.killed) {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      }
    },
  };
}
