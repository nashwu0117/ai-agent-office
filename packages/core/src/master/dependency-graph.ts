import type { PlannedTask } from "./brain.js";

export class DependencyPlanningError extends Error {}

export interface ResolvedTask extends PlannedTask {
  /** Indexes into the same plannedTasks array this task depends on, resolved from dependsOn titles. */
  dependsOnIndexes: number[];
}

/**
 * Resolves each PlannedTask.dependsOn (title strings, as the Master output
 * them) to indexes within that same plan, and rejects the whole plan if it
 * references an unknown title or contains a dependency cycle. Called once
 * per goal, before GoalCoordinator ever hands a single Task to the
 * Orchestrator — a broken dependency graph must never reach real task state
 * at all, since the Orchestrator has no way to recover from a deadlock once
 * tasks exist.
 */
export function resolveDependencies(plannedTasks: PlannedTask[]): ResolvedTask[] {
  const titleToIndex = new Map<string, number>();
  plannedTasks.forEach((task, i) => {
    if (titleToIndex.has(task.title)) {
      throw new DependencyPlanningError(
        `Duplicate task title "${task.title}" — dependsOn references would be ambiguous.`
      );
    }
    titleToIndex.set(task.title, i);
  });

  const resolved: ResolvedTask[] = plannedTasks.map((task) => {
    const dependsOnIndexes = (task.dependsOn ?? []).map((depTitle) => {
      const idx = titleToIndex.get(depTitle);
      if (idx === undefined) {
        throw new DependencyPlanningError(
          `Task "${task.title}" has dependsOn "${depTitle}", which is not a title in this plan.`
        );
      }
      return idx;
    });
    return { ...task, dependsOnIndexes };
  });

  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Array<0 | 1 | 2>(resolved.length).fill(UNVISITED);

  function visit(i: number, path: number[]): void {
    if (state[i] === DONE) return;
    if (state[i] === VISITING) {
      const cycleStart = path.indexOf(i);
      const cycleTitles = [...path.slice(cycleStart), i].map((idx) => resolved[idx].title);
      throw new DependencyPlanningError(`Circular dependency detected: ${cycleTitles.join(" -> ")}`);
    }
    state[i] = VISITING;
    for (const dep of resolved[i].dependsOnIndexes) visit(dep, [...path, i]);
    state[i] = DONE;
  }

  for (let i = 0; i < resolved.length; i++) visit(i, []);

  return resolved;
}
