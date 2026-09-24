import type { AgentState } from "../agent/types.js";
import type { AgentHandoff } from "../collaboration/types.js";
import type { BackendProfileClientInfo } from "../credentials/backend-profile.js";
import type { CredentialSourceStatus } from "../credentials/types.js";
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
  | {
      type: "agent_task_progress";
      agentId: string;
      message: string;
      eventType?: "log" | "progress" | "artifact" | "error" | "done";
      stream?: "stdout" | "stderr" | "system";
      timestamp?: string;
    }
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
      /** True when this failure was caused by missing/invalid/exhausted provider credentials (see CredentialRouter), not an ordinary CLI/task failure. */
      authFailure?: boolean;
      /** True when this failure is a misconfigured backendProfile (see BackendProfileError) — caught before any process was spawned, distinct from the provider rejecting a credential it was actually sent. */
      backendProfileError?: boolean;
    }
  | { type: "goal_planning"; goalId: string; goal: string; workspacePath: string }
  | { type: "goal_planned"; goalId: string; goal: string; taskCount: number }
  | {
      type: "goal_failed";
      goalId: string;
      goal: string;
      reason: string;
      /** True when Master planning itself failed for a credential reason (see MasterPlanningError.authFailure). */
      authFailure?: boolean;
    }
  | { type: "goal_summary"; goalId: string; goal: string; summary: string }
  /** Pushed whenever the server's CredentialRouter marks a source failed, so the UI's status pill stays live without polling. */
  | { type: "credential_status_changed"; sources: CredentialSourceStatus[] }
  /** v0.10: pushed whenever a backend profile is added or edited through the management UI (POST/PUT /api/backend-profiles), so every connected client's profile list stays live without a reload. */
  | { type: "backend_profiles_changed"; profiles: BackendProfileClientInfo[] }
  /** v0.10: pushed whenever an agent is repointed at a different backend profile through the management UI (PUT /api/agents/:id/backend-profile). Takes effect on that agent's *next* dispatched task — see Orchestrator.setAgentBackendProfile. */
  | { type: "agent_backend_profile_changed"; agentId: string; backendProfile?: string }
  /** Sent when stopping/starting a backend profile takes its assigned agents off/on the live office floor. */
  | { type: "agent_enabled_changed"; agentId: string; enabled: boolean }
  /** v0.13: pushed whenever the global default backend profile is changed through the management UI (PUT /api/default-backend-profile) — see apps/server/src/default-backend-store.ts. Every claude-code agent with neither a persisted per-agent override nor an AGENT_ROSTER-hardcoded default follows this value; each one that gets live-repointed also emits its own agent_backend_profile_changed. */
  | { type: "default_backend_profile_changed"; backendProfile: string | null }
  /** v0.22 Part B (+ v0.22.1 per-backend model): pushed whenever the Master Brain backend selector or either backend's model override changes (PUT /api/master-brain, PUT /api/master-brain/model) — see apps/server/src/master-brain-store.ts. `models` is the full per-backend-id map (not just the one that changed) so every connected client's selector stays in sync regardless of which id was edited. Takes effect starting with the next plan()/summarize() call. */
  | { type: "master_brain_changed"; masterBrain: string; models: Partial<Record<string, string>> }
  /** v0.22 Part C: pushed whenever a dependency handoff hands one agent's completed work to a different agent about to start a dependent task — see HandoffCoordinator. */
  | { type: "agent_handoff"; handoff: AgentHandoff };
