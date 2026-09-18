import { spawn } from "node:child_process";
import {
  MASTER_PLAN_SYSTEM_PROMPT,
  MASTER_SUMMARY_SYSTEM_PROMPT,
  MasterPlanningError,
  parsePlanPayload,
  type CredentialRouter,
  type MasterBrain,
  type PlannedTask,
  type TaskResultSummary,
} from "@ai-office/core";

const CLI_SESSION_PROVIDER = "codex-native";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface CodexRunResult {
  /** Text of the last agent_message item seen before turn.completed, if any. */
  text?: string;
  turnCompleted: boolean;
}

type HeadlessRunner = (prompt: string) => Promise<CodexRunResult>;

export interface CodexMasterBrainOptions {
  /** Test seam; production always uses the real `codex` executable. */
  runner?: HeadlessRunner;
  command?: string;
  timeoutMs?: number;
  cwd?: string;
  /** v0.22.1: explicit `--model` value — takes priority over the AI_OFFICE_MASTER_MODEL env var. Unset/empty means no --model flag (the CLI's own default). */
  model?: string;
}

/**
 * v0.22 Part B: a second MasterBrain implementation, alongside
 * AnthropicMasterBrain — see that package's own doc comment and this
 * project's research into whether the v0.21 BackendProfile/proxy mechanism
 * could cover Master too (it can't: BackendProfile is an HTTP-proxy
 * substitution for a CLI subprocess whose *env* points at it, while Master
 * strips ANTHROPIC_BASE_URL specifically to force subscription-login
 * behavior — the two are structurally incompatible). This drives the same
 * MasterBrain interface through `codex exec`'s headless mode instead,
 * authenticating via the operator's own `codex login` session — this
 * adapter never reads, accepts, or forwards an OPENAI_API_KEY.
 *
 * Unlike Claude Code's `--output-format json --json-schema`, this project
 * found no equivalent schema-constrained structured-output flag for `codex
 * exec` (see packages/adapters/codex's own doc comment on what was actually
 * verified against a real codex-cli install: `--json` streams
 * newline-delimited progress/item events, not a single structured result).
 * So instead this simply instructs the model, in plain prompt text, to
 * reply with nothing but the requested JSON object, takes the last
 * `agent_message` item's text as of `turn.completed`, and parses that the
 * same defensive way AnthropicMasterBrain parses its own text-fallback path
 * (strip code fences, JSON.parse, one retry on failure) — a real, working
 * mechanism, just a plain-text-convention one rather than a schema-enforced
 * one, and documented here as exactly that rather than dressed up as
 * something more guaranteed than it is.
 *
 * `--sandbox read-only` (one of Codex CLI's three documented sandbox
 * policies, alongside workspace-write and danger-full-access) means this
 * call can never write a file or run a mutating command regardless of what
 * the model attempts — appropriate since Master planning should never touch
 * a workspace directly, only worker CLIs dispatched to one should.
 */
export class CodexMasterBrain implements MasterBrain {
  private readonly runner: HeadlessRunner;

  constructor(
    private readonly router: CredentialRouter,
    options: CodexMasterBrainOptions = {}
  ) {
    this.runner =
      options.runner ??
      createCodexHeadlessRunner({
        command: options.command,
        timeoutMs: options.timeoutMs,
        cwd: options.cwd,
        model: options.model,
      });
  }

  private requireLoginSession(): void {
    if (!this.router.resolve(CLI_SESSION_PROVIDER)) {
      throw new MasterPlanningError(
        "Codex CLI login is unavailable. Run `codex login` (ChatGPT or API-key login both work); no OPENAI_API_KEY is read by this Master backend.",
        { authFailure: true }
      );
    }
  }

  async plan(goal: string): Promise<PlannedTask[]> {
    this.requireLoginSession();

    const basePrompt = `${MASTER_PLAN_SYSTEM_PROMPT}\n\nGoal: ${goal}`;
    let firstParseError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const prompt =
        attempt === 1
          ? basePrompt
          : `${basePrompt}\n\nYour previous response could not be parsed. Reply with nothing but the JSON object described above — no markdown fences, no commentary.`;
      const result = await this.run("planning", prompt);

      try {
        return parsePlanPayload(extractJson(result));
      } catch (err) {
        firstParseError ??= err;
        if (attempt === 2) {
          throw new MasterPlanningError(
            `Master planning returned invalid structured JSON twice: ${describeError(err)} (first attempt: ${describeError(firstParseError)})`
          );
        }
      }
    }

    throw new MasterPlanningError("Master planning returned no plan.");
  }

  async summarize(goal: string, results: TaskResultSummary[]): Promise<string> {
    this.requireLoginSession();
    const prompt = `${MASTER_SUMMARY_SYSTEM_PROMPT}\n\nGoal: ${goal}\n\nSubtask results (JSON):\n${JSON.stringify(results, null, 2)}`;
    const result = await this.run("summary", prompt);
    return result.text?.trim() ? result.text.trim() : "Master finished but returned no summary text.";
  }

  private async run(label: string, prompt: string): Promise<CodexRunResult> {
    try {
      const result = await this.runner(prompt);
      if (!result.turnCompleted) {
        throw new MasterPlanningError(`Master ${label} CLI request did not reach turn.completed.`);
      }
      return result;
    } catch (err) {
      if (err instanceof MasterPlanningError) throw err;
      const message = describeError(err);
      throw new MasterPlanningError(`Master ${label} CLI request failed: ${message}`, {
        authFailure: isLoginError(message),
      });
    }
  }
}

function extractJson(result: CodexRunResult): unknown {
  if (!result.text) {
    throw new MasterPlanningError("Codex CLI turn completed with no agent_message text.");
  }
  const text = result.text.trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (err) {
    throw new MasterPlanningError(`Codex CLI reply was not valid JSON: ${describeError(err)}`);
  }
}

function createCodexHeadlessRunner(options: {
  command?: string;
  timeoutMs?: number;
  cwd?: string;
  model?: string;
}): HeadlessRunner {
  const command = options.command ?? process.env.AI_OFFICE_CODEX_COMMAND ?? "codex";
  const configuredTimeout = Number(process.env.AI_OFFICE_MASTER_TIMEOUT_MS);
  const timeoutMs =
    options.timeoutMs ??
    (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS);
  const cwd = options.cwd ?? process.cwd();

  return (prompt) =>
    new Promise<CodexRunResult>((resolve, reject) => {
      const args = ["exec", prompt, "--json", "--sandbox", "read-only", "-C", cwd];
      const model = options.model ?? process.env.AI_OFFICE_MASTER_MODEL;
      if (model?.trim()) args.push("--model", model.trim());

      const child = spawn(command, args, {
        cwd,
        env: codexSubscriptionOnlyEnvironment(process.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let outputTooLarge = false;
      let timedOut = false;

      const collect = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > MAX_OUTPUT_BYTES) {
          outputTooLarge = true;
          child.kill("SIGTERM");
          return current;
        }
        return next;
      };
      child.stdout.on("data", (chunk: Buffer) => {
        stdout = collect(stdout, chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = collect(stderr, chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      }, timeoutMs);
      timer.unref();

      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`codex timed out after ${timeoutMs}ms`));
          return;
        }
        if (outputTooLarge) {
          reject(new Error(`codex output exceeded ${MAX_OUTPUT_BYTES} bytes`));
          return;
        }
        if (code !== 0) {
          reject(new Error(`codex exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${compact(stderr)}`));
          return;
        }
        resolve(parseNdjsonResult(stdout));
      });
    });
}

/** Explicitly prevent the Master subprocess from switching to API-key auth. See subscriptionOnlyEnvironment in @ai-office/adapter-master-anthropic for the same strategy applied to Claude Code — this variant is not empirically re-verified against a real codex-cli auth-precedence test the way that one was, and is documented as a precautionary, not confirmed, measure. */
export function codexSubscriptionOnlyEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;
  return env;
}

function parseNdjsonResult(stdout: string): CodexRunResult {
  let lastAgentMessage: string | undefined;
  let turnCompleted = false;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // Tolerates a launcher/wrapper writing non-JSON lines around the NDJSON stream.
    }
    if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) continue;
    const obj = parsed as Record<string, unknown>;

    if (obj.type === "turn.completed") {
      turnCompleted = true;
    } else if (obj.type === "item.completed") {
      const item = obj.item && typeof obj.item === "object" ? (obj.item as Record<string, unknown>) : {};
      if (item.type === "agent_message" && typeof item.text === "string") {
        lastAgentMessage = item.text;
      }
    }
  }

  return { text: lastAgentMessage, turnCompleted };
}

function isLoginError(message: string): boolean {
  return /not logged in|login required|authentication|unauthorized|401|403/i.test(message);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 800);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
