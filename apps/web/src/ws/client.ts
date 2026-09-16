import type { Agent, OfficeEvent, Task } from "@ai-office/core";

export type ServerMessage = OfficeEvent | { type: "snapshot"; agents: Agent[]; tasks: Task[] };

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
