import type { Agent, BackendProfileClientInfo, CredentialSourceStatus, OfficeEvent, Task } from "@ai-office/core";

export type ServerMessage =
  | OfficeEvent
  | {
      type: "snapshot";
      agents: Agent[];
      tasks: Task[];
      credentials: CredentialSourceStatus[];
      /** v0.10: id/label/apiFormat/env-var-names/available for every registered BackendProfile — never secret values. See apps/server/src/backend-profile-store.ts. */
      backendProfiles?: BackendProfileClientInfo[];
    };

type Listener = (msg: ServerMessage) => void;

/**
 * Thin reconnecting WebSocket wrapper. Every message that reaches the UI is
 * either the initial snapshot or a structured OfficeEvent broadcast by the
 * server's Orchestrator — there is no client-side fabricated state.
 */
export class OfficeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.disposed || this.socket) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      // React StrictMode may dispose this client while the handshake is still
      // in flight. Closing a CONNECTING WebSocket directly makes browsers log
      // "closed before the connection is established". Let it finish the
      // handshake, then close it normally instead.
      if (this.disposed) socket.close(1000, "client disposed");
    };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        for (const listener of this.listeners) listener(msg);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.disposed) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 1500);
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const socket = this.socket;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, "client disposed");
    }
  }
}

export async function submitTask(input: {
  description: string;
  workspacePath: string;
  requiredCapabilities: string[];
}): Promise<void> {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }
}

export async function submitGoal(input: { goal: string; workspacePath: string }): Promise<void> {
  const res = await fetch("/api/goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed with status ${res.status}`);
  }
}

export interface BackendProfileInput {
  id: string;
  label: string;
  apiFormat: string;
  baseUrlEnvVar: string;
  authTokenEnvVar: string;
}

async function jsonRequest(url: string, method: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const responseBody = await res.json().catch(() => ({}));
    throw new Error(responseBody.error ?? `request failed with status ${res.status}`);
  }
}

/** v0.10: management-UI writes — see BackendProfilesPanel.tsx. Reads come from the WS snapshot/backend_profiles_changed events instead of polling. */
export function createBackendProfile(input: BackendProfileInput): Promise<void> {
  return jsonRequest("/api/backend-profiles", "POST", input);
}

export function updateBackendProfile(id: string, patch: Partial<Omit<BackendProfileInput, "id">>): Promise<void> {
  return jsonRequest(`/api/backend-profiles/${encodeURIComponent(id)}`, "PUT", patch);
}

export function setAgentBackendProfile(agentId: string, backendProfile: string | null): Promise<void> {
  return jsonRequest(`/api/agents/${encodeURIComponent(agentId)}/backend-profile`, "PUT", { backendProfile });
}
