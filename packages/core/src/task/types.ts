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
  status: TaskStatus;
  assignedAgentId?: string;
  createdAt: string;
  updatedAt: string;
}
