import type { Agent, CredentialRouter, JsonLine, RuntimeAdapter, RuntimeEvent, RuntimeHandle, Task } from "@ai-office/core";
import { EnvVarCredentialSource, spawnRuntimeProcess } from "@ai-office/core/node";

const PROVIDER = "cline";

/**
 * Talks to the real `cline` CLI (v3.0.62, npm package `cline`) in headless
 * JSON mode: `cline --json --auto-approve true -c <dir> -P cline -m <model>
 * "<task>"`. Verified by running the installed binary directly rather than
 * trusting its own published docs — docs.cline.bot's CLI reference
 * describes a `{type: "ask" | "say", text, ts, ...}` NDJSON shape that this
 * installed version does not actually emit. The real shape, confirmed
 * live, is one of:
 *   {type: "hook_event", hookEventName, agentId, taskId, ...}
 *   {type: "agent_event", event: {type: "iteration_start"|"text"|"tool_use"|"done", ...}}
 *   {type: "run_result", finishReason: "success"|"error", text, model, usage, ...}
 *   {type: "error", message}   — note: this one line type is written to
 *     stderr, not stdout, by this CLI version (confirmed live); every
 *     other type above is stdout. spawnRuntimeProcess only line-parses
 *     stdout, so a stderr "error" line is picked up by its existing
 *     non-zero-exit-code stderr fallback instead of mapClineLine — kept
 *     here anyway in case a future version moves it to stdout.
 * None of this is a stable public contract, so every line is parsed
 * defensively, same posture as the Claude Code and OpenCode adapters.
 *
 * --auto-approve already defaults to true per `cline --help`, but it's
 * passed explicitly anyway — same reasoning as Claude Code's
 * `--permission-mode acceptEdits` and OpenCode's `--auto`: a headless
 * worker with nobody present to approve tool calls needs this, and relying
 * on an undocumented default is fragile.
 *
 * Model defaults to `cline-free/deepseek-v4.1-flash` ("DeepSeek V4.1 Flash
 * (free)") — a real free-tagged model id, confirmed by running the CLI
 * live (its own daily-cap error message named this exact id when the
 * shared sandbox account's free quota was already exhausted for the day),
 * matching this runtime's "free quota" role in the v0.13 build prompt.
 * Override via `agent.model` for a different free-tagged model or a BYOK
 * provider/model — run `cline auth` interactively once to see what's
 * available to your account, same override story as OpenCodeAdapter's
 * DEFAULT_MODEL.
 *
 * A free model's daily cap returns a clean `INFERENCE_CAP_ERROR` (HTTP 429)
 * in `run_result`/the process's non-zero exit rather than crashing —
 * surfaced here as an ordinary task failure, same as any other error.
 */
const DEFAULT_MODEL = "cline-free/deepseek-v4.1-flash";

export class ClineAdapter implements RuntimeAdapter {
  constructor(private readonly credentials: CredentialRouter) {}

  async start(task: Task, agent: Agent): Promise<RuntimeHandle> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Cline's own hosted "cline" provider (the CLI's default, -P cline)
    // reads CLINE_API_KEY the same way Claude Code reads ANTHROPIC_API_KEY,
    // so it plugs into the same env-var-backed CredentialRouter pool as
    // every other provider (see packages/core/src/credentials/factory.ts)
    // instead of needing new credential-source machinery. A resolve() miss
    // isn't fatal: this machine may already have a `cline auth` login
        // login session cached under ~/.cline (confirmed present on this box), same
    // "CLI manages its own login independently" fallback story as
    // OpenCodeAdapter.
    const source = this.credentials.resolve(PROVIDER);
    if (source instanceof EnvVarCredentialSource) {
      const value = source.readValue();
      if (value) env.CLINE_API_KEY = value;
    }

    return spawnRuntimeProcess({
      command: "cline",
      args: [
        "--json",
        "--auto-approve",
        "true",
        "-c",
        task.workspacePath,
        "-P",
        "cline",
        "-m",
        agent.model ?? DEFAULT_MODEL,
        task.description,
      ],
      cwd: task.workspacePath,
      env,
      mapLine: mapClineLine,
    });
  }
}

function mapClineLine(line: JsonLine): RuntimeEvent {
  const timestamp = new Date().toISOString();
  if (line.parsed === undefined) {
    return { type: "log", message: line.raw, timestamp };
  }

  const message = messageFromParsedLine(line.parsed);
  return { type: message.type, message: message.text, raw: line.parsed, timestamp };
}

function messageFromParsedLine(parsed: unknown): { type: RuntimeEvent["type"]; text: string } {
  if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
    return { type: "log", text: JSON.stringify(parsed) };
  }
  const obj = parsed as Record<string, unknown>;

  switch (obj.type) {
    case "hook_event":
      return { type: "log", text: `${String(obj.hookEventName ?? "hook")} event` };
    case "agent_event":
      return messageFromAgentEvent(obj.event);
    case "error":
      return { type: "error", text: typeof obj.message === "string" ? obj.message : "unknown error" };
    case "run_result": {
      const text = typeof obj.text === "string" ? truncate(obj.text) : "run finished";
      return { type: obj.finishReason === "error" ? "error" : "done", text };
    }
    default:
      return { type: "log", text: `${String(obj.type)} event` };
  }
}

function messageFromAgentEvent(event: unknown): { type: RuntimeEvent["type"]; text: string } {
  if (typeof event !== "object" || event === null || !("type" in event)) {
    return { type: "log", text: "agent event" };
  }
  const obj = event as Record<string, unknown>;

  switch (obj.type) {
    case "iteration_start":
      return { type: "log", text: `iteration ${String(obj.iteration ?? "?")} started` };
    case "text":
      return { type: "progress", text: typeof obj.text === "string" ? obj.text : "thinking..." };
    case "tool_use": {
      const toolName = typeof obj.tool === "string" ? obj.tool : "tool";
      return { type: "progress", text: `Using ${toolName}` };
    }
    // The definitive completion signal for the orchestrator is the child
    // process's exit code (see spawnRuntimeProcess), which the trailing
    // top-level "run_result" line above already mirrors — this per-agent
    // "done" fires first and would just duplicate it, so it's kept as a
    // plain log line rather than a second done/error RuntimeEvent.
    case "done":
      return { type: "log", text: "agent turn finished" };
    default:
      return { type: "log", text: `${String(obj.type ?? "agent")} event` };
  }
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
