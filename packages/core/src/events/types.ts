import type { AgentState } from "../agent/types.js";
import type { Task } from "../task/types.js";

export type OfficeEvent =
  | {
      type: "agent_state_changed";
      agentId: string;
      state: AgentState;
      taskId?: string;
      capabilities: string[];
      workspacePath?: string;
    }
  | { type: "agent_task_progress"; agentId: string; message: string }
  | { type: "task_updated"; task: Task }
  | { type: "task_completed"; taskId: string; agentId: string; summary: string; filesChanged: string[] }
  | {
      type: "task_failed";
      taskId: string;
      agentId: string;
      reason: string;
      /** True when this failure is a workspace isolation violation (see SECURITY.md), not an ordinary CLI/task failure. */
      securityViolation?: boolean;
      /** Repo-relative paths the violation touched outside the task's workspacePath, already auto-reverted. */
      affectedPaths?: string[];
    }
  | { type: "goal_planning"; goalId: string; goal: string; workspacePath: string }
  | { type: "goal_planned"; goalId: string; goal: string; taskCount: number }
  | { type: "goal_failed"; goalId: string; goal: string; reason: string }
  | { type: "goal_summary"; goalId: string; goal: string; summary: string };
