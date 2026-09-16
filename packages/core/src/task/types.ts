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
  createdAt: string;
  updatedAt: string;
}
