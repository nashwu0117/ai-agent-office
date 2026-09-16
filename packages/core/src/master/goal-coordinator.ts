import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { OfficeEvent } from "../events/types.js";
import type { MasterBrain, TaskResultSummary } from "./brain.js";

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

    const tracked: TrackedGoal = { goal, taskTitles: new Map(), results: new Map() };
    this.goals.set(goalId, tracked);

    for (const planned of plannedTasks) {
      const task = await this.orchestrator.submitTask({
        description: planned.description,
        workspacePath,
        title: planned.title,
        requiredCapabilities: planned.requiredCapabilities,
        goalId,
      });
      tracked.taskTitles.set(task.id, planned.title);
    }

    this.broadcast({ type: "goal_planned", goalId, goal, taskCount: plannedTasks.length });
  }

  /**
   * Feed every OfficeEvent the Orchestrator broadcasts through here (in
   * addition to sending it on to clients as usual) so this coordinator can
   * tell when all subtasks of a tracked goal have settled.
   */
  observe(event: OfficeEvent): void {
    if (event.type !== "task_completed" && event.type !== "task_failed") return;

    for (const [goalId, tracked] of this.goals) {
      const title = tracked.taskTitles.get(event.taskId);
      if (title === undefined) continue;

      tracked.results.set(
        event.taskId,
        event.type === "task_completed"
          ? { title, status: "done", filesChanged: event.filesChanged, note: event.summary }
          : { title, status: "failed", filesChanged: [], note: event.reason }
      );

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
