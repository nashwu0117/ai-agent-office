import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { OfficeEvent } from "../events/types.js";
import type { Task } from "../task/types.js";
import type { AgentHandoff } from "./types.js";

/** Only the one Orchestrator method this coordinator actually calls — keeps it trivially testable without a full Orchestrator (adapters, workspace locks, ...) in the loop. */
export type TaskLookup = Pick<Orchestrator, "getTask">;

export interface HandoffCoordinatorOptions {
  orchestrator: TaskLookup;
  broadcast: (event: OfficeEvent) => void;
  idGen?: () => string;
  now?: () => string;
  /** Kept bounded the same way the office keeps a "last few" completion cards — no full history browser (see build prompt Part C.5). Default 50. */
  maxHistory?: number;
}

let counter = 0;
function defaultIdGen(): string {
  counter += 1;
  return `handoff-${Date.now().toString(36)}-${counter}`;
}

/**
 * v0.22 Part C: sits beside the Orchestrator exactly the way GoalCoordinator
 * does — observes every OfficeEvent the Orchestrator already broadcasts,
 * never changes dispatch/matching logic itself, so it cannot add a new long
 * stall to the v0.6 dependency-dispatch path it watches (see build prompt
 * Part C.6).
 *
 * Trigger (the one situation this project defines as "these two agents need
 * to communicate", per the build prompt's Part C.1 — a second situation,
 * "a running agent actively requests another agent's in-progress output", is
 * explicitly left for a later round rather than faked here): a task carries
 * one or more `dependsOn` ids (see v0.6) and just became "assigned" to some
 * agent. For each dependency task whose own assignedAgentId differs from
 * this task's, that is a real handoff — the new agent is about to start work
 * that depends on a *different* agent's already-completed output. Same-agent
 * dependencies produce no handoff: there is nothing to hand off across, the
 * one agent already has their own prior context.
 */
export class HandoffCoordinator {
  private readonly orchestrator: TaskLookup;
  private readonly broadcast: (event: OfficeEvent) => void;
  private readonly idGen: () => string;
  private readonly now: () => string;
  private readonly maxHistory: number;
  private history: AgentHandoff[] = [];

  constructor(options: HandoffCoordinatorOptions) {
    this.orchestrator = options.orchestrator;
    this.broadcast = options.broadcast;
    this.idGen = options.idGen ?? defaultIdGen;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxHistory = options.maxHistory ?? 50;
  }

  list(): AgentHandoff[] {
    return [...this.history];
  }

  observe(event: OfficeEvent): void {
    if (event.type !== "task_updated") return;
    const task = event.task;
    if (task.status !== "assigned" || !task.assignedAgentId || !task.dependsOn?.length) return;

    const seenFromAgents = new Set<string>();
    for (const depId of task.dependsOn) {
      const dep = this.orchestrator.getTask(depId);
      if (!dep?.assignedAgentId) continue;
      if (dep.assignedAgentId === task.assignedAgentId) continue;
      if (seenFromAgents.has(dep.assignedAgentId)) continue; // one handoff per distinct producing agent, not per dependency task
      seenFromAgents.add(dep.assignedAgentId);

      const handoff = this.buildHandoff(dep, task);
      this.history.push(handoff);
      if (this.history.length > this.maxHistory) this.history.shift();
      this.broadcast({ type: "agent_handoff", handoff });
    }
  }

  /**
   * Template-generated, not LLM-generated: the build prompt explicitly
   * allows either ("可以是把前一個任務的產出摘要,用 LLM 或簡單模板生成一段給後手
   * agent 的說明文字"). An LLM round-trip here would put a live model call
   * — with its own latency/failure modes — directly in the dependency-
   * dispatch path this coordinator must never slow down (Part C.6); a
   * template reusing data the Orchestrator already captured
   * (Task.resultSummary/resultFilesChanged, set right before task_completed/
   * task_failed) is deterministic, instant, and never fails.
   */
  private buildHandoff(fromTask: Task, toTask: Task): AgentHandoff {
    const outcome = fromTask.status === "done" ? "completed" : "did not finish cleanly";
    const filesNote = fromTask.resultFilesChanged?.length
      ? ` Files touched: ${fromTask.resultFilesChanged.join(", ")}.`
      : "";
    const noteText = fromTask.resultSummary ? ` ${fromTask.resultSummary}` : "";
    const message =
      `${fromTask.assignedAgentId} ${outcome} "${fromTask.title}".${noteText}${filesNote} ` +
      `Handing off to ${toTask.assignedAgentId} to start "${toTask.title}", which depends on this work.`;

    return {
      id: this.idGen(),
      fromAgentId: fromTask.assignedAgentId!,
      toAgentId: toTask.assignedAgentId!,
      fromTaskId: fromTask.id,
      fromTaskTitle: fromTask.title,
      toTaskId: toTask.id,
      toTaskTitle: toTask.title,
      message,
      createdAt: this.now(),
    };
  }
}
