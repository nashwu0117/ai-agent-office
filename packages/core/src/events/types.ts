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
  | { type: "task_failed"; taskId: string; agentId: string; reason: string };
