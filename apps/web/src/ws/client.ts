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

  constructor(private readonly url: string) {}

  connect(): void {
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerMessage;
        for (const listener of this.listeners) listener(msg);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
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
