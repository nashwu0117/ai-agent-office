import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, BackendProfileClientInfo, CredentialSourceStatus, Task } from "@ai-office/core";
import { KNOWN_CAPABILITIES } from "@ai-office/core";
import { OfficeClient, submitGoal, submitTask } from "./ws/client.js";
import { OfficeScene } from "./office/OfficeScene.js";
import { BackendProfilesPanel } from "./BackendProfilesPanel.js";
import "./backend-profiles-panel.css";

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
  securityViolation?: boolean;
  authFailure?: boolean;
  backendProfileError?: boolean;
}

type GoalStatus = "planning" | "planned" | "failed" | "summarized";

interface GoalState {
  goalId: string;
  goal: string;
  workspacePath: string;
  status: GoalStatus;
  taskCount?: number;
  reason?: string;
  authFailure?: boolean;
  summary?: string;
  createdAt: number;
}

// Small fixed palette so subtasks sharing a goalId are visually grouped
// (queue items, completion cards) without needing per-goal user input.
const GOAL_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa", "#f87171"];
function goalColor(goalId: string): string {
  let hash = 0;
  for (let i = 0; i < goalId.length; i++) hash = (hash * 31 + goalId.charCodeAt(i)) >>> 0;
  return GOAL_COLORS[hash % GOAL_COLORS.length];
}

// Display-only labels — every agent still goes through the exact same UI
// path regardless of runtime; this just makes the id readable.
const RUNTIME_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

// v0.9: display-only labels for a backendProfile's apiFormat, keyed by the
// exact BackendProfile["apiFormat"] union value from @ai-office/core.
const API_FORMAT_LABELS: Record<string, string> = {
  anthropic: "Anthropic Messages API",
  "openai-chat-completions": "OpenAI Chat Completions (translated)",
};

const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? "43117";
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:${SERVER_PORT}`;

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
  const [goalsById, setGoalsById] = useState<Record<string, GoalState>>({});
  const [goalText, setGoalText] = useState("");
  const [goalWorkspacePath, setGoalWorkspacePath] = useState("");
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [goalFormError, setGoalFormError] = useState<string | null>(null);
  const [securityAlertAgents, setSecurityAlertAgents] = useState<Set<string>>(new Set());
  const [credentialStatuses, setCredentialStatuses] = useState<CredentialSourceStatus[]>([]);
  const [backendProfiles, setBackendProfiles] = useState<BackendProfileClientInfo[]>([]);
  const [backendPanelOpen, setBackendPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const clientRef = useRef<OfficeClient | null>(null);

  useEffect(() => {
    const client = new OfficeClient(WS_URL);
    clientRef.current = client;

    const unsubscribe = client.subscribe((msg) => {
      if (msg.type === "snapshot") {
        setAgents(msg.agents);
        setTasksById(Object.fromEntries(msg.tasks.map((t) => [t.id, t])));
        setCredentialStatuses(msg.credentials);
        setBackendProfiles(msg.backendProfiles ?? []);
        setAnnouncement(
          `Office updated. ${msg.agents.length} agent${msg.agents.length === 1 ? "" : "s"} and ${msg.tasks.length} task${msg.tasks.length === 1 ? "" : "s"} loaded.`
        );
        return;
      }

      if (msg.type === "credential_status_changed") {
        setCredentialStatuses(msg.sources);
        const available = msg.sources.filter((source) => source.available).length;
        setAnnouncement(`Credential status updated. ${available} of ${msg.sources.length} available.`);
        return;
      }

      if (msg.type === "backend_profiles_changed") {
        setBackendProfiles(msg.profiles);
        setAnnouncement(`Backend profiles updated. ${msg.profiles.length} profile${msg.profiles.length === 1 ? "" : "s"} registered.`);
        return;
      }

      if (msg.type === "agent_backend_profile_changed") {
        setAgents((prev) =>
          prev.map((a) => (a.id === msg.agentId ? { ...a, backendProfile: msg.backendProfile } : a))
        );
        setAnnouncement(`${msg.agentId} reassigned to backend profile: ${msg.backendProfile ?? "official"}.`);
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
        setAnnouncement(
          `${msg.agentId} is now ${msg.state.replaceAll("_", " ")}${msg.taskId ? ` on task ${msg.taskId}` : ""}.`
        );
        return;
      }

      if (msg.type === "task_updated") {
        setTasksById((prev) => ({ ...prev, [msg.task.id]: msg.task }));
        setAnnouncement(`Task ${msg.task.title} is now ${msg.task.status.replaceAll("_", " ")}.`);
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
        setAnnouncement(`Task ${msg.taskId} completed by ${msg.agentId}. ${msg.summary}`);
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
            securityViolation: msg.securityViolation,
            authFailure: msg.authFailure,
            backendProfileError: msg.backendProfileError,
          },
          ...prev,
        ]);
        if (msg.securityViolation) {
          setSecurityAlertAgents((prev) => new Set(prev).add(msg.agentId));
          setTimeout(() => {
            setSecurityAlertAgents((prev) => {
              const next = new Set(prev);
              next.delete(msg.agentId);
              return next;
            });
          }, 6000);
        }
        setAnnouncement(
          `${msg.securityViolation ? "Security failure" : msg.authFailure ? "Authentication failure" : msg.backendProfileError ? "Backend profile error" : "Task failure"}: ${msg.taskId}, ${msg.reason}`
        );
        return;
      }

      if (msg.type === "goal_planning") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: {
            goalId: msg.goalId,
            goal: msg.goal,
            workspacePath: msg.workspacePath,
            status: "planning",
            createdAt: Date.now(),
          },
        }));
        setAnnouncement(`Master is planning the goal: ${msg.goal}.`);
        return;
      }

      if (msg.type === "goal_planned") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "planned", taskCount: msg.taskCount },
        }));
        setAnnouncement(`Master planned ${msg.taskCount} subtasks for ${msg.goal}. Dispatching now.`);
        return;
      }

      if (msg.type === "goal_failed") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "failed", reason: msg.reason, authFailure: msg.authFailure },
        }));
        setAnnouncement(
          `Master planning failed for ${msg.goal}${msg.authFailure ? " (authentication)" : ""}: ${msg.reason}`
        );
        return;
      }

      if (msg.type === "goal_summary") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "summarized", summary: msg.summary },
        }));
        setAnnouncement(`Master summary ready for ${msg.goal}: ${msg.summary}`);
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

  const queueItems = useMemo(
    () =>
      Object.values(tasksById)
        .filter(
          (t) => t.status === "pending" || t.status === "blocked" || t.status === "blocked_failed_dependency"
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasksById]
  );

  const goalsSorted = useMemo(() => Object.values(goalsById).sort((a, b) => b.createdAt - a.createdAt), [goalsById]);

  const availableCredentialCount = credentialStatuses.filter((s) => s.available).length;
  const credentialStatusLabel = credentialStatuses
    .map((status) => `${status.provider} ${status.id}: ${status.available ? "available" : "unavailable"}`)
    .join(". ");

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

  async function handleGoalSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGoalFormError(null);
    setGoalSubmitting(true);
    try {
      await submitGoal({ goal: goalText, workspacePath: goalWorkspacePath });
      setGoalText("");
    } catch (err) {
      setGoalFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setGoalSubmitting(false);
    }
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to task controls
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <header className="app-header">
        <h1>AI Office — Vertical Slice</h1>
        <button type="button" className="bp-open-button" onClick={() => setBackendPanelOpen(true)}>
          Backend &amp; Credentials
        </button>
        {credentialStatuses.length > 0 && (
          <div
            className={`credential-pill ${availableCredentialCount === 0 ? "credential-pill-none" : ""}`}
            title={credentialStatuses.map((s) => `${s.provider}/${s.id}: ${s.available ? "available" : "unavailable"}`).join("\n")}
            aria-label={`Credentials: ${availableCredentialCount} of ${credentialStatuses.length} available. ${credentialStatusLabel}`}
          >
            <span className="credential-pill-dot" aria-hidden="true" />
            Credentials: {availableCredentialCount}/{credentialStatuses.length} available
          </div>
        )}
      </header>

      <div className="app-body">
        <main id="main-content" className="main-column" tabIndex={-1}>
          <OfficeScene
            agents={agents}
            progressByAgent={progressByAgent}
            selectedId={selectedId}
            onSelect={setSelectedId}
            securityAlertAgentIds={securityAlertAgents}
          />

          <form className="task-form goal-form" onSubmit={handleGoalSubmit} aria-labelledby="goal-form-heading">
            <h2 id="goal-form-heading" className="form-heading">
              High-level goal (Master plans it for you)
            </h2>
            <label className="sr-only" htmlFor="goal-description">
              High-level goal
            </label>
            <textarea
              id="goal-description"
              placeholder="e.g. Add an install section to README.md, and add a simple string-utils test in utils/"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              aria-invalid={Boolean(goalFormError)}
              aria-describedby={goalFormError ? "goal-form-error" : undefined}
              rows={2}
              required
            />
            <label className="sr-only" htmlFor="goal-workspace-path">
              Goal workspace folder path
            </label>
            <input
              id="goal-workspace-path"
              type="text"
              placeholder="Local folder path (shared by every subtask), e.g. /home/you/some-project"
              value={goalWorkspacePath}
              onChange={(e) => setGoalWorkspacePath(e.target.value)}
              aria-invalid={Boolean(goalFormError)}
              aria-describedby={goalFormError ? "goal-form-error" : undefined}
              required
            />
            <button type="submit" disabled={goalSubmitting}>
              {goalSubmitting ? "Sending to Master…" : "Ask Master to plan & dispatch"}
            </button>
            {goalFormError && (
              <div id="goal-form-error" className="form-error" role="alert">
                {goalFormError}
              </div>
            )}
          </form>

          {goalsSorted.length > 0 && (
            <section className="goal-panel" aria-label="Master planning status">
              {goalsSorted.map((g) => (
                <article key={g.goalId} className="goal-card" style={{ borderLeftColor: goalColor(g.goalId) }}>
                  <div className="goal-card-header">
                    <span className="goal-card-dot" style={{ background: goalColor(g.goalId) }} aria-hidden="true" />
                    <strong>{g.goal}</strong>
                  </div>
                  {g.status === "planning" && <div className="goal-card-status">Master is planning…</div>}
                  {g.status === "planned" && (
                    <div className="goal-card-status">
                      Planned {g.taskCount} subtask{g.taskCount === 1 ? "" : "s"} — dispatching…
                    </div>
                  )}
                  {g.status === "failed" && (
                    <div className={`goal-card-status goal-card-status-fail ${g.authFailure ? "goal-card-status-auth" : ""}`}>
                      <span aria-hidden="true">{g.authFailure ? "🔑 " : "⚠ "}</span>
                      Master planning failed{g.authFailure ? " (authentication)" : ""}: {g.reason}
                    </div>
                  )}
                  {g.status === "summarized" && <div className="goal-card-summary">{g.summary}</div>}
                </article>
              ))}
            </section>
          )}

          <form className="task-form" onSubmit={handleSubmit} aria-labelledby="task-form-heading">
            <h2 id="task-form-heading" className="form-heading">
              Manual task (pick capabilities yourself)
            </h2>
            <label className="sr-only" htmlFor="task-description">
              Manual task description
            </label>
            <textarea
              id="task-description"
              placeholder="Task description, e.g. Add a project intro section to README.md"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? "task-form-error" : undefined}
              rows={3}
              required
            />
            <label className="sr-only" htmlFor="task-workspace-path">
              Task workspace folder path
            </label>
            <input
              id="task-workspace-path"
              type="text"
              placeholder="Local folder path, e.g. /home/you/some-project"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? "task-form-error" : undefined}
              required
            />
            <fieldset className="capability-picker">
              <legend className="capability-picker-label">Required capabilities:</legend>
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
            </fieldset>
            <button type="submit" disabled={submitting}>
              {submitting ? "Dispatching…" : "Dispatch task"}
            </button>
            {formError && (
              <div id="task-form-error" className="form-error" role="alert">
                {formError}
              </div>
            )}
          </form>

          <section className="completions" aria-labelledby="completion-heading">
            <h2 id="completion-heading" className="sr-only">
              Task results
            </h2>
            {completions.map((c) => {
              const goalId = tasksById[c.taskId]?.goalId;
              return (
                <article
                  key={c.key}
                  className={`completion-card ${c.ok ? "ok" : c.securityViolation ? "security" : c.authFailure ? "auth" : c.backendProfileError ? "backend" : "fail"}`}
                >
                  {goalId && (
                    <span className="goal-card-dot" style={{ background: goalColor(goalId) }} aria-hidden="true" />
                  )}
                  <span className="status-icon" aria-hidden="true">
                    {c.ok ? "✓" : c.securityViolation ? "⚠" : c.authFailure ? "🔑" : c.backendProfileError ? "⚙" : "✕"}
                  </span>{" "}
                  <strong>
                    {c.ok
                      ? "Task completed"
                      : c.securityViolation
                        ? "Security failure: workspace isolation violation"
                        : c.authFailure
                          ? "Authentication failure"
                          : c.backendProfileError
                            ? "Backend profile error"
                            : "Task failed"}
                  </strong>
                  <div>{c.summary}</div>
                  <div className="completion-meta">
                    agent: {c.agentId}
                    {c.filesChanged.length > 0 && <> · files: {c.filesChanged.join(", ")}</>}
                  </div>
                </article>
              );
            })}
          </section>
        </main>

        <aside className={`detail-panel ${selectedAgent ? "open" : ""}`} aria-label="Agent details">
          {selectedAgent && (
            <>
              <h2>{selectedAgent.id}</h2>
              <dl>
                <dt>Runtime</dt>
                <dd>{RUNTIME_LABELS[selectedAgent.runtime] ?? selectedAgent.runtime}</dd>
                {selectedAgent.runtime === "claude-code" && (
                  <>
                    <dt>Backend</dt>
                    <dd>
                      {selectedAgent.backendProfile && selectedAgent.backendProfile !== "official"
                        ? (backendProfiles.find((p) => p.id === selectedAgent.backendProfile)?.label ?? selectedAgent.backendProfile)
                        : "Official (Anthropic)"}
                    </dd>
                    <dt>API format</dt>
                    <dd>
                      {selectedAgent.backendProfile && selectedAgent.backendProfile !== "official"
                        ? (() => {
                            const format = backendProfiles.find((p) => p.id === selectedAgent.backendProfile)?.apiFormat;
                            return format ? (API_FORMAT_LABELS[format] ?? format) : "unknown (profile not registered)";
                          })()
                        : API_FORMAT_LABELS.anthropic}
                    </dd>
                  </>
                )}
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

        <aside className="queue-panel" aria-labelledby="queue-heading">
          <h2 id="queue-heading">Queue ({queueItems.length})</h2>
          {queueItems.length === 0 && <div className="queue-empty">No tasks waiting for an agent.</div>}
          {queueItems.length > 0 && (
            <ol className="queue-list">
              {queueItems.map((task) => {
                const depTitles = (task.dependsOn ?? []).map((id) => tasksById[id]?.title ?? id);
                return (
                  <li
                    key={task.id}
                    className={`queue-item queue-item-${task.status}`}
                    style={task.goalId ? { borderLeftColor: goalColor(task.goalId), borderLeftWidth: 3 } : undefined}
                  >
                    <div className="queue-item-title">{task.title}</div>
                    <div className="queue-item-meta">
                      needs: {task.requiredCapabilities.length > 0 ? task.requiredCapabilities.join(", ") : "any"}
                    </div>
                    {task.status === "pending" && (
                      <div className="queue-item-meta">
                        <strong>⌛ Pending</strong> — waiting{" "}
                        {Math.max(0, Math.round((now - new Date(task.createdAt).getTime()) / 1000))}s
                      </div>
                    )}
                    {task.status === "blocked" && (
                      <div className="queue-item-meta queue-item-tag-blocked">
                        <strong>⏸ Blocked</strong> — waiting on: {depTitles.length > 0 ? depTitles.join(", ") : "a prior task"}
                      </div>
                    )}
                    {task.status === "blocked_failed_dependency" && (
                      <div className="queue-item-meta queue-item-tag-blocked-failed">
                        <strong>✕ Blocked — dependency failed</strong>: {depTitles.length > 0 ? depTitles.join(", ") : "a prior task"}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>

      <BackendProfilesPanel
        open={backendPanelOpen}
        onClose={() => setBackendPanelOpen(false)}
        credentialStatuses={credentialStatuses}
        backendProfiles={backendProfiles}
        agents={agents}
      />
    </div>
  );
}
