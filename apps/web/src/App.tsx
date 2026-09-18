import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentHandoff, BackendProfileClientInfo, CredentialSourceStatus, Task } from "@ai-office/core";
import { KNOWN_CAPABILITIES } from "@ai-office/core";
import { OfficeClient, assignTaskToAgent, fetchCredentialStatuses, submitGoal, submitTask } from "./ws/client.js";
import { OfficeScene } from "./office/OfficeScene.js";
import { BackendProfilesPanel } from "./BackendProfilesPanel.js";
import { useLanguage } from "./i18n/language-context.js";
import { LanguageToggle } from "./i18n/LanguageToggle.js";
import { useAuthRequired } from "./AuthGate.js";
import { logout } from "./auth-client.js";
import { addRecentWorkspacePath, getRecentWorkspacePaths } from "./recent-paths.js";
import { WorkspacePathInput } from "./WorkspacePathInput.js";
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
  const folderBrowserLabels = {
    title: t.folderBrowserTitle,
    up: t.folderBrowserUp,
    select: t.folderBrowserSelect,
    cancel: t.folderBrowserCancel,
    loading: t.folderBrowserLoading,
    empty: t.folderBrowserEmpty,
    create: t.folderBrowserCreate,
    createPlaceholder: t.folderBrowserCreatePlaceholder,
    createPrompt: t.folderBrowserCreatePrompt,
  };
  const authRequired = useAuthRequired();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasksById, setTasksById] = useState<Record<string, Task>>({});
  const [logsByAgent, setLogsByAgent] = useState<Record<string, LogLine[]>>({});
  const [completions, setCompletions] = useState<CompletionCard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMaster, setSelectedMaster] = useState(false);
  const [description, setDescription] = useState("");
  const [workspacePath, setWorkspacePath] = useState("");
  const [recentWorkspacePaths, setRecentWorkspacePaths] = useState<string[]>(() => getRecentWorkspacePaths());
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
  const [masterBrainModels, setMasterBrainModels] = useState<Partial<Record<"claude-code" | "codex", string>>>({});
  const [handoffs, setHandoffs] = useState<AgentHandoff[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<number | null>(null);
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
        setMasterBrainModels(msg.masterBrainModels ?? {});
        setHandoffs(msg.handoffs ?? []);
        setAnnouncement(tRef.current.announceSnapshot(msg.agents.length, msg.tasks.length));
        return;
      }

      if (msg.type === "master_brain_changed") {
        setMasterBrainState(msg.masterBrain === "codex" ? "codex" : "claude-code");
        setMasterBrainModels(msg.models as Partial<Record<"claude-code" | "codex", string>>);
        return;
      }

      if (msg.type === "agent_handoff") {
        setHandoffs((prev) => [...prev, msg.handoff].slice(-50));
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

  // v0.22 Part C: replaces the earlier goalId/workspace-sharing heuristic —
  // meeting-room visits are now driven by real HandoffCoordinator events
  // (packages/core/src/collaboration/handoff-coordinator.ts), each carrying
  // actual from/to agent ids, task titles, and message text. Assignment to
  // one of the 3 fixed rooms is greedy-round-robin by whichever room frees
  // up soonest, computed once per new handoff (not per render): a room is
  // "busy" for ROOM_VISUAL_DURATION_MS from the later of (the handoff's own
  // createdAt, that room's previous occupant's end time), so a burst of more
  // than 3 concurrent handoffs queues onto whichever room empties first
  // instead of overlapping. This is purely a presentation-layer schedule —
  // the handoff itself already happened and the dependent task was already
  // dispatched by the time this runs (see HandoffCoordinator's own note on
  // never slowing down v0.6 dependency dispatch); this only decides when/
  // where the *visit* plays out on screen. A fixed few-second visit (rather
  // than requiring the room to truly be free before an agent can "arrive")
  // was chosen so a burst of handoffs can never turn into a real backlog —
  // see the build prompt's own explicit tradeoff callout in Part C.2.
  const ROOM_COUNT = 3;
  const ROOM_VISUAL_DURATION_MS = 6000;
  const roomSchedule = useMemo(() => {
    const roomNextAvailable = new Array(ROOM_COUNT).fill(0);
    const sorted = [...handoffs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return sorted.map((handoff) => {
      let room = 0;
      for (let i = 1; i < ROOM_COUNT; i++) {
        if (roomNextAvailable[i] < roomNextAvailable[room]) room = i;
      }
      const arrivalMs = new Date(handoff.createdAt).getTime();
      const startAt = Math.max(arrivalMs, roomNextAvailable[room]);
      const endAt = startAt + ROOM_VISUAL_DURATION_MS;
      roomNextAvailable[room] = endAt;
      return { handoff, room, startAt, endAt };
    });
  }, [handoffs]);

  const collaborationRoomByAgent = useMemo(() => {
    const result: Record<string, number> = {};
    for (const s of roomSchedule) {
      if (now >= s.startAt && now < s.endAt) {
        result[s.handoff.fromAgentId] = s.room;
        result[s.handoff.toAgentId] = s.room;
      }
    }
    return result;
  }, [roomSchedule, now]);

  const roomBusy = useMemo(() => {
    const busy = [false, false, false];
    for (const s of roomSchedule) {
      if (now >= s.startAt && now < s.endAt) busy[s.room] = true;
    }
    return busy;
  }, [roomSchedule, now]);

  // The most recently scheduled handoff for each room — shown by the
  // click-to-view panel whether that room is currently in session or idle
  // (build prompt Part C.4: "this room's current round, or its most recent").
  const roomLatestHandoff = useMemo(() => {
    const latest: Array<AgentHandoff | undefined> = [undefined, undefined, undefined];
    for (const s of roomSchedule) latest[s.room] = s.handoff;
    return latest;
  }, [roomSchedule]);

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

  // v0.22 Part D: drives the Master character's visible planning state in
  // the office scene — true for as long as any goal is still in Master's
  // plan() call (v0.5's existing "planning" status), independent of how many
  // goals are queued.
  const masterPlanning = useMemo(() => Object.values(goalsById).some((g) => g.status === "planning"), [goalsById]);

  const availableCredentialCount = credentialStatuses.filter((s) => s.available).length;
  const credentialStatusLabel = credentialStatuses
    .map((status) => t.credentialDetailLine(status.provider, status.id, status.available))
    .join(". ");

  // v0.24 hotfix: whichever element (accessible agent/room button, or the
  // detail panel's own close button) had focus right before opening the
  // detail panel — restored on close so keyboard/screen-reader users land
  // back where they were instead of losing focus into the document body.
  const lastPanelTriggerRef = useRef<HTMLElement | null>(null);
  const detailPanelOpenRef = useRef(false);

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const selectedAgentTask = useMemo(() => {
    if (!selectedAgent) return null;
    if (selectedAgent.currentTaskId) return tasksById[selectedAgent.currentTaskId] ?? null;
    return (
      Object.values(tasksById)
        .filter((task) => task.assignedAgentId === selectedAgent.id && task.status !== "done" && task.status !== "failed")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }, [selectedAgent, tasksById]);
  useEffect(() => {
    const isOpen = Boolean(selectedAgent) || selectedMaster || selectedRoom !== null;
    if (detailPanelOpenRef.current && !isOpen) {
      const trigger = lastPanelTriggerRef.current;
      if (trigger && document.body.contains(trigger)) trigger.focus();
      lastPanelTriggerRef.current = null;
    }
    detailPanelOpenRef.current = isOpen;
  }, [selectedAgent, selectedMaster, selectedRoom]);

  const masterTasks = useMemo(
    () => Object.values(tasksById).filter((task) => task.source === "master").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasksById]
  );

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
      setRecentWorkspacePaths(addRecentWorkspacePath(workspacePath));
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
      setRecentWorkspacePaths(addRecentWorkspacePath(goalWorkspacePath));
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
      setRecentWorkspacePaths(addRecentWorkspacePath(workspacePathValue));
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
            roomBusy={roomBusy}
            masterPlanning={masterPlanning}
            selectedId={selectedId}
            selectedMaster={selectedMaster}
            onSelect={(id) => {
              lastPanelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setSelectedMaster(false);
              setSelectedRoom(null);
              setSelectedId(id);
            }}
            onSelectMaster={() => {
              lastPanelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setSelectedId(null);
              setSelectedRoom(null);
              setSelectedMaster(true);
            }}
            selectedRoom={selectedRoom}
            onSelectRoom={(room) => {
              lastPanelTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              setSelectedId(null);
              setSelectedRoom(room);
            }}
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
            <WorkspacePathInput
              id="goal-workspace-path"
              placeholder={t.goalWorkspacePlaceholder}
              value={goalWorkspacePath}
              onChange={setGoalWorkspacePath}
              recentPaths={recentWorkspacePaths}
              recentPathsLabel={t.recentWorkspacePathsLabel}
              recentPathsEmptyHint={t.recentWorkspacePathsEmptyHint}
              browseLabel={t.browseFolderLabel}
              folderBrowserLabels={folderBrowserLabels}
              ariaInvalid={Boolean(goalFormError)}
              ariaDescribedBy={goalFormError ? "goal-form-error" : undefined}
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
            <WorkspacePathInput
              id="task-workspace-path"
              placeholder={t.taskWorkspacePlaceholder}
              value={workspacePath}
              onChange={setWorkspacePath}
              recentPaths={recentWorkspacePaths}
              recentPathsLabel={t.recentWorkspacePathsLabel}
              recentPathsEmptyHint={t.recentWorkspacePathsEmptyHint}
              browseLabel={t.browseFolderLabel}
              folderBrowserLabels={folderBrowserLabels}
              ariaInvalid={Boolean(formError)}
              ariaDescribedBy={formError ? "task-form-error" : undefined}
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

        <aside
          className={`detail-panel ${selectedAgent || selectedMaster || selectedRoom !== null ? "open" : ""}`}
          aria-label={t.agentDetailsAriaLabel}
        >
          {selectedRoom !== null && (
            <>
              <div className="detail-panel-header-row">
                <h2>{t.meetingRoomPanelHeading(selectedRoom + 1)}</h2>
                <button type="button" className="bp-close" onClick={() => setSelectedRoom(null)} aria-label={t.closeMeetingRoomPanel}>
                  ✕
                </button>
              </div>
              {roomLatestHandoff[selectedRoom] ? (
                <>
                  <dl>
                    <dt>{t.meetingRoomFromLabel}</dt>
                    <dd>{roomLatestHandoff[selectedRoom]!.fromAgentId}</dd>
                    <dt>{t.meetingRoomToLabel}</dt>
                    <dd>{roomLatestHandoff[selectedRoom]!.toAgentId}</dd>
                    <dt>{t.meetingRoomHandoffTaskLabel}</dt>
                    <dd>
                      {roomLatestHandoff[selectedRoom]!.fromTaskTitle} → {roomLatestHandoff[selectedRoom]!.toTaskTitle}
                    </dd>
                    <dt>{t.meetingRoomTimeLabel}</dt>
                    <dd>{new Date(roomLatestHandoff[selectedRoom]!.createdAt).toLocaleTimeString()}</dd>
                  </dl>
                  <h3>{t.meetingRoomMessageLabel}</h3>
                  <div className="cli-log">
                    <div className="cli-log-line">{roomLatestHandoff[selectedRoom]!.message}</div>
                  </div>
                </>
              ) : (
                <p className="assign-form-hint">{t.meetingRoomNoTranscript}</p>
              )}
            </>
          )}
          {selectedMaster && (
            <>
              <div className="detail-panel-header-row">
                <h2>{t.masterCharacterLabel}</h2>
                <button type="button" className="bp-close" onClick={() => setSelectedMaster(false)} aria-label={t.closeMasterPanel}>
                  ✕
                </button>
              </div>
              <dl>
                <dt>{t.masterDetailStatus}</dt>
                <dd>{masterPlanning ? t.masterPlanningBubble : t.masterIdleBubble}</dd>
                <dt>{t.masterDetailBackend}</dt>
                <dd>{t.masterBrainOptionLabel(masterBrain)}</dd>
                <dt>{t.masterDetailModel}</dt>
                <dd>{masterBrainModels[masterBrain] ?? t.emptyValue}</dd>
              </dl>
              <h3>{t.masterDetailCurrentGoals}</h3>
              {goalsSorted.length === 0 ? (
                <p className="assign-form-hint">{t.masterDetailNoGoals}</p>
              ) : (
                <div className="cli-log">
                  {goalsSorted.slice(0, 8).map((goal) => (
                    <div key={goal.goalId} className="cli-log-line">
                      <strong>{goal.status === "planning" ? t.masterPlanningBubble : goal.status}</strong> — {goal.goal}
                      {goal.workspacePath ? <><br /><span className="completion-meta">{goal.workspacePath}</span></> : null}
                    </div>
                  ))}
                </div>
              )}
              <h3>{t.masterDetailTasks}</h3>
              {masterTasks.length === 0 ? (
                <p className="assign-form-hint">{t.masterDetailNoTasks}</p>
              ) : (
                <div className="cli-log">
                  {masterTasks.slice(0, 12).map((task) => (
                    <div key={task.id} className="cli-log-line">
                      <strong>{task.title}</strong> — {t.taskStatusLabel(task.status)}
                      {task.assignedAgentId ? <><br /><span className="completion-meta">→ {task.assignedAgentId}</span></> : null}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {selectedAgent && (
            <>
              <h2>{selectedAgent.id}</h2>

              <section className="detail-current-task" aria-label={t.detailCurrentWork}>
                <h3>{t.detailCurrentWork}</h3>
                {selectedAgentTask ? (
                  <>
                    <strong>{selectedAgentTask.title}</strong>
                    <p>{selectedAgentTask.description}</p>
                    <dl>
                      <dt>{t.detailTaskStatus}</dt>
                      <dd>{t.taskStatusLabel(selectedAgentTask.status)}</dd>
                      <dt>{t.detailTaskSource}</dt>
                      <dd>{t.taskSourceLabel(selectedAgentTask.source)}</dd>
                      <dt>{t.detailWorkspace}</dt>
                      <dd>{selectedAgentTask.workspacePath}</dd>
                    </dl>
                  </>
                ) : (
                  <p className="assign-form-hint">{t.emptyValue}</p>
                )}
              </section>

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
                <WorkspacePathInput
                  id="assign-workspace-path"
                  placeholder={t.assignWorkspacePlaceholder}
                  value={assignWorkspacePath}
                  onChange={setAssignWorkspacePath}
                  recentPaths={recentWorkspacePaths}
                  recentPathsLabel={t.recentWorkspacePathsLabel}
                  recentPathsEmptyHint={t.recentWorkspacePathsEmptyHint}
                  browseLabel={t.browseFolderLabel}
                  folderBrowserLabels={folderBrowserLabels}
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
                const dependencyTasks = (task.dependsOn ?? [])
                  .map((id) => tasksById[id])
                  .filter((dependency): dependency is Task => Boolean(dependency));
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
                        <div className="queue-item-dependency-details">
                          {dependencyTasks.length > 0 ? (
                            dependencyTasks.map((dependency) => (
                              <div key={dependency.id}>
                                <strong>{dependency.title}</strong> — {t.taskStatusLabel(dependency.status)}
                                {dependency.assignedAgentId ? ` → ${dependency.assignedAgentId}` : ""}
                                {dependency.resultSummary ? `: ${dependency.resultSummary}` : ""}
                              </div>
                            ))
                          ) : (
                            <div>{t.queueDependencyDetailsUnavailable}</div>
                          )}
                        </div>
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
        masterBrainModels={masterBrainModels}
        agents={agents}
        onRefreshCredentials={() => fetchCredentialStatuses().then(setCredentialStatuses)}
      />
    </div>
  );
}
