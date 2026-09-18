/**
 * v0.22 Part C: the minimum viable content-level agent-to-agent message this
 * project has — see HandoffCoordinator's own doc comment for the exact
 * trigger. Before this, the only cross-task data flow anywhere in the repo
 * was status/dependency tracking (Task.dependsOn, task_completed/
 * task_failed); no agent's own text was ever handed to a different agent's
 * context. This is deliberately narrow — one defined situation (a dependency
 * handoff between two different agents), not a general inbox/chat system.
 */
export interface AgentHandoff {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  fromTaskId: string;
  fromTaskTitle: string;
  toTaskId: string;
  toTaskTitle: string;
  /** Template-generated handoff text — see HandoffCoordinator.buildHandoff. Not LLM-generated: see that method's comment on the tradeoff. */
  message: string;
  createdAt: string;
}
