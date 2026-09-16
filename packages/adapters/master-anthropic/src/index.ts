import Anthropic from "@anthropic-ai/sdk";
import {
  KNOWN_CAPABILITIES,
  MasterPlanningError,
  type MasterBrain,
  type PlannedTask,
  type TaskResultSummary,
} from "@ai-office/core";

// Fixed for this phase — see README for how to point this at a different
// model your account actually has access to via ANTHROPIC_MASTER_MODEL.
// claude-sonnet-5 was tried first and consistently 429'd
// (rate_limit_error) on this project's dev credential — a long-lived token
// from `claude setup-token`, i.e. a Claude subscription, not a raw API key
// — while claude-haiku-4-5-20251001 succeeded immediately on the same
// token. Confirmed by hand with isolated single-message calls to each
// model, not assumed.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const PLAN_TOOL_NAME = "submit_plan";

const SYSTEM_PROMPT = `You are the Master planner for an AI office of headless coding-CLI workers.
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
- Example WITH a real dependency — goal "Add a discountCode field to the Order model, and show it on
  the order summary page": task 1 title "Add discountCode field to Order model" (backend, no
  dependsOn); task 2 title "Show discountCode on order summary page" (frontend, dependsOn: ["Add
  discountCode field to Order model"]) because it must read the field name/shape task 1 creates.
- Example WITHOUT a dependency — goal "Add a health check endpoint and write a CONTRIBUTING.md":
  two tasks, one backend and one docs, neither sets dependsOn — they touch unrelated parts of the
  project and can run at the same time.
- Call the ${PLAN_TOOL_NAME} tool exactly once with the complete task list.`;

const SUMMARY_SYSTEM_PROMPT = `You are the Master of an AI office reporting back to the user after
dispatching their high-level goal to several worker agents. Write a short, plain-text summary (a
few sentences, no markdown headers) of what was accomplished, calling out any subtasks that failed
and why. This is read directly by the user, not parsed by a program.`;

const PLAN_TOOL: Anthropic.Tool = {
  name: PLAN_TOOL_NAME,
  description: "Submit the decomposed list of subtasks for the user's goal.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short human-readable task title." },
            description: {
              type: "string",
              description: "Concrete instruction to hand directly to a headless coding CLI.",
            },
            requiredCapabilities: {
              type: "array",
              items: { type: "string", enum: [...KNOWN_CAPABILITIES] },
            },
            dependsOn: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional. Exact 'title' strings of other tasks in this same plan that must finish " +
                "first. Leave empty for the (common) case where this task is independent.",
            },
          },
          required: ["title", "description", "requiredCapabilities"],
        },
      },
    },
    required: ["tasks"],
  },
};

/**
 * Calls the Anthropic Messages API directly (no CLI subprocess) — Master
 * only needs "goal in, structured decision out", so a RuntimeAdapter-style
 * subprocess wrapper would add a parsing layer for no benefit here. See
 * MasterBrain (packages/core/src/master/brain.ts) for the interface a
 * future CodexMasterBrain/GeminiMasterBrain would implement instead.
 */
export class AnthropicMasterBrain implements MasterBrain {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly missingCredentialMessage: string | null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const baseURL = process.env.ANTHROPIC_BASE_URL;
    this.model = process.env.ANTHROPIC_MASTER_MODEL ?? DEFAULT_MODEL;

    if (!apiKey && !authToken) {
      // Deliberately does not throw here: constructing this class happens once
      // at server startup, and a missing credential must not crash the whole
      // process (v0.1-v0.4's manual task path has to keep working regardless).
      // The error only surfaces when plan()/summarize() is actually called.
      this.client = null;
      this.missingCredentialMessage =
        "ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) is not set. MasterBrain calls the Anthropic " +
        "API directly and needs its own credential, separate from the claude CLI's own login — see README.";
      return;
    }
    this.missingCredentialMessage = null;
    this.client = new Anthropic({ apiKey, authToken, baseURL });
  }

  async plan(goal: string): Promise<PlannedTask[]> {
    if (!this.client) throw new MasterPlanningError(this.missingCredentialMessage!);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [PLAN_TOOL],
        tool_choice: { type: "tool", name: PLAN_TOOL_NAME },
        messages: [{ role: "user", content: goal }],
      });
    } catch (err) {
      throw new MasterPlanningError(
        `Master planning request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === PLAN_TOOL_NAME
    );
    if (!toolUse) {
      throw new MasterPlanningError("Master did not call submit_plan — no structured plan was returned.");
    }

    return parsePlan(toolUse.input);
  }

  async summarize(goal: string, results: TaskResultSummary[]): Promise<string> {
    if (!this.client) throw new MasterPlanningError(this.missingCredentialMessage!);

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Goal: ${goal}\n\nSubtask results (JSON):\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      });
    } catch (err) {
      throw new MasterPlanningError(
        `Master summary request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    return text?.text?.trim() || "Master finished but returned no summary text.";
  }
}

function parsePlan(input: unknown): PlannedTask[] {
  if (typeof input !== "object" || input === null || !("tasks" in input)) {
    throw new MasterPlanningError("submit_plan tool call was missing a tasks array.");
  }
  const tasks = (input as { tasks: unknown }).tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new MasterPlanningError("submit_plan returned an empty task list.");
  }

  return tasks.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new MasterPlanningError(`Task ${i} in submit_plan was not an object.`);
    }
    const obj = raw as Record<string, unknown>;

    if (typeof obj.title !== "string" || !obj.title.trim()) {
      throw new MasterPlanningError(`Task ${i} in submit_plan is missing a title.`);
    }
    if (typeof obj.description !== "string" || !obj.description.trim()) {
      throw new MasterPlanningError(`Task ${i} in submit_plan is missing a description.`);
    }
    if (!Array.isArray(obj.requiredCapabilities)) {
      throw new MasterPlanningError(`Task ${i} in submit_plan is missing requiredCapabilities.`);
    }

    const caps = obj.requiredCapabilities.filter((c): c is string => typeof c === "string");
    const unknown = caps.filter((c) => !(KNOWN_CAPABILITIES as readonly string[]).includes(c));
    if (unknown.length > 0) {
      throw new MasterPlanningError(`Task ${i} in submit_plan used unknown capabilities: ${unknown.join(", ")}`);
    }

    let dependsOn: string[] | undefined;
    if (obj.dependsOn !== undefined) {
      if (!Array.isArray(obj.dependsOn) || !obj.dependsOn.every((d): d is string => typeof d === "string")) {
        throw new MasterPlanningError(`Task ${i} in submit_plan has a dependsOn that is not an array of strings.`);
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
