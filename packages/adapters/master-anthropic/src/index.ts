import { spawn } from "node:child_process";
import {
  KNOWN_CAPABILITIES,
  MASTER_PLAN_SYSTEM_PROMPT,
  MASTER_SUMMARY_SYSTEM_PROMPT,
  MasterPlanningError,
  parsePlanPayload,
  type CredentialRouter,
  type MasterBrain,
  type PlannedTask,
  type TaskResultSummary,
} from "@ai-office/core";

const CLI_SESSION_PROVIDER = "claude-code-cli";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// v0.22: the shared prompt text (see @ai-office/core's plan-parser.ts) plus
// the two dependsOn examples specific to steering a --json-schema-constrained
// call — kept here rather than in the shared text since CodexMasterBrain
// (packages/adapters/master-codex) has no schema constraint to steer and
// instead relies on its own retry-on-malformed-JSON loop.
const SYSTEM_PROMPT = `${MASTER_PLAN_SYSTEM_PROMPT}
- Example WITH a real dependency — goal "Add a discountCode field to the Order model, and show it on
  the order summary page": task 1 title "Add discountCode field to Order model" (backend, no
  dependsOn); task 2 title "Show discountCode on order summary page" (frontend, dependsOn: ["Add
  discountCode field to Order model"]) because it must read the field name/shape task 1 creates.
- Example WITHOUT a dependency — goal "Add a health check endpoint and write a CONTRIBUTING.md":
  two tasks, one backend and one docs, neither sets dependsOn — they touch unrelated parts of the
  project and can run at the same time.
- Return exactly the JSON object requested by the supplied schema.`;

const SUMMARY_SYSTEM_PROMPT = MASTER_SUMMARY_SYSTEM_PROMPT;

const PLAN_SCHEMA = {
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
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

interface ClaudeCliEnvelope {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  api_error_status?: unknown;
  terminal_reason?: unknown;
}

interface HeadlessRequest {
  prompt: string;
  systemPrompt: string;
  schema?: Record<string, unknown>;
}

type HeadlessRunner = (request: HeadlessRequest) => Promise<ClaudeCliEnvelope>;

export interface AnthropicMasterBrainOptions {
  /** Test seam; production always uses the real `claude` executable. */
  runner?: HeadlessRunner;
  command?: string;
  timeoutMs?: number;
  cwd?: string;
}

/**
 * Master planning through Claude Code's non-interactive print mode. The CLI
 * reads the operator's existing Claude.ai Pro/Max OAuth login from its own
 * credential store; this adapter never reads, accepts, or forwards an
 * Anthropic Console API key.
 *
 * CredentialRouter remains the shared status abstraction, but there is no
 * failover loop here: `claude-code-cli-session` is the one login source and
 * retrying another API key would violate this adapter's subscription-only
 * contract. A malformed structured reply is retried once; auth, quota,
 * timeout, and other process failures return immediately with a clear error.
 */
export class AnthropicMasterBrain implements MasterBrain {
  private readonly runner: HeadlessRunner;

  constructor(
    private readonly router: CredentialRouter,
    options: AnthropicMasterBrainOptions = {}
  ) {
    this.runner =
      options.runner ??
      createClaudeHeadlessRunner({
        command: options.command,
        timeoutMs: options.timeoutMs,
        cwd: options.cwd,
      });
  }

  private requireSubscriptionSession(): void {
    if (!this.router.resolve(CLI_SESSION_PROVIDER)) {
      throw new MasterPlanningError(
        "Claude Code subscription login is unavailable. Run `claude auth login` and choose the Claude.ai Pro/Max account; no ANTHROPIC_API_KEY is used.",
        { authFailure: true }
      );
    }
  }

  async plan(goal: string): Promise<PlannedTask[]> {
    this.requireSubscriptionSession();

    let firstParseError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const retryInstruction =
        attempt === 1
          ? ""
          : "\n\nYour previous response could not be parsed. Return only an object that exactly matches the JSON schema.";
      const envelope = await this.callCli("planning", {
        prompt: `${goal}${retryInstruction}`,
        systemPrompt: SYSTEM_PROMPT,
        schema: PLAN_SCHEMA,
      });

      try {
        return parsePlan(extractStructuredPayload(envelope));
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
    this.requireSubscriptionSession();
    const envelope = await this.callCli("summary", {
      prompt: `Goal: ${goal}\n\nSubtask results (JSON):\n${JSON.stringify(results, null, 2)}`,
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
    });
    return typeof envelope.result === "string" && envelope.result.trim()
      ? envelope.result.trim()
      : "Master finished but returned no summary text.";
  }

  private async callCli(label: string, request: HeadlessRequest): Promise<ClaudeCliEnvelope> {
    try {
      const envelope = await this.runner(request);
      if (envelope.is_error === true || envelope.type !== "result") {
        const message = cliEnvelopeError(envelope);
        throw new MasterPlanningError(`Master ${label} CLI request failed: ${message}`, {
          authFailure: isSubscriptionAuthOrQuotaError(envelope, message),
        });
      }
      return envelope;
    } catch (err) {
      if (err instanceof MasterPlanningError) throw err;
      const message = describeError(err);
      throw new MasterPlanningError(`Master ${label} CLI request failed: ${message}`, {
        authFailure: isSubscriptionAuthOrQuotaError(undefined, message),
      });
    }
  }
}

function createClaudeHeadlessRunner(options: {
  command?: string;
  timeoutMs?: number;
  cwd?: string;
}): HeadlessRunner {
  const command = options.command ?? process.env.AI_OFFICE_CLAUDE_COMMAND ?? "claude";
  const configuredTimeout = Number(process.env.AI_OFFICE_MASTER_TIMEOUT_MS);
  const timeoutMs =
    options.timeoutMs ??
    (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS);
  const cwd = options.cwd ?? process.cwd();

  return ({ prompt, systemPrompt, schema }) =>
    new Promise<ClaudeCliEnvelope>((resolve, reject) => {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--safe-mode",
        "--restricted",
        "--permission-mode",
        "dontAsk",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--max-turns",
        "3",
        "--system-prompt",
        systemPrompt,
      ];
      if (schema) args.push("--json-schema", JSON.stringify(schema));

      const model = process.env.AI_OFFICE_MASTER_MODEL ?? process.env.ANTHROPIC_MASTER_MODEL;
      if (model?.trim()) args.push("--model", model.trim());

      const child = spawn(command, args, {
        cwd,
        env: subscriptionOnlyEnvironment(process.env),
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
          reject(new Error(`claude timed out after ${timeoutMs}ms`));
          return;
        }
        if (outputTooLarge) {
          reject(new Error(`claude output exceeded ${MAX_OUTPUT_BYTES} bytes`));
          return;
        }

        let envelope: ClaudeCliEnvelope;
        try {
          envelope = parseCliEnvelope(stdout);
        } catch (err) {
          const detail = compact(stderr) || `exit ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`;
          reject(new Error(`${describeError(err)}; ${detail}`));
          return;
        }

        if (code !== 0 && envelope.is_error !== true) {
          reject(
            new Error(
              `claude exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}: ${compact(stderr) || cliEnvelopeError(envelope)}`
            )
          );
          return;
        }
        resolve(envelope);
      });
    });
}

/** Explicitly prevent the Master subprocess from switching to Console API-key or gateway auth. */
export function subscriptionOnlyEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parent };
  for (const name of Object.keys(env)) {
    if (/^ANTHROPIC_(?:API_KEY|AUTH_TOKEN|BASE_URL)(?:_BACKUP\d*)?$/.test(name)) delete env[name];
  }
  delete env.CLAUDE_CODE_USE_BEDROCK;
  delete env.CLAUDE_CODE_USE_VERTEX;
  delete env.CLAUDE_CODE_USE_FOUNDRY;
  return env;
}

function parseCliEnvelope(stdout: string): ClaudeCliEnvelope {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) throw new Error("claude returned empty stdout");

  try {
    return asEnvelope(JSON.parse(cleaned));
  } catch (wholeError) {
    // Current --output-format json is one clean object. This fallback only
    // tolerates a launcher/wrapper that writes harmless lines around it.
    const candidates = cleaned
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .reverse();
    for (const candidate of candidates) {
      try {
        return asEnvelope(JSON.parse(candidate));
      } catch {
        // Keep looking for the final JSON result line.
      }
    }
    throw new Error(`claude stdout was not valid JSON: ${describeError(wholeError)}`);
  }
}

function asEnvelope(value: unknown): ClaudeCliEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("claude JSON output was not an object");
  }
  return value as ClaudeCliEnvelope;
}

function extractStructuredPayload(envelope: ClaudeCliEnvelope): unknown {
  if (envelope.structured_output !== undefined) return envelope.structured_output;
  if (typeof envelope.result !== "string") {
    throw new MasterPlanningError("Claude CLI result contained neither structured_output nor a text result.");
  }

  const text = stripAnsi(envelope.result).trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch (err) {
    throw new MasterPlanningError(`Claude CLI result text was not valid JSON: ${describeError(err)}`);
  }
}

function cliEnvelopeError(envelope: ClaudeCliEnvelope): string {
  const result = typeof envelope.result === "string" ? envelope.result.trim() : "";
  const status = typeof envelope.api_error_status === "number" ? `HTTP ${envelope.api_error_status}: ` : "";
  const terminal = typeof envelope.terminal_reason === "string" ? envelope.terminal_reason : "";
  return `${status}${result || terminal || `unexpected CLI result (${String(envelope.subtype ?? "unknown")})`}`;
}

function isSubscriptionAuthOrQuotaError(envelope: ClaudeCliEnvelope | undefined, message: string): boolean {
  const status = envelope?.api_error_status;
  if (status === 401 || status === 403 || status === 429) return true;
  return /\b(401|403|429)\b|not logged in|login required|authentication|session limit|usage limit|rate.?limit/i.test(message);
}

function compact(value: string): string {
  return stripAnsi(value).replace(/\s+/g, " ").trim().slice(0, 800);
}

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** v0.22: thin re-export — validation itself moved to @ai-office/core's parsePlanPayload so CodexMasterBrain can share it. Kept here under its original name/module since nothing outside this file needs to change how it's imported. */
export const parsePlan = parsePlanPayload;
