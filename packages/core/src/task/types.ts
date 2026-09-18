/**
 * The fixed capability vocabulary for this phase. A future Master LLM would
 * replace the "user checks boxes" step with its own output, but would still
 * pick from (or extend) this same list — Orchestrator matching logic
 * doesn't care where requiredCapabilities came from.
 */
export const KNOWN_CAPABILITIES = ["backend", "frontend", "testing", "docs"] as const;
export type Capability = (typeof KNOWN_CAPABILITIES)[number];

export type TaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "blocked_failed_dependency"
  | "done"
  | "failed";

/**
 * v0.22: how a task came to exist, purely for UI labeling — the Orchestrator's
 * dispatch logic branches on `pinnedAgentId` presence, not on this field.
 * "auto" covers both the v0.3 manual-capability-picker form and any future
 * fully-automatic submission path; "master" is one of a Master-decomposed
 * goal's subtasks; "manual" bypassed capability matching entirely via
 * assignTaskToAgent.
 */
export type TaskSource = "auto" | "manual" | "master";

export interface Task {
  id: string;
  title: string;
  description: string;
  workspacePath: string;
  /** Capabilities an agent's eligibleCapabilities must be a superset of to be dispatched this task. Ignored entirely when pinnedAgentId is set. */
  requiredCapabilities: string[];
  status: TaskStatus;
  assignedAgentId?: string;
  /** How this task was created — see TaskSource. */
  source: TaskSource;
  /**
   * v0.22: set by assignTaskToAgent when a user points at a specific agent
   * directly instead of going through capability matching. scheduleDispatch
   * special-cases a pinned task: it is only ever offered to this one agent
   * (skipping isSubset entirely), and simply stays "pending" — acting as
   * that agent's own personal queue — until this exact agent is "available".
   */
  pinnedAgentId?: string;
  /** Set when this task was one of several a Master decomposed from one high-level goal; groups it with its siblings. */
  goalId?: string;
  /**
   * Real ids of sibling tasks (same goalId) that must reach "done" before
   * this one can leave "blocked" and enter the normal pending -> dispatch
   * flow. Set once at creation from Master-declared dependencies; never
   * changes afterward (no mid-run replanning).
   */
  dependsOn?: string[];
  /**
   * v0.22: set once this task reaches "done" or "failed" — the same
   * summary/reason text and changed-files list already broadcast in
   * task_completed/task_failed, kept on the task itself so a later consumer
   * (see HandoffCoordinator) doesn't have to separately correlate that event
   * stream just to describe what this task produced.
   */
  resultSummary?: string;
  resultFilesChanged?: string[];
  createdAt: string;
  updatedAt: string;
}
