import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, BackendProfileClientInfo, CredentialSourceStatus, Task } from "@ai-office/core";
import { KNOWN_CAPABILITIES } from "@ai-office/core";
import { OfficeClient, assignTaskToAgent, fetchCredentialStatuses, submitGoal, submitTask } from "./ws/client.js";
import { OfficeScene } from "./office/OfficeScene.js";
import { BackendProfilesPanel } from "./BackendProfilesPanel.js";
import { useLanguage } from "./i18n/language-context.js";
import { LanguageToggle } from "./i18n/LanguageToggle.js";
import { useAuthRequired } from "./AuthGate.js";
import { logout } from "./auth-client.js";
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

// Routed through the Vite dev proxy's "/ws" entry (see vite.config.ts) so the
// page works over a single origin/port — required for it to also work behind
// a reverse tunnel that only forwards one port to the browser.
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export default function App() {
  const { t } = useLanguage();
  const authRequired = useAuthRequired();
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
  const [defaultBackendProfile, setDefaultBackendProfileState] = useState<string | null>(null);
  const [masterBrain, setMasterBrainState] = useState<"claude-code" | "codex">("claude-code");
  const [backendPanelOpen, setBackendPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // v0.22 Part A: direct "point at an agent" assignment, independent of the
  // v0.3 capability-matching form above. Keyed by nothing extra — only one
  // agent's detail panel (and therefore one assign form) is ever open at a
  // time, since selectedId is a single value.
  const [assignDescription, setAssignDescription] = useState("");
  const [assignWorkspacePath, setAssignWorkspacePath] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Set instead of calling the API immediately when the targeted agent isn't
  // "available" — holds the form values so "queue it" can submit exactly
  // what the user typed, and "cancel" can discard them without a server call.
  const [assignBusyPending, setAssignBusyPending] = useState<{
    agentId: string;
    description: string;
    workspacePath: string;
  } | null>(null);
  const clientRef = useRef<OfficeClient | null>(null);
  // The socket must survive language switches, so the message handler below
  // reads translations through this ref instead of depending on `t` and
  // reconnecting the websocket every time the toggle is clicked.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const client = new OfficeClient(WS_URL);
    clientRef.current = client;

    const unsubscribe = client.subscribe((msg) => {
      if (msg.type === "snapshot") {
        setAgents(msg.agents);
        setTasksById(Object.fromEntries(msg.tasks.map((task) => [task.id, task])));
        setCredentialStatuses(msg.credentials);
        setBackendProfiles(msg.backendProfiles ?? []);
        setDefaultBackendProfileState(msg.defaultBackendProfile ?? null);
        setMasterBrainState(msg.masterBrain ?? "claude-code");
        setAnnouncement(tRef.current.announceSnapshot(msg.agents.length, msg.tasks.length));
        return;
      }

      if (msg.type === "master_brain_changed") {
        setMasterBrainState(msg.masterBrain === "codex" ? "codex" : "claude-code");
        return;
      }

      if (msg.type === "credential_status_changed") {
        setCredentialStatuses(msg.sources);
        const available = msg.sources.filter((source) => source.available).length;
        setAnnouncement(tRef.current.announceCredentialStatus(available, msg.sources.length));
        return;
      }

      if (msg.type === "backend_profiles_changed") {
        setBackendProfiles(msg.profiles);
        setAnnouncement(tRef.current.announceBackendProfiles(msg.profiles.length));
        return;
      }

      if (msg.type === "agent_backend_profile_changed") {
        setAgents((prev) =>
          prev.map((a) => (a.id === msg.agentId ? { ...a, backendProfile: msg.backendProfile } : a))
        );
        setAnnouncement(
          tRef.current.announceAgentReassigned(msg.agentId, msg.backendProfile ?? tRef.current.officialBackend)
        );
        return;
      }

      if (msg.type === "default_backend_profile_changed") {
        setDefaultBackendProfileState(msg.backendProfile);
        setAnnouncement(
          tRef.current.announceDefaultBackendChanged(msg.backendProfile ?? tRef.current.officialBackend)
        );
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
          tRef.current.announceAgentStateChanged(msg.agentId, tRef.current.agentStateLabel(msg.state), msg.taskId)
        );
        return;
      }

      if (msg.type === "task_updated") {
        setTasksById((prev) => ({ ...prev, [msg.task.id]: msg.task }));
        setAnnouncement(tRef.current.announceTaskUpdated(msg.task.title, tRef.current.taskStatusLabel(msg.task.status)));
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
        setAnnouncement(tRef.current.announceTaskCompleted(msg.taskId, msg.agentId, msg.summary));
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
          tRef.current.announceTaskFailed(
            msg.securityViolation
              ? "security"
              : msg.authFailure
                ? "auth"
                : msg.backendProfileError
                  ? "backend"
                  : "generic",
            msg.taskId,
            msg.reason
          )
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
        setAnnouncement(tRef.current.announceGoalPlanning(msg.goal));
        return;
      }

      if (msg.type === "goal_planned") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "planned", taskCount: msg.taskCount },
        }));
        setAnnouncement(tRef.current.announceGoalPlanned(msg.taskCount, msg.goal));
        return;
      }

      if (msg.type === "goal_failed") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "failed", reason: msg.reason, authFailure: msg.authFailure },
        }));
        setAnnouncement(tRef.current.announceGoalFailed(msg.goal, msg.reason, Boolean(msg.authFailure)));
        return;
      }

      if (msg.type === "goal_summary") {
        setGoalsById((prev) => ({
          ...prev,
          [msg.goalId]: { ...prev[msg.goalId], status: "summarized", summary: msg.summary },
        }));
        setAnnouncement(tRef.current.announceGoalSummary(msg.goal, msg.summary));
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

  // Switching which agent's detail panel is open discards any in-progress
  // assign form / busy-warning for the previous one, rather than letting a
  // stale "queue it?" dialog carry over to a different agent.
  useEffect(() => {
    setAssignDescription("");
    setAssignWorkspacePath("");
    setAssignError(null);
    setAssignBusyPending(null);
  }, [selectedId]);

  const progressByAgent = useMemo(() => {
    const result: Record<string, string> = {};
    for (const [agentId, lines] of Object.entries(logsByAgent)) {
      if (lines.length > 0) result[agentId] = lines[lines.length - 1].message;
    }
    return result;
  }, [logsByAgent]);

  // Agents dispatched from the same Master goal are the collaboration unit.
  // Once at least two siblings are active, the scene sends them to one of
  // three meeting rooms together; unrelated agents keep their desks or roam.
  const collaborationRoomByAgent = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const agent of agents) {
      const task = agent.currentTaskId ? tasksById[agent.currentTaskId] : undefined;
      const active = ["assigned", "starting", "working", "waiting", "blocked"].includes(agent.state);
      if (!active) continue;
      // Master-decomposed tasks share goalId. For manually submitted tasks,
      // active agents exchanging progress in the same workspace are the
      // closest available collaboration signal.
      const collaborationKey = task?.goalId
        ? `goal:${task.goalId}`
        : task?.workspacePath && progressByAgent[agent.id]
          ? `workspace:${task.workspacePath}`
          : undefined;
      if (!collaborationKey) continue;
      const group = groups.get(collaborationKey) ?? [];
      group.push(agent.id);
      groups.set(collaborationKey, group);
    }

    const result: Record<string, number> = {};
    [...groups.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([, ids], groupIndex) => {
        for (const agentId of ids) result[agentId] = groupIndex % 3;
      });
    return result;
  }, [agents, tasksById, progressByAgent]);

  const queueItems = useMemo(
    () =>
      Object.values(tasksById)
        .filter(
          (task) => task.status === "pending" || task.status === "blocked" || task.status === "blocked_failed_dependency"
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasksById]
  );

  const goalsSorted = useMemo(() => Object.values(goalsById).sort((a, b) => b.createdAt - a.createdAt), [goalsById]);

  const availableCredentialCount = credentialStatuses.filter((s) => s.available).length;
  const credentialStatusLabel = credentialStatuses
    .map((status) => t.credentialDetailLine(status.provider, status.id, status.available))
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

  async function runAssign(agentId: string, description: string, workspacePathValue: string, queued: boolean) {
    setAssignError(null);
    setAssigning(true);
    try {
      await assignTaskToAgent(agentId, { description, workspacePath: workspacePathValue });
      setAssignDescription("");
      setAssignWorkspacePath("");
      setAssignBusyPending(null);
      setAnnouncement(t.announceTaskAssigned(agentId, queued));
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssigning(false);
    }
  }

  function handleAssignSubmit(e: React.FormEvent, agent: Agent) {
    e.preventDefault();
    setAssignError(null);
    if (agent.state !== "available") {
      setAssignBusyPending({ agentId: agent.id, description: assignDescription, workspacePath: assignWorkspacePath });
      return;
    }
    void runAssign(agent.id, assignDescription, assignWorkspacePath, false);
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        {t.skipToTaskControls}
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <header className="app-header">
        <h1>{t.appTitle}</h1>
        <div className="app-header-actions">
          <button type="button" className="bp-open-button" onClick={() => setBackendPanelOpen(true)}>
            {t.backendCredentials}
          </button>
          {credentialStatuses.length > 0 && (
            <div
              className={`credential-pill ${availableCredentialCount === 0 ? "credential-pill-none" : ""}`}
              title={credentialStatuses.map((s) => t.credentialDetailLine(s.provider, s.id, s.available)).join("\n")}
              aria-label={t.credentialsAriaLabel(availableCredentialCount, credentialStatuses.length, credentialStatusLabel)}
            >
              <span className="credential-pill-dot" aria-hidden="true" />
              {t.credentialsPill(availableCredentialCount, credentialStatuses.length)}
            </div>
          )}
          <LanguageToggle />
          {authRequired && (
            <button type="button" className="bp-open-button" onClick={() => logout().then(() => location.reload())}>
              {t.logoutButton}
            </button>
          )}
        </div>
      </header>

      <div className="app-body">
        <main id="main-content" className="main-column" tabIndex={-1}>
          <OfficeScene
            agents={agents}
            progressByAgent={progressByAgent}
            collaborationRoomByAgent={collaborationRoomByAgent}
            selectedId={selectedId}
            onSelect={setSelectedId}
            securityAlertAgentIds={securityAlertAgents}
          />

          <form className="task-form goal-form" onSubmit={handleGoalSubmit} aria-labelledby="goal-form-heading">
            <h2 id="goal-form-heading" className="form-heading">
              {t.goalFormHeading}
            </h2>
            <label className="sr-only" htmlFor="goal-description">
              {t.goalDescriptionLabel}
            </label>
            <textarea
              id="goal-description"
              placeholder={t.goalDescriptionPlaceholder}
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              aria-invalid={Boolean(goalFormError)}
              aria-describedby={goalFormError ? "goal-form-error" : undefined}
              rows={2}
              required
            />
            <label className="sr-only" htmlFor="goal-workspace-path">
              {t.goalWorkspaceLabel}
            </label>
            <input
              id="goal-workspace-path"
              type="text"
              placeholder={t.goalWorkspacePlaceholder}
              value={goalWorkspacePath}
              onChange={(e) => setGoalWorkspacePath(e.target.value)}
              aria-invalid={Boolean(goalFormError)}
              aria-describedby={goalFormError ? "goal-form-error" : undefined}
              required
            />
            <button type="submit" disabled={goalSubmitting}>
              {goalSubmitting ? t.goalSubmitting : t.goalSubmit}
            </button>
            {goalFormError && (
              <div id="goal-form-error" className="form-error" role="alert">
                {goalFormError}
              </div>
            )}
          </form>

          {goalsSorted.length > 0 && (
            <section className="goal-panel" aria-label={t.goalFormHeading}>
              {goalsSorted.map((g) => (
                <article key={g.goalId} className="goal-card" style={{ borderLeftColor: goalColor(g.goalId) }}>
                  <div className="goal-card-header">
                    <span className="goal-card-dot" style={{ background: goalColor(g.goalId) }} aria-hidden="true" />
                    <strong>{g.goal}</strong>
                  </div>
                  {g.status === "planning" && <div className="goal-card-status">{t.goalPlanningStatus}</div>}
                  {g.status === "planned" && (
                    <div className="goal-card-status">{t.goalPlannedStatus(g.taskCount ?? 0)}</div>
                  )}
                  {g.status === "failed" && (
                    <div className={`goal-card-status goal-card-status-fail ${g.authFailure ? "goal-card-status-auth" : ""}`}>
                      <span aria-hidden="true">{g.authFailure ? "🔑 " : "⚠ "}</span>
                      {t.goalFailedStatus(g.reason ?? "", Boolean(g.authFailure))}
                    </div>
                  )}
                  {g.status === "summarized" && <div className="goal-card-summary">{g.summary}</div>}
                </article>
              ))}
            </section>
          )}

          <form className="task-form" onSubmit={handleSubmit} aria-labelledby="task-form-heading">
            <h2 id="task-form-heading" className="form-heading">
              {t.taskFormHeading}
            </h2>
            <label className="sr-only" htmlFor="task-description">
              {t.taskDescriptionLabel}
            </label>
            <textarea
              id="task-description"
              placeholder={t.taskDescriptionPlaceholder}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? "task-form-error" : undefined}
              rows={3}
              required
            />
            <label className="sr-only" htmlFor="task-workspace-path">
              {t.taskWorkspaceLabel}
            </label>
            <input
              id="task-workspace-path"
              type="text"
              placeholder={t.taskWorkspacePlaceholder}
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? "task-form-error" : undefined}
              required
            />
            <fieldset className="capability-picker">
              <legend className="capability-picker-label">{t.requiredCapabilities}</legend>
              {KNOWN_CAPABILITIES.map((cap) => (
                <label key={cap} className="capability-checkbox">
                  <input
                    type="checkbox"
                    checked={requiredCapabilities.includes(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  {t.capabilityLabel(cap)}
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={submitting}>
              {submitting ? t.taskSubmitting : t.taskSubmit}
            </button>
            {formError && (
              <div id="task-form-error" className="form-error" role="alert">
                {formError}
              </div>
            )}
          </form>

          <section className="completions" aria-labelledby="completion-heading">
            <h2 id="completion-heading" className="sr-only">
              {t.taskResultsHeading}
            </h2>
            {completions.map((c) => {
              const task = tasksById[c.taskId];
              const goalId = task?.goalId;
              const kind = c.ok ? "ok" : c.securityViolation ? "security" : c.authFailure ? "auth" : c.backendProfileError ? "backend" : "fail";
              return (
                <article key={c.key} className={`completion-card ${kind}`}>
                  {goalId && (
                    <span className="goal-card-dot" style={{ background: goalColor(goalId) }} aria-hidden="true" />
                  )}
                  <span className="status-icon" aria-hidden="true">
                    {c.ok ? "✓" : c.securityViolation ? "⚠" : c.authFailure ? "🔑" : c.backendProfileError ? "⚙" : "✕"}
                  </span>{" "}
                  <strong>{t.completionTitle(kind)}</strong>
                  {task && (
                    <span className={`task-source-badge task-source-${task.source}`}>{t.taskSourceLabel(task.source)}</span>
                  )}
                  <div>{c.summary}</div>
                  <div className="completion-meta">{t.completionMeta(c.agentId, c.filesChanged)}</div>
                </article>
              );
            })}
          </section>
        </main>

        <aside className={`detail-panel ${selectedAgent ? "open" : ""}`} aria-label={t.agentDetailsAriaLabel}>
          {selectedAgent && (
            <>
              <h2>{selectedAgent.id}</h2>

              <form
                className="task-form assign-form"
                onSubmit={(e) => handleAssignSubmit(e, selectedAgent)}
                aria-labelledby="assign-form-heading"
              >
                <h3 id="assign-form-heading" className="form-heading">
                  {t.assignFormHeading(selectedAgent.id)}
                </h3>
                <p className="assign-form-hint">{t.assignFormHint}</p>
                <label className="sr-only" htmlFor="assign-description">
                  {t.assignDescriptionLabel}
                </label>
                <textarea
                  id="assign-description"
                  placeholder={t.assignDescriptionPlaceholder}
                  value={assignDescription}
                  onChange={(e) => setAssignDescription(e.target.value)}
                  rows={2}
                  required
                />
                <label className="sr-only" htmlFor="assign-workspace-path">
                  {t.assignWorkspaceLabel}
                </label>
                <input
                  id="assign-workspace-path"
                  type="text"
                  placeholder={t.assignWorkspacePlaceholder}
                  value={assignWorkspacePath}
                  onChange={(e) => setAssignWorkspacePath(e.target.value)}
                  required
                />
                <button type="submit" disabled={assigning}>
                  {assigning ? t.assignSubmitting : t.assignSubmit}
                </button>
                {assignError && (
                  <div className="form-error" role="alert">
                    {assignError}
                  </div>
                )}
                {assignBusyPending && assignBusyPending.agentId === selectedAgent.id && (
                  <div className="assign-busy-warning" role="alert">
                    <p>{t.assignBusyWarning(selectedAgent.id, t.agentStateLabel(selectedAgent.state))}</p>
                    <div className="assign-busy-actions">
                      <button
                        type="button"
                        onClick={() =>
                          void runAssign(
                            assignBusyPending.agentId,
                            assignBusyPending.description,
                            assignBusyPending.workspacePath,
                            true
                          )
                        }
                        disabled={assigning}
                      >
                        {t.assignBusyQueueButton}
                      </button>
                      <button type="button" className="assign-busy-cancel" onClick={() => setAssignBusyPending(null)}>
                        {t.assignBusyCancelButton}
                      </button>
                    </div>
                  </div>
                )}
              </form>

              <dl>
                <dt>{t.detailRuntime}</dt>
                <dd>{t.runtimeLabel(selectedAgent.runtime)}</dd>
                {selectedAgent.runtime === "claude-code" && (
                  <>
                    <dt>{t.detailBackend}</dt>
                    <dd>
                      {selectedAgent.backendProfile && selectedAgent.backendProfile !== "official"
                        ? (backendProfiles.find((p) => p.id === selectedAgent.backendProfile)?.label ?? selectedAgent.backendProfile)
                        : t.officialBackend}
                    </dd>
                    <dt>{t.detailApiFormat}</dt>
                    <dd>
                      {selectedAgent.backendProfile && selectedAgent.backendProfile !== "official"
                        ? (() => {
                            const format = backendProfiles.find((p) => p.id === selectedAgent.backendProfile)?.apiFormat;
                            return format ? t.apiFormatLabel(format) : t.apiFormatUnknown;
                          })()
                        : t.apiFormatLabel("anthropic")}
                    </dd>
                  </>
                )}
                <dt>{t.detailState}</dt>
                <dd>{t.agentStateLabel(selectedAgent.state)}</dd>
                <dt>{t.detailTask}</dt>
                <dd>{selectedAgent.currentTaskId ?? t.emptyValue}</dd>
                <dt>{t.detailWorkspace}</dt>
                <dd>{selectedAgent.workspace?.path ?? t.emptyValue}</dd>
                <dt>{t.detailEligibleFor}</dt>
                <dd>
                  {selectedAgent.eligibleCapabilities.length > 0
                    ? selectedAgent.eligibleCapabilities.map((cap) => t.capabilityLabel(cap)).join(", ")
                    : t.emptyValue}
                </dd>
                <dt>{t.detailGrantedNow}</dt>
                <dd>
                  {selectedAgent.capabilities.length > 0
                    ? selectedAgent.capabilities.map((cap) => t.capabilityLabel(cap)).join(", ")
                    : t.emptyValue}
                </dd>
              </dl>
              <h3>{t.liveCliOutput}</h3>
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
          <h2 id="queue-heading">{t.queueHeading(queueItems.length)}</h2>
          {queueItems.length === 0 && <div className="queue-empty">{t.queueEmpty}</div>}
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
                    <div className="queue-item-title">
                      {task.title} <span className={`task-source-badge task-source-${task.source}`}>{t.taskSourceLabel(task.source)}</span>
                    </div>
                    {task.pinnedAgentId && (
                      <div className="queue-item-meta">→ {task.pinnedAgentId}</div>
                    )}
                    {!task.pinnedAgentId && (
                      <div className="queue-item-meta">{t.queueNeeds(task.requiredCapabilities.map((cap) => t.capabilityLabel(cap)))}</div>
                    )}
                    {task.status === "pending" && (
                      <div className="queue-item-meta">
                        <strong>{t.queuePendingLabel}</strong>{" "}
                        {t.queuePendingDetail(Math.max(0, Math.round((now - new Date(task.createdAt).getTime()) / 1000)))}
                      </div>
                    )}
                    {task.status === "blocked" && (
                      <div className="queue-item-meta queue-item-tag-blocked">
                        <strong>{t.queueBlockedLabel}</strong> {t.queueBlockedDetail(depTitles)}
                      </div>
                    )}
                    {task.status === "blocked_failed_dependency" && (
                      <div className="queue-item-meta queue-item-tag-blocked-failed">
                        <strong>{t.queueBlockedFailedLabel}</strong>
                        {t.queueBlockedFailedDetail(depTitles)}
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
        defaultBackendProfile={defaultBackendProfile}
        masterBrain={masterBrain}
        agents={agents}
        onRefreshCredentials={() => fetchCredentialStatuses().then(setCredentialStatuses)}
      />
    </div>
  );
}
