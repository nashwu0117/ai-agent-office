import type { Agent, AgentState } from "../agent/types.js";
import type { Task, TaskStatus } from "../task/types.js";
import type { OfficeEvent } from "../events/types.js";
import type { RuntimeAdapter, RuntimeEvent } from "../runtime/adapter.js";
import type { WorkspaceGuard } from "../runtime/workspace-guard.js";
import { BackendProfileError } from "../credentials/backend-profile.js";

export interface SubmitTaskInput {
  description: string;
  workspacePath: string;
  title?: string;
  requiredCapabilities?: string[];
  /** Set by GoalCoordinator when this task is one of several decomposed from one Master-planned goal. */
  goalId?: string;
}

export interface AssignTaskInput {
  description: string;
  workspacePath: string;
  title?: string;
}

export interface SubmitTaskBatchItem {
  description: string;
  workspacePath: string;
  title?: string;
  requiredCapabilities?: string[];
  goalId?: string;
  /**
   * Indexes into this same batch array (not yet real task ids, since those
   * don't exist until the whole batch is created together) that this task
   * depends on. Already validated cycle-free by
   * resolveDependencies — the Orchestrator trusts it and does not re-check.
   */
  dependsOnIndexes?: number[];
}

export interface OrchestratorOptions {
  /** Maps agent.runtime (e.g. "claude-code", "opencode") to the adapter that runs it. */
  adapters: Record<string, RuntimeAdapter>;
  broadcast: (event: OfficeEvent) => void;
  /** Delay (ms) an agent lingers in "releasing" before going back to "available". */
  releaseDelayMs?: number;
  now?: () => string;
  idGen?: () => string;
  /**
   * Layer-1 safety net (see SECURITY.md): when set, every task execution is
   * bracketed by a snapshot of this guard's protected repo, checked for
   * out-of-workspace changes regardless of the worker process's own exit
   * code, and auto-reverted if found. Optional so tests/environments
   * without a protected repo to watch can omit it.
   */
  workspaceGuard?: WorkspaceGuard;
}

let counter = 0;
function defaultIdGen(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function isSubset(required: string[], eligible: string[]): boolean {
  return required.every((c) => eligible.includes(c));
}

/**
 * Serializes access to a resource keyed by string (here: a workspace path)
 * without blocking unrelated keys. acquire() resolves immediately if the
 * key is free, otherwise queues FIFO behind whoever holds it.
 */
class KeyedLock {
  private waiters = new Map<string, Array<() => void>>();
  private held = new Set<string>();

  acquire(key: string): { ready: Promise<void>; isImmediate: boolean } {
    if (!this.held.has(key)) {
      this.held.add(key);
      return { ready: Promise.resolve(), isImmediate: true };
    }
    const ready = new Promise<void>((resolve) => {
      const queue = this.waiters.get(key) ?? [];
      queue.push(resolve);
      this.waiters.set(key, queue);
    });
    return { ready, isImmediate: false };
  }

  release(key: string): void {
    const queue = this.waiters.get(key);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      next(); // hands the lock straight to the next waiter, still held
      return;
    }
    this.held.delete(key);
  }
}

/**
 * Owns agent/task state and the state-machine transitions described in the
 * spec. It only ever talks to a RuntimeAdapter, never to a child_process
 * directly, so process management stays out of orchestration logic.
 *
 * Dispatch is re-evaluated (scheduleDispatch) every time a task is
 * submitted and every time an agent frees up, so any number of
 * pending tasks x available agents can be matched concurrently — there is
 * no single global lock serializing the whole office to one task at a time.
 * A separate per-workspacePath KeyedLock stops two agents from ever running
 * a CLI process against the same directory at once, independent of agent
 * assignment.
 */
export class Orchestrator {
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private readonly adapters: Record<string, RuntimeAdapter>;
  private readonly broadcast: (event: OfficeEvent) => void;
  private readonly releaseDelayMs: number;
  private readonly now: () => string;
  private readonly workspaceLock = new KeyedLock();
  private readonly workspaceGuard?: WorkspaceGuard;

  constructor(options: OrchestratorOptions) {
    this.adapters = options.adapters;
    this.broadcast = options.broadcast;
    this.releaseDelayMs = options.releaseDelayMs ?? 1500;
    this.now = options.now ?? (() => new Date().toISOString());
    this.workspaceGuard = options.workspaceGuard;
  }

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  listAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * v0.10: repoints an already-registered agent at a different backend
   * profile (or back to "official" via undefined) from the management UI,
   * with no server restart — the next task dispatched to this agent reads
   * agent.backendProfile fresh (see runTask -> adapter.start ->
   * resolveBackendEnv), so this takes effect starting with that next
   * dispatch. Does not touch a task this agent is already running.
   */
  setAgentBackendProfile(agentId: string, backendProfile: string | undefined): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent "${agentId}"`);
    }
    agent.backendProfile = backendProfile;
    agent.updatedAt = this.now();
    this.broadcast({ type: "agent_backend_profile_changed", agentId, backendProfile });
    return agent;
  }

  /**
   * Keeps a stopped backend's agents registered (so assignments/history are
   * not lost) while removing them from dispatch and the live office floor.
   * Re-enabling immediately re-runs dispatch for any pending work.
   */
  setAgentEnabled(agentId: string, enabled: boolean): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent "${agentId}"`);
    if ((agent.enabled !== false) === enabled) return agent;
    agent.enabled = enabled;
    agent.updatedAt = this.now();
    this.broadcast({ type: "agent_enabled_changed", agentId, enabled });
    if (enabled) this.scheduleDispatch();
    return agent;
  }

  listTasks(): Task[] {
    return [...this.tasks.values()];
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  private setAgentState(agent: Agent, state: AgentState, taskId?: string): void {
    agent.state = state;
    agent.updatedAt = this.now();
    if (taskId !== undefined) agent.currentTaskId = taskId;
    if (state === "available") {
      agent.currentTaskId = undefined;
      agent.capabilities = [];
      agent.workspace = undefined;
    }
    this.broadcast({
      type: "agent_state_changed",
      agentId: agent.id,
      state,
      taskId: agent.currentTaskId,
      capabilities: agent.capabilities,
      workspacePath: agent.workspace?.path,
    });
  }

  private setTaskStatus(task: Task, status: TaskStatus): void {
    task.status = status;
    task.updatedAt = this.now();
    this.broadcast({ type: "task_updated", task });
  }

  async submitTask(input: SubmitTaskInput): Promise<Task> {
    const task: Task = {
      id: defaultIdGen("task"),
      title: input.title ?? input.description.slice(0, 60),
      description: input.description,
      workspacePath: input.workspacePath,
      requiredCapabilities: input.requiredCapabilities ?? [],
      status: "pending",
      source: "auto",
      goalId: input.goalId,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.tasks.set(task.id, task);
    this.broadcast({ type: "task_updated", task });

    this.scheduleDispatch();

    return task;
  }

  /**
   * v0.22 Part A: hands a task directly to `agentId`, bypassing
   * isSubset/eligibleCapabilities matching entirely — the user is pointing at
   * a specific employee, not describing what capability the work needs. The
   * task starts "pending" like any other and is picked up by the very next
   * scheduleDispatch, but scheduleDispatch's pinnedAgentId branch (below)
   * means it can only ever be dispatched to this one agent. If that agent is
   * currently busy, this simply queues behind whatever they're already
   * doing — acting as a personal, per-agent FIFO queue with no separate data
   * structure, since the global pending-task scan already re-checks it on
   * every dispatch cycle. Throws only for an unknown agent id; a busy agent
   * is never an error here; a caller that wants "warn me, then let me choose
   * queue-or-cancel" (see build prompt Part A.2) makes that decision before
   * calling this, using the agent state it already has client-side.
   */
  assignTaskToAgent(agentId: string, input: AssignTaskInput): Task {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent "${agentId}"`);
    }
    if (agent.enabled === false) {
      throw new Error(`Agent "${agentId}" is offline because its backend profile is stopped.`);
    }
    const task: Task = {
      id: defaultIdGen("task"),
      title: input.title ?? input.description.slice(0, 60),
      description: input.description,
      workspacePath: input.workspacePath,
      requiredCapabilities: [],
      status: "pending",
      source: "manual",
      pinnedAgentId: agentId,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.tasks.set(task.id, task);
    this.broadcast({ type: "task_updated", task });

    this.scheduleDispatch();

    return task;
  }

  /**
   * Creates every task in one Master-planned goal together, atomically,
   * before any of them can be dispatched — required because dependsOn needs
   * real ids that don't exist until the whole batch is created. A task with
   * one or more dependencies starts life "blocked" instead of "pending" so
   * scheduleDispatch's pending-only scan skips it until reconcileBlockedTasks
   * clears it.
   */
  submitTaskBatch(items: SubmitTaskBatchItem[]): Task[] {
    const createdAt = this.now();
    const tasks: Task[] = items.map((input) => ({
      id: defaultIdGen("task"),
      title: input.title ?? input.description.slice(0, 60),
      description: input.description,
      workspacePath: input.workspacePath,
      requiredCapabilities: input.requiredCapabilities ?? [],
      status: "pending",
      source: "master",
      goalId: input.goalId,
      createdAt,
      updatedAt: createdAt,
    }));

    items.forEach((input, i) => {
      const dependsOn = (input.dependsOnIndexes ?? []).map((idx) => tasks[idx].id);
      if (dependsOn.length > 0) {
        tasks[i].dependsOn = dependsOn;
        tasks[i].status = "blocked";
      }
    });

    for (const task of tasks) {
      this.tasks.set(task.id, task);
      this.broadcast({ type: "task_updated", task });
    }

    this.scheduleDispatch();
    return tasks;
  }

  /**
   * Re-scans every "blocked" task after a task settles (done/failed) and
   * moves it forward: to "pending" once every dependency is "done", or to
   * "blocked_failed_dependency" — permanently, visibly, never silently
   * dropped — as soon as any dependency is "failed" or itself
   * "blocked_failed_dependency" (so a failure cascades down a dependency
   * chain in one pass rather than leaving later tasks stuck in "blocked"
   * forever). Looped because clearing one task can immediately satisfy or
   * fail the next one in the same chain.
   */
  private reconcileBlockedTasks(): void {
    let changed = true;
    let anyPending = false;
    while (changed) {
      changed = false;
      for (const task of this.tasks.values()) {
        if (task.status !== "blocked") continue;
        const deps = (task.dependsOn ?? [])
          .map((id) => this.tasks.get(id))
          .filter((t): t is Task => t !== undefined);

        if (deps.some((d) => d.status === "failed" || d.status === "blocked_failed_dependency")) {
          this.setTaskStatus(task, "blocked_failed_dependency");
          changed = true;
        } else if (deps.every((d) => d.status === "done")) {
          this.setTaskStatus(task, "pending");
          anyPending = true;
          changed = true;
        }
      }
    }
    if (anyPending) this.scheduleDispatch();
  }

  /**
   * Re-scans pending tasks against available agents and fires off every
   * match it can find in one pass. Called after a submit and after any
   * agent becomes available again — never serialized behind a single
   * in-flight task, so N matches can start in the same tick.
   *
   * v0.22: a task with pinnedAgentId (see assignTaskToAgent) skips
   * isSubset/eligibleCapabilities matching entirely and is only ever
   * considered against that one named agent — this is what makes a pinned
   * task behave like a personal queue: it just stays "pending" (unmatched)
   * every cycle until that specific agent is "available" again, however many
   * other agents free up in the meantime.
   */
  private scheduleDispatch(): void {
    const pending = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const task of pending) {
      const agent = task.pinnedAgentId
        ? this.agents.get(task.pinnedAgentId)
        : [...this.agents.values()].find(
            (a) => a.enabled !== false && a.state === "available" && isSubset(task.requiredCapabilities, a.eligibleCapabilities)
          );
      if (!agent || agent.enabled === false || agent.state !== "available") continue;

      task.assignedAgentId = agent.id;
      agent.capabilities = task.requiredCapabilities;
      this.setTaskStatus(task, "assigned");
      this.setAgentState(agent, "assigned", task.id);

      void this.runTask(task, agent);
    }
  }

  private async runTask(task: Task, agent: Agent): Promise<void> {
    const startedAt = Date.now();

    agent.workspace = { id: defaultIdGen("ws"), path: task.workspacePath };
    this.setAgentState(agent, "starting", task.id);

    const { ready, isImmediate } = this.workspaceLock.acquire(task.workspacePath);
    if (!isImmediate) {
      // Another task already owns this workspacePath; this agent is
      // committed to the task but must not touch the directory yet.
      this.setAgentState(agent, "waiting", task.id);
      this.setTaskStatus(task, "waiting");
    }
    await ready;

    // Layer-1 baseline (see SECURITY.md): snapshot the protected repo right
    // before execution starts so any change observed after can be attributed
    // to this task specifically, not to unrelated work happening elsewhere.
    let guardBaseline: string[] | null = null;
    if (this.workspaceGuard) {
      guardBaseline = await this.workspaceGuard.snapshot().catch(() => null);
    }

    try {
      const adapter = this.adapters[agent.runtime];
      if (!adapter) {
        throw new Error(`No RuntimeAdapter registered for runtime "${agent.runtime}"`);
      }
      const handle = await adapter.start(task, agent);

      this.setTaskStatus(task, "in_progress");
      this.setAgentState(agent, "working", task.id);

      const filesChanged = new Set<string>();
      let lastErrorMessage: string | undefined;

      handle.onEvent((event: RuntimeEvent) => {
        this.broadcast({
          type: "agent_task_progress",
          agentId: agent.id,
          message: event.message,
          eventType: event.type,
          stream: event.stream,
          timestamp: event.timestamp,
        });
        const maybeFile = extractFilePath(event.message);
        if (maybeFile) filesChanged.add(maybeFile);
        if (event.type === "error") lastErrorMessage = event.message;
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        handle.onExit(resolve);
      });

      const durationMs = Date.now() - startedAt;

      // Checked regardless of exit code: a worker can exit 0 after writing
      // somewhere it shouldn't have (that's exactly what happened in the
      // incident this guard exists to catch) — a clean exit code alone is
      // never sufficient evidence the task stayed inside its workspace.
      const violation =
        this.workspaceGuard && guardBaseline
          ? await this.workspaceGuard.checkAndCapture(guardBaseline, task.workspacePath).catch(() => null)
          : null;

      if (violation) {
        const reason =
          `Workspace isolation violation: execution modified ${violation.paths.length} path(s) ` +
          `outside its assigned workspacePath (auto-reverted): ${violation.paths.join(", ")}`;
        task.resultSummary = reason;
        task.resultFilesChanged = [];
        this.setTaskStatus(task, "failed");
        this.setAgentState(agent, "error", task.id);
        this.broadcast({
          type: "task_failed",
          taskId: task.id,
          agentId: agent.id,
          reason,
          securityViolation: true,
          affectedPaths: violation.paths,
        });
      } else if (exitCode === 0) {
        const summary = `Completed "${task.title}" in ${(durationMs / 1000).toFixed(1)}s`;
        task.resultSummary = summary;
        task.resultFilesChanged = [...filesChanged];
        this.setTaskStatus(task, "done");
        this.setAgentState(agent, "done", task.id);
        this.broadcast({
          type: "task_completed",
          taskId: task.id,
          agentId: agent.id,
          summary,
          filesChanged: [...filesChanged],
        });
      } else {
        // A worker CLI failing outright (vs. a normal logic error) because
        // its credential is missing/invalid is common enough (see
        // CredentialRouter) to deserve its own reason, distinct from a plain
        // nonzero exit — the message alone doesn't tell an operator whether
        // re-running with a fixed credential would help. This is a stderr
        // heuristic only, not a structured error classification.
        const authFailure = isAuthFailureMessage(lastErrorMessage);
        const reason = authFailure
          ? `Authentication failed while running "${agent.runtime}": ${lastErrorMessage}`
          : `Process exited with code ${exitCode}`;
        task.resultSummary = reason;
        task.resultFilesChanged = [...filesChanged];
        this.setTaskStatus(task, "failed");
        this.setAgentState(agent, "error", task.id);
        this.broadcast({
          type: "task_failed",
          taskId: task.id,
          agentId: agent.id,
          reason,
          authFailure: authFailure || undefined,
        });
      }
    } catch (err) {
      task.resultSummary = err instanceof Error ? err.message : String(err);
      this.setTaskStatus(task, "failed");
      this.setAgentState(agent, "error", task.id);
      // A BackendProfileError (see credentials/backend-profile.ts) is thrown
      // by the adapter before any process was even spawned — a server
      // configuration problem, not the provider rejecting a credential it
      // was actually sent. Surfaced distinctly so an operator doesn't
      // mistake "agent-02's backend profile isn't set up" for an ordinary
      // task/logic failure, and so it never silently falls back to the
      // official credential.
      const backendProfileError = err instanceof BackendProfileError;
      this.broadcast({
        type: "task_failed",
        taskId: task.id,
        agentId: agent.id,
        reason: err instanceof Error ? err.message : String(err),
        backendProfileError: backendProfileError || undefined,
      });
    } finally {
      this.workspaceLock.release(task.workspacePath);
    }

    // task.status is now a terminal "done"/"failed" set by one of the
    // branches above — safe to see whether any sibling was waiting on it.
    this.reconcileBlockedTasks();

    await new Promise((resolve) => setTimeout(resolve, this.releaseDelayMs));
    this.setAgentState(agent, "releasing", task.id);
    await new Promise((resolve) => setTimeout(resolve, this.releaseDelayMs));
    this.setAgentState(agent, "available");

    this.scheduleDispatch();
  }
}

function extractFilePath(message: string): string | undefined {
  const match = message.match(/Using (?:Edit|MultiEdit|Write|NotebookEdit):\s*([^\s|]+)/i);
  return match?.[1];
}

// Deliberately loose: worker CLIs are third-party processes whose stderr
// wording isn't a stable contract, so this only needs to catch the common
// shapes (see v0.7 scope notes) rather than classify every possible cause.
const AUTH_FAILURE_PATTERN =
  /\b(401|403)\b|unauthorized|invalid[_ -]?api[_ -]?key|invalid[_ -]?x-api-key|authentication_error|permission_error|not logged in|please (?:run|log ?in)/i;

function isAuthFailureMessage(message: string | undefined): boolean {
  return message !== undefined && AUTH_FAILURE_PATTERN.test(message);
}
