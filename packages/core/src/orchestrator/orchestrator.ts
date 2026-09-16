import type { Agent, AgentState } from "../agent/types.js";
import type { Task, TaskStatus } from "../task/types.js";
import type { OfficeEvent } from "../events/types.js";
import type { RuntimeAdapter, RuntimeEvent } from "../runtime/adapter.js";

export interface SubmitTaskInput {
  description: string;
  workspacePath: string;
  title?: string;
  requiredCapabilities?: string[];
}

export interface OrchestratorOptions {
  adapter: RuntimeAdapter;
  broadcast: (event: OfficeEvent) => void;
  /** Delay (ms) an agent lingers in "releasing" before going back to "available". */
  releaseDelayMs?: number;
  now?: () => string;
  idGen?: () => string;
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
  private readonly adapter: RuntimeAdapter;
  private readonly broadcast: (event: OfficeEvent) => void;
  private readonly releaseDelayMs: number;
  private readonly now: () => string;
  private readonly workspaceLock = new KeyedLock();

  constructor(options: OrchestratorOptions) {
    this.adapter = options.adapter;
    this.broadcast = options.broadcast;
    this.releaseDelayMs = options.releaseDelayMs ?? 1500;
    this.now = options.now ?? (() => new Date().toISOString());
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

  listTasks(): Task[] {
    return [...this.tasks.values()];
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
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.tasks.set(task.id, task);
    this.broadcast({ type: "task_updated", task });

    this.scheduleDispatch();

    return task;
  }

  /**
   * Re-scans pending tasks against available agents and fires off every
   * match it can find in one pass. Called after a submit and after any
   * agent becomes available again — never serialized behind a single
   * in-flight task, so N matches can start in the same tick.
   */
  private scheduleDispatch(): void {
    const pending = [...this.tasks.values()]
      .filter((t) => t.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const task of pending) {
      const agent = [...this.agents.values()].find(
        (a) => a.state === "available" && isSubset(task.requiredCapabilities, a.eligibleCapabilities)
      );
      if (!agent) continue;

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

    try {
      const handle = await this.adapter.start(task, agent);

      this.setTaskStatus(task, "in_progress");
      this.setAgentState(agent, "working", task.id);

      const filesChanged = new Set<string>();

      handle.onEvent((event: RuntimeEvent) => {
        this.broadcast({ type: "agent_task_progress", agentId: agent.id, message: event.message });
        const maybeFile = extractFilePath(event.message);
        if (maybeFile) filesChanged.add(maybeFile);
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        handle.onExit(resolve);
      });

      const durationMs = Date.now() - startedAt;

      if (exitCode === 0) {
        this.setTaskStatus(task, "done");
        this.setAgentState(agent, "done", task.id);
        this.broadcast({
          type: "task_completed",
          taskId: task.id,
          agentId: agent.id,
          summary: `Completed "${task.title}" in ${(durationMs / 1000).toFixed(1)}s`,
          filesChanged: [...filesChanged],
        });
      } else {
        this.setTaskStatus(task, "failed");
        this.setAgentState(agent, "error", task.id);
        this.broadcast({
          type: "task_failed",
          taskId: task.id,
          agentId: agent.id,
          reason: `Process exited with code ${exitCode}`,
        });
      }
    } catch (err) {
      this.setTaskStatus(task, "failed");
      this.setAgentState(agent, "error", task.id);
      this.broadcast({
        type: "task_failed",
        taskId: task.id,
        agentId: agent.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.workspaceLock.release(task.workspacePath);
    }

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
