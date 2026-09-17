import type { Capability } from "../task/types.js";

/**
 * One subtask the Master decomposed a high-level goal into. `description`
 * is handed straight to a worker's RuntimeAdapter as `task.description`, so
 * it must read like a concrete instruction a headless coding CLI can act on
 * — not a repeat of the user's original goal.
 */
export interface PlannedTask {
  title: string;
  description: string;
  requiredCapabilities: Capability[];
  /**
   * Titles of other PlannedTask entries in this same plan() call that must
   * finish before this one can start. Optional — most subtasks should leave
   * this empty so the Orchestrator can dispatch them all in parallel; only
   * set it when one subtask genuinely needs something a specific other one
   * produces. Resolved to real Task ids (and checked for cycles) by
   * resolveDependencies() before any Task is created.
   */
  dependsOn?: string[];
}

export interface TaskResultSummary {
  title: string;
  status: "done" | "failed";
  filesChanged: string[];
  note?: string;
}

/**
 * Implemented once per LLM backend the Master planning step runs on
 * (Anthropic today; Codex/Gemini later) — mirrors how RuntimeAdapter lets
 * v0.4 add a second CLI without touching the Orchestrator. Whatever calls
 * MasterBrain only ever talks to this interface, never to a specific SDK.
 */
export interface MasterBrain {
  /** Decompose a user's high-level goal into independently dispatchable subtasks. */
  plan(goal: string): Promise<PlannedTask[]>;
  /** Once every subtask from one goal has settled, produce a user-facing summary. */
  summarize(goal: string, results: TaskResultSummary[]): Promise<string>;
}

export class MasterPlanningError extends Error {
  /** True when this failure was caused by missing/invalid/exhausted provider credentials (see CredentialRouter), not a general planning failure (bad model output, network error, ...). */
  readonly authFailure: boolean;

  constructor(message: string, options?: { authFailure?: boolean }) {
    super(message);
    this.name = "MasterPlanningError";
    this.authFailure = options?.authFailure ?? false;
  }
}
