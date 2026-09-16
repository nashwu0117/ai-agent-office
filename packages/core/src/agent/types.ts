export type AgentState =
  | "created"
  | "available"
  | "assigned"
  | "starting"
  | "working"
  | "waiting"
  | "blocked"
  | "error"
  | "done"
  | "releasing";

/**
 * Points at a credential without carrying the secret itself. This MVP only
 * ever populates a single "anthropic" ref from the parent process env, but
 * keeping the type separate lets a future multi-account/multi-provider
 * scheduler pick a different ref per agent without touching the state machine.
 */
export interface CredentialRef {
  provider: string;
  accountId: string;
}

export interface AgentWorkspace {
  id: string;
  path: string;
  gitBranch?: string;
}

export interface Agent {
  id: string;
  state: AgentState;
  runtime: string;
  model?: string;
  credential?: CredentialRef;
  capabilities: string[];
  currentTaskId?: string;
  workspace?: AgentWorkspace;
  createdAt: string;
  updatedAt: string;
}
