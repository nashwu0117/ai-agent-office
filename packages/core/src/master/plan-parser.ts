import { KNOWN_CAPABILITIES } from "../task/types.js";
import { MasterPlanningError, type PlannedTask } from "./brain.js";

/**
 * v0.22: pulled out of the Anthropic-specific adapter so a second MasterBrain
 * implementation (see @ai-office/adapter-master-codex) can validate its own
 * headless CLI's structured-JSON reply the exact same way, instead of two
 * adapters drifting on what counts as a well-formed plan. Every MasterBrain
 * implementation is expected to get its model to emit `{ "tasks": [...] }`
 * shaped JSON somehow (a real JSON-schema-constrained response, or a plain
 * text reply the adapter parses) and hand the parsed value here.
 */
export function parsePlanPayload(input: unknown): PlannedTask[] {
  if (typeof input !== "object" || input === null || !("tasks" in input)) {
    throw new MasterPlanningError("Structured plan was missing a tasks array.");
  }
  const tasks = (input as { tasks: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new MasterPlanningError("Structured plan returned an empty task list.");
  }

  return tasks.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new MasterPlanningError(`Task ${i} in the structured plan was not an object.`);
    }
    const obj = raw as Record<string, unknown>;

    if (typeof obj.title !== "string" || !obj.title.trim()) {
      throw new MasterPlanningError(`Task ${i} in the structured plan is missing a title.`);
    }
    if (typeof obj.description !== "string" || !obj.description.trim()) {
      throw new MasterPlanningError(`Task ${i} in the structured plan is missing a description.`);
    }
    if (!Array.isArray(obj.requiredCapabilities)) {
      throw new MasterPlanningError(`Task ${i} in the structured plan is missing requiredCapabilities.`);
    }

    const caps = obj.requiredCapabilities.filter((c): c is string => typeof c === "string");
    const unknown = caps.filter((c) => !(KNOWN_CAPABILITIES as readonly string[]).includes(c));
    if (unknown.length > 0) {
      throw new MasterPlanningError(`Task ${i} in the structured plan used unknown capabilities: ${unknown.join(", ")}`);
    }

    let dependsOn: string[] | undefined;
    if (obj.dependsOn !== undefined) {
      if (!Array.isArray(obj.dependsOn) || !obj.dependsOn.every((d): d is string => typeof d === "string")) {
        throw new MasterPlanningError(`Task ${i} in the structured plan has a dependsOn that is not an array of strings.`);
      }
      if (obj.dependsOn.length > 0) dependsOn = obj.dependsOn;
    }

    return {
      title: obj.title,
      description: obj.description,
      requiredCapabilities: caps as PlannedTask["requiredCapabilities"],
      dependsOn,
    };
  });
}

/** Shared system prompt text every MasterBrain implementation's plan() call should use — see each adapter for how it's actually sent (JSON-schema tool call, --system-prompt flag, plain prefix, ...). */
export const MASTER_PLAN_SYSTEM_PROMPT = `You are the Master planner for an AI office of headless coding-CLI workers.
Each worker has real shell/file/git access inside one project working directory. Given a user's
high-level goal, decompose it into a set of subtasks to dispatch to workers.

Rules:
- Every task's "description" must read like a concrete, self-contained instruction you could hand
  directly to a headless coding CLI to execute right now — not a restatement of the user's
  high-level goal.
- "requiredCapabilities" may only use values from this fixed list: ${KNOWN_CAPABILITIES.join(", ")}.
  Never invent a new capability name. Pick the smallest accurate subset for each task.
- Produce at least one task. Prefer several small tasks over one large one when the goal naturally
  splits that way.
- Most subtasks should be independent of one another so they can run in parallel — that is the
  whole point of splitting a goal into several tasks. Only set "dependsOn" on a task when it
  genuinely cannot start until a specific other task's work exists (e.g. it needs a schema field,
  an endpoint, or a file that other task creates). Do not chain tasks together "to be safe": a plan
  where every task depends on the previous one has lost all benefit of parallel dispatch and will be
  rejected as over-cautious.
- When used, "dependsOn" is an array of the exact "title" strings of the tasks it depends on (titles
  from this same plan only — never invent a title that isn't one of your own tasks').
- Return exactly a JSON object of the shape { "tasks": [ { "title": string, "description": string,
  "requiredCapabilities": string[], "dependsOn"?: string[] } ] } and nothing else — no markdown
  fences, no commentary before or after it.`;

/** Shared system prompt text for summarize() — see each adapter for how it's actually sent. */
export const MASTER_SUMMARY_SYSTEM_PROMPT = `You are the Master of an AI office reporting back to the user after
dispatching their high-level goal to several worker agents. Write a short, plain-text summary (a
few sentences, no markdown headers) of what was accomplished, calling out any subtasks that failed
and why. This is read directly by the user, not parsed by a program.`;
