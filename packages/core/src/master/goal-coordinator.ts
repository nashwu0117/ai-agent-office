import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { OfficeEvent } from "../events/types.js";
import type { MasterBrain, TaskResultSummary } from "./brain.js";
import { resolveDependencies } from "./dependency-graph.js";

export interface GoalCoordinatorOptions {
  orchestrator: Orchestrator;
  master: MasterBrain;
  broadcast: (event: OfficeEvent) => void;
  idGen?: () => string;
}

interface TrackedGoal {
  goal: string;
  taskTitles: Map<string, string>;
  results: Map<string, TaskResultSummary>;
}

let counter = 0;
function defaultIdGen(): string {
  counter += 1;
  return `goal-${Date.now().toString(36)}-${counter}`;
}

/**
 * Sits beside the Orchestrator, not inside it: turns one high-level goal
 * into several v0.3/v0.4 Task submissions and, once every one of them has
 * settled, asks the MasterBrain for a summary. The Orchestrator's own
 * dispatch/matching/lock logic never has to know a "goal" exists — it only
 * ever sees plain Task objects that happen to share a goalId.
 */
export class GoalCoordinator {
  private readonly orchestrator: Orchestrator;
  private readonly master: MasterBrain;
  private readonly broadcast: (event: OfficeEvent) => void;
  private readonly idGen: () => string;
  private readonly goals = new Map<string, TrackedGoal>();

  constructor(options: GoalCoordinatorOptions) {
    this.orchestrator = options.orchestrator;
    this.master = options.master;
    this.broadcast = options.broadcast;
    this.idGen = options.idGen ?? defaultIdGen;
  }

  /** Kicks off async planning + dispatch and returns immediately with a goalId to track it by. */
  submitGoal(goal: string, workspacePath: string): { goalId: string } {
    const goalId = this.idGen();
    this.broadcast({ type: "goal_planning", goalId, goal, workspacePath });
    void this.runGoal(goalId, goal, workspacePath);
    return { goalId };
  }

  private async runGoal(goalId: string, goal: string, workspacePath: string): Promise<void> {
    let plannedTasks;
    try {
      plannedTasks = await this.master.plan(goal);
    } catch (err) {
      this.broadcast({
        type: "goal_failed",
        goalId,
        goal,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Cycle/dangling-reference check happens here, before a single real Task
    // exists — a plan that fails this must never reach the Orchestrator, since
    // it has no way to recover from a dependency deadlock once tasks exist.
    let resolved;
    try {
      resolved = resolveDependencies(plannedTasks);
    } catch (err) {
      this.broadcast({
        type: "goal_failed",
        goalId,
        goal,
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const tracked: TrackedGoal = { goal, taskTitles: new Map(), results: new Map() };
    this.goals.set(goalId, tracked);

    const tasks = this.orchestrator.submitTaskBatch(
      resolved.map((planned) => ({
        description: planned.description,
        workspacePath,
        title: planned.title,
        requiredCapabilities: planned.requiredCapabilities,
        goalId,
        dependsOnIndexes: planned.dependsOnIndexes,
      }))
    );
    tasks.forEach((task, i) => tracked.taskTitles.set(task.id, resolved[i].title));

    this.broadcast({ type: "goal_planned", goalId, goal, taskCount: resolved.length });
  }

  /**
   * Feed every OfficeEvent the Orchestrator broadcasts through here (in
   * addition to sending it on to clients as usual) so this coordinator can
   * tell when all subtasks of a tracked goal have settled.
   */
  observe(event: OfficeEvent): void {
    let settled: { taskId: string; result: TaskResultSummary } | undefined;

    if (event.type === "task_completed") {
      settled = {
        taskId: event.taskId,
        result: { title: "", status: "done", filesChanged: event.filesChanged, note: event.summary },
      };
    } else if (event.type === "task_failed") {
      settled = { taskId: event.taskId, result: { title: "", status: "failed", filesChanged: [], note: event.reason } };
    } else if (event.type === "task_updated" && event.task.status === "blocked_failed_dependency") {
      // This task will never run — its dependency failed — so it will never
      // emit a task_completed/task_failed of its own. Without this branch a
      // goal containing one would wait forever for a result that never
      // arrives; count it as a settled failure instead.
      settled = {
        taskId: event.task.id,
        result: {
          title: "",
          status: "failed",
          filesChanged: [],
          note: "Skipped: a task this one depends on failed.",
        },
      };
    } else {
      return;
    }

    const { taskId, result } = settled;

    for (const [goalId, tracked] of this.goals) {
      const title = tracked.taskTitles.get(taskId);
      if (title === undefined) continue;
      if (tracked.results.has(taskId)) return; // already settled via an earlier event for this task

      tracked.results.set(taskId, { ...result, title });

      if (tracked.results.size === tracked.taskTitles.size) {
        this.goals.delete(goalId);
        void this.finishGoal(goalId, tracked);
      }
      return;
    }
  }

  private async finishGoal(goalId: string, tracked: TrackedGoal): Promise<void> {
    const results = [...tracked.results.values()];
    let summary: string;
    try {
      summary = await this.master.summarize(tracked.goal, results);
    } catch (err) {
      summary = `Master summary unavailable: ${err instanceof Error ? err.message : String(err)}`;
    }
    this.broadcast({ type: "goal_summary", goalId, goal: tracked.goal, summary });
  }
}
