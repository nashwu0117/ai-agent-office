import type { Agent } from "../agent/types.js";
import type { Task } from "../task/types.js";

export type RuntimeEventType = "log" | "progress" | "artifact" | "error" | "done";

export interface RuntimeEvent {
  type: RuntimeEventType;
  message: string;
  raw?: unknown;
  timestamp: string;
}

export interface RuntimeHandle {
  onEvent(cb: (e: RuntimeEvent) => void): void;
  onExit(cb: (code: number | null) => void): void;
  stop(): void;
}

/**
 * Implemented once per CLI backend (Claude Code today; OpenCode/Aider later).
 * The Orchestrator only ever talks to this interface, never to a process
 * directly, so swapping/adding runtimes doesn't touch orchestration logic.
 */
export interface RuntimeAdapter {
  start(task: Task, agent: Agent): Promise<RuntimeHandle>;
}
