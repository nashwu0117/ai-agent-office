import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Task } from "@ai-office/core";
import { KNOWN_CAPABILITIES } from "@ai-office/core";
import { OfficeClient, submitTask } from "./ws/client.js";
import { OfficeScene } from "./office/OfficeScene.js";

interface LogLine {
  message: string;
  timestamp: number;
}

interface CompletionCard {
  key: string;
  taskId: string;
  agentId: string;
  summary: string;
  filesChanged: string[];
  ok: boolean;
}

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:4500`;

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasksById, setTasksById] = useState<Record<string, Task>>({});
  const [logsByAgent, setLogsByAgent] = useState<Record<string, LogLine[]>>({});
  const [completions, setCompletions] = useState<CompletionCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [requiredCapabilities, setRequiredCapabilities] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const clientRef = useRef<OfficeClient | null>(null);

  useEffect(() => {
    const client = new OfficeClient(WS_URL);
    clientRef.current = client;

    const unsubscribe = client.subscribe((msg) => {
      if (msg.type === "snapshot") {
        setAgents(msg.agents);
        setTasksById(Object.fromEntries(msg.tasks.map((t) => [t.id, t])));
        return;
      }

      if (msg.type === "agent_state_changed") {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === msg.agentId
              ? {
                  ...a,
                  state: msg.state,
                  currentTaskId: msg.taskId,
                  capabilities: msg.capabilities,
                  workspace: msg.workspacePath ? { id: a.workspace?.id ?? "", path: msg.workspacePath } : undefined,
                }
              : a
          )
        );
        return;
      }

      if (msg.type === "task_updated") {
        setTasksById((prev) => ({ ...prev, [msg.task.id]: msg.task }));
        return;
      }

      if (msg.type === "agent_task_progress") {
        setLogsByAgent((prev) => {
          const existing = prev[msg.agentId] ?? [];
          return { ...prev, [msg.agentId]: [...existing, { message: msg.message, timestamp: Date.now() }] };
        });
        return;
      }

      if (msg.type === "task_completed") {
        setCompletions((prev) => [
          {
            key: `${msg.taskId}-${Date.now()}`,
            taskId: msg.taskId,
            agentId: msg.agentId,
            summary: msg.summary,
            filesChanged: msg.filesChanged,
            ok: true,
          },
          ...prev,
        ]);
        return;
      }

      if (msg.type === "task_failed") {
        setCompletions((prev) => [
          {
            key: `${msg.taskId}-${Date.now()}`,
            taskId: msg.taskId,
            agentId: msg.agentId,
            summary: msg.reason,
            filesChanged: [],
            ok: false,
          },
          ...prev,
        ]);
      }
    });

    client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const progressByAgent = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [agentId, lines] of Object.entries(logsByAgent)) {
      if (lines.length > 0) result[agentId] = lines[lines.length - 1].message;
    }
    return result;
  }, [logsByAgent]);

  const pendingQueue = useMemo(
    () =>
      Object.values(tasksById)
        .filter((t) => t.status === "pending")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasksById]
  );

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;

  function toggleCapability(cap: string) {
    setRequiredCapabilities((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await submitTask({ description, workspacePath, requiredCapabilities });
      setDescription("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI Office — Vertical Slice</h1>
      </header>

      <div className="app-body">
        <div className="main-column">
          <OfficeScene
            agents={agents}
            progressByAgent={progressByAgent}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <form className="task-form" onSubmit={handleSubmit}>
            <textarea
              placeholder="Task description, e.g. Add a project intro section to README.md"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              required
            />
            <input
              type="text"
              placeholder="Local folder path, e.g. /home/you/some-project"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              required
            />
            <div className="capability-picker">
              <span className="capability-picker-label">Required capabilities:</span>
              {KNOWN_CAPABILITIES.map((cap) => (
                <label key={cap} className="capability-checkbox">
                  <input
                    type="checkbox"
                    checked={requiredCapabilities.includes(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  {cap}
                </label>
              ))}
            </div>
            <button type="submit" disabled={submitting}>
              {submitting ? "Dispatching…" : "Dispatch task"}
            </button>
            {formError && <div className="form-error">{formError}</div>}
          </form>

          <div className="completions">
            {completions.map((c) => (
              <div key={c.key} className={`completion-card ${c.ok ? "ok" : "fail"}`}>
                <strong>{c.ok ? "Task completed" : "Task failed"}</strong>
                <div>{c.summary}</div>
                <div className="completion-meta">
                  agent: {c.agentId}
                  {c.filesChanged.length > 0 && <> · files: {c.filesChanged.join(", ")}</>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <aside className={`detail-panel ${selectedAgent ? "open" : ""}`}>
          {selectedAgent && (
            <>
              <h2>{selectedAgent.id}</h2>
              <dl>
                <dt>State</dt>
                <dd>{selectedAgent.state}</dd>
                <dt>Task</dt>
                <dd>{selectedAgent.currentTaskId ?? "—"}</dd>
                <dt>Workspace</dt>
                <dd>{selectedAgent.workspace?.path ?? "—"}</dd>
                <dt>Eligible for</dt>
                <dd>
                  {selectedAgent.eligibleCapabilities.length > 0 ? selectedAgent.eligibleCapabilities.join(", ") : "—"}
                </dd>
                <dt>Granted now</dt>
                <dd>{selectedAgent.capabilities.length > 0 ? selectedAgent.capabilities.join(", ") : "—"}</dd>
              </dl>
              <h3>Live CLI output</h3>
              <div className="cli-log">
                {(logsByAgent[selectedAgent.id] ?? []).map((line, i) => (
                  <div key={i} className="cli-log-line">
                    {line.message}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <aside className="queue-panel">
          <h2>Queue ({pendingQueue.length})</h2>
          {pendingQueue.length === 0 && <div className="queue-empty">No tasks waiting for an agent.</div>}
          {pendingQueue.map((task) => (
            <div key={task.id} className="queue-item">
              <div className="queue-item-title">{task.title}</div>
              <div className="queue-item-meta">
                needs: {task.requiredCapabilities.length > 0 ? task.requiredCapabilities.join(", ") : "any"}
              </div>
              <div className="queue-item-meta">
                waiting {Math.max(0, Math.round((now - new Date(task.createdAt).getTime()) / 1000))}s
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
