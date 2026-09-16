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

export interface Task {
  id: string;
  title: string;
  description: string;
  workspacePath: string;
  /** Capabilities an agent's eligibleCapabilities must be a superset of to be dispatched this task. */
  requiredCapabilities: string[];
  status: TaskStatus;
  assignedAgentId?: string;
  /** Set when this task was one of several a Master decomposed from one high-level goal; groups it with its siblings. */
  goalId?: string;
  /**
   * Real ids of sibling tasks (same goalId) that must reach "done" before
   * this one can leave "blocked" and enter the normal pending -> dispatch
   * flow. Set once at creation from Master-declared dependencies; never
   * changes afterward (no mid-run replanning).
   */
  dependsOn?: string[];
  createdAt: string;
  updatedAt: string;
}
