import type { Agent, AgentState } from "../agent/types.js";
import type { Task } from "../task/types.js";
import type { OfficeEvent } from "../events/types.js";
import type { RuntimeAdapter, RuntimeEvent } from "../runtime/adapter.js";

export interface SubmitTaskInput {
  description: string;
  workspacePath: string;
  title?: string;
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

/**
 * Owns agent/task state and the state-machine transitions described in the
 * spec. It only ever talks to a RuntimeAdapter, never to a child_process
 * directly, so process management stays out of orchestration logic.
 */
export class Orchestrator {
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private readonly adapter: RuntimeAdapter;
  private readonly broadcast: (event: OfficeEvent) => void;
  private readonly releaseDelayMs: number;
  private readonly now: () => string;

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
    if (state === "available") agent.currentTaskId = undefined;
    this.broadcast({ type: "agent_state_changed", agentId: agent.id, state, taskId: agent.currentTaskId });
  }

  async submitTask(input: SubmitTaskInput): Promise<Task> {
    const agent = [...this.agents.values()].find((a) => a.state === "available");
    if (!agent) {
      throw new Error("No available worker: all agents are busy");
    }

    const task: Task = {
      id: defaultIdGen("task"),
      title: input.title ?? input.description.slice(0, 60),
      description: input.description,
      workspacePath: input.workspacePath,
      status: "pending",
      assignedAgentId: agent.id,
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    this.tasks.set(task.id, task);

    agent.workspace = { id: defaultIdGen("ws"), path: input.workspacePath };

    task.status = "assigned";
    this.setAgentState(agent, "assigned", task.id);

    this.setAgentState(agent, "starting", task.id);

    // Fire and forget: the run happens asynchronously, progress + completion
    // are reported purely through the broadcast() event stream.
    void this.runTask(task, agent);

    return task;
  }

  private async runTask(task: Task, agent: Agent): Promise<void> {
    const startedAt = Date.now();
    try {
      const handle = await this.adapter.start(task, agent);

      task.status = "in_progress";
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
        task.status = "done";
        task.updatedAt = this.now();
        this.setAgentState(agent, "done", task.id);
        this.broadcast({
          type: "task_completed",
          taskId: task.id,
          agentId: agent.id,
          summary: `Completed "${task.title}" in ${(durationMs / 1000).toFixed(1)}s`,
          filesChanged: [...filesChanged],
        });
      } else {
        task.status = "failed";
        task.updatedAt = this.now();
        this.setAgentState(agent, "error", task.id);
        this.broadcast({
          type: "task_failed",
          taskId: task.id,
          agentId: agent.id,
          reason: `Process exited with code ${exitCode}`,
        });
      }
    } catch (err) {
      task.status = "failed";
      task.updatedAt = this.now();
      this.setAgentState(agent, "error", task.id);
      this.broadcast({
        type: "task_failed",
        taskId: task.id,
        agentId: agent.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, this.releaseDelayMs));
    this.setAgentState(agent, "releasing", task.id);
    await new Promise((resolve) => setTimeout(resolve, this.releaseDelayMs));
    agent.workspace = undefined;
    this.setAgentState(agent, "available");
  }
}

function extractFilePath(message: string): string | undefined {
  const match = message.match(/Using (?:Edit|MultiEdit|Write|NotebookEdit):\s*([^\s|]+)/i);
  return match?.[1];
}
