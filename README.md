# AI Office

_English version. The web UI itself is bilingual (Traditional Chinese / English, toggle in the top-right corner) as of v0.17 — this document is English-only._

An open-source "AI company" office: instead of a wall of terminals, you see a
2D pixel-art office where each worker corresponds to a real coding CLI agent.
Idle workers wander the Public/Talent Area; once assigned a task they walk to
a workstation, work, and return when done.

> Coming back to this project after a break? [`QUICKSTART.md`](./QUICKSTART.md)
> has the start command, what already works with no setup, and exactly which
> env vars are still missing and where to get them.

## Status: vertical slice (v0.21)

This is a progressively-built vertical slice, not the full product vision.
So far:

- A configurable fleet of up to 500 agents across **four real CLI runtimes** — Claude Code,
  OpenCode, Cline, and Codex — dispatched through a shared `RuntimeAdapter`
  interface (`packages/core/src/runtime/adapter.ts`). Adding a new CLI means
  implementing that interface, not touching the Orchestrator or the UI. (A
  fifth candidate, Freebuff, was researched and found to have no headless
  or API surface at all as of v0.13 — see
  [`docs/runtime-research-v0.13.md`](./docs/runtime-research-v0.13.md).
  Re-verified in v0.13.1 against the actually-installed CLI binary
  (same "no" — see
  [`docs/runtime-research-v0.13.1.md`](./docs/runtime-research-v0.13.1.md)).)
- **Provider catalog for common APIs** — OpenAI, Anthropic, Gemini,
  OpenRouter, DeepSeek, Groq, Mistral, xAI, SiliconFlow, Qwen, Moonshot AI
  and NVIDIA
  profiles start with their documented URL, API format and a default model.
  Users can paste a key and start; the key is stored in the ignored server
  `.env.local`, while model discovery lets them switch to any model their key
  can access. See [`docs/backend-profiles-v0.13.md`](./docs/backend-profiles-v0.13.md).
- **Backend & Credentials panel rebuilt as a cc-switch-style
  single-provider editor (v0.21)** — pick a provider from a left-hand list
  (every `BackendProfile`, plus the four CLI-login providers) and edit it
  in full on the right: name, Base URL, API key (never echoed back in
  plaintext), upstream API format, **per-role model mapping**
  (Sonnet/Opus/Fable/Haiku/Subagent — new in v0.21, see
  `packages/core/src/credentials/backend-profile.ts`'s `RoleModelMap`),
  fallback model, custom headers/body overrides, and a live secret-masked
  preview. Replaces the old table-of-profiles-plus-add-form UI entirely.
- Multiple tasks dispatch and run **concurrently** across different agents;
  a simple workspace lock stops two agents from ever running a CLI against
  the same directory at the same time.
- A fixed capability vocabulary (`backend`/`frontend`/`testing`/`docs`).
  Tasks declare `requiredCapabilities`, and the Orchestrator only dispatches
  a match. Tasks that can't be matched yet sit in a visible queue instead of
  failing.
- **Two ways to get capabilities onto a task.** The original path still
  works unchanged: type a task description and check the capabilities it
  needs by hand. The new path: type one high-level goal, and a `MasterBrain`
  (`packages/core/src/master/brain.ts`) spawns Claude Code in non-interactive
  print mode (`claude -p`) using the operator's Claude.ai subscription login.
  It decomposes the goal into several subtasks and judges each one's
  `requiredCapabilities` itself, using the CLI's JSON Schema output
  (`packages/adapters/master-anthropic`). Both paths feed the exact same
  Orchestrator dispatch/matching/lock logic below them.
- Subtasks from one goal share a `goalId`; once every one of them has
  settled (done or failed), the Master is asked for a plain-text summary,
  which is pushed to the UI as a `goal_summary` event.
- Pixel art from Kenney's CC0 "Tiny Dungeon" pack — see
  `apps/web/src/assets/ASSET_LICENSE.md` for provenance.
- Every worker CLI invocation runs inside a filesystem sandbox that blocks
  writes outside its assigned `workspacePath`, with a git-diff-based
  detect-and-revert safety net behind it regardless. See
  [`SECURITY.md`](./SECURITY.md) for what's actually guaranteed, what isn't,
  and the incident that prompted it.
- Provider status goes through a `CredentialRouter`
  (`packages/core/src/credentials`). Worker adapters may still resolve their
  own API/backend sources, while `AnthropicMasterBrain` resolves only the
  single `claude-code-cli-session` source. There is intentionally no Master
  fallback pool: one Claude.ai subscription login is the only source.

## Prerequisites

- Node.js 20+
- The `claude` CLI installed and authenticated with a Claude.ai Pro/Max
  account (`claude auth login`), reachable on your `PATH` — used by Master
  Brain and agents whose `runtime` is `"claude-code"`.
- The `opencode` CLI installed and authenticated, reachable on your `PATH`
  — used by agents whose `runtime` is `"opencode"`. See below.
- No Anthropic Console account, API billing, `creds.env`, or
  `ANTHROPIC_API_KEY` is required.

### Setting up OpenCode

OpenCode does **not** read a simple `OPENCODE_API_KEY`-style environment
variable the way Claude Code reads `ANTHROPIC_API_KEY`. It keeps its own
credential store (`~/.local/share/opencode/auth.json`) and config
(`~/.config/opencode/opencode.jsonc`), populated by running:

```bash
opencode auth login
```

(or `opencode providers login`) once, interactively, before starting this
project's server. `packages/adapters/opencode/src/index.ts` spawns the CLI
with the parent process's environment as-is — it doesn't inject or expect
any OpenCode-specific env var, since OpenCode's own login flow is the
supported way to authenticate it.

The adapter also hardcodes a model string
(`opencode/nemotron-3.5-lightning-free`), chosen after manually verifying it
actually writes files and returns in 15-50s. This account's CLI default,
`opencode/muse-spark-1.3-contributor-free`, also works but took 7+ minutes
on a simple single-file write during verification — too slow for a live
demo. If your OpenCode login doesn't have access to the hardcoded model,
override it per-agent by setting `agent.model` where agents are constructed
in `apps/server/src/index.ts`, or pass a different `provider/model` string
— run `opencode models` to see what's available to your account.

### Setting up Cline

`packages/adapters/cline` (used by `agent-05`, `runtime: "cline"`) spawns
the real `cline` CLI (npm package `cline`, v3.0.62 at time of writing) in
its headless `--json` mode. Two ways to authenticate, same shape as
`ANTHROPIC_API_KEY` for Claude Code:

```bash
export CLINE_API_KEY=...   # Cline's own hosted "cline" provider — has free-tagged models
```

or run `cline auth` interactively once to log in / configure a BYOK
provider; the adapter falls back to that cached session if `CLINE_API_KEY`
isn't set, same "CLI manages its own login independently" story as
OpenCode. Defaults to `cline-free/deepseek-v4.1-flash` ("DeepSeek V4.1
Flash (free)"), a genuinely free-tagged model confirmed live against the
installed CLI — see `packages/adapters/cline/src/index.ts` and
[`docs/runtime-research-v0.13.md`](./docs/runtime-research-v0.13.md) for
how that was verified (including the real NDJSON event shapes this CLI
version emits, which differ from its own published docs). Free models are
capped on a daily quota that resets at a fixed time each day; a capped-out
run fails cleanly (`INFERENCE_CAP_ERROR`) instead of hanging. Override the
model with `agent.model` for a different free-tagged model or a BYOK
provider/model.

### Setting up the Master

`packages/adapters/master-anthropic` runs Claude Code in headless print mode:

```bash
claude auth login   # choose your Claude.ai Pro/Max account once
claude auth status --json
npm run dev
```

Each request uses `--output-format json`; planning additionally uses
`--json-schema`, so the program reads `structured_output` from one clean CLI
JSON envelope. For compatibility it can also parse JSON from the envelope's
text `result`, including a fenced JSON block. A malformed plan is retried
once and then fails explicitly. CLI/process errors, subscription limit
errors, and the 120-second timeout are not blindly retried.

The Master subprocess explicitly deletes `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, their configured backup forms,
and alternate cloud-provider selectors from its inherited environment. It
therefore cannot silently switch to the old Console-key/gateway route.
`AI_OFFICE_MASTER_MODEL` can optionally select a model; otherwise Claude
Code uses the model available to the logged-in subscription.

See [`docs/claude-code-headless-master.md`](./docs/claude-code-headless-master.md)
for the official-source research, exact flags, output contract, and live
verification evidence.

## Running locally

```bash
npm install
npm run dev
```

This starts the server (`apps/server`, WebSocket + REST, default port
`43117`) and the web UI (`apps/web`, Vite dev server, default port `43118`)
together. These deliberately avoid the ports most development tools use.
Override them with `AI_OFFICE_SERVER_PORT` and `AI_OFFICE_WEB_PORT`:

```bash
AI_OFFICE_SERVER_PORT=44117 AI_OFFICE_WEB_PORT=44118 npm run dev
```

The dev launcher records only its own child-process identity in
`.ai-office-dev/`. On the next launch it may stop a verified stale process
from this same checkout. If a requested port belongs to anything else (or
cannot be verified), that process is left untouched and AI Office advances
to the next free port. The log always prints the selected server and web
ports; open the web URL Vite prints.

To run them separately:

```bash
npm run dev:server
npm run dev:web
```

## Using it

1. Open the web UI — the default roster has 13 agents. To configure a larger
   fleet, set `AI_OFFICE_AGENT_COUNTS` in `apps/server/.env.local` to an exact
   count per runtime and restart the server. The supported runtime keys are
   `claude-code`, `opencode`, `cline`, and `codex`, with up to 500 agents in
   total. `AI_OFFICE_MAX_CONCURRENT_AGENTS` separately limits simultaneously
   running CLI processes (default 16). See the Quickstart example below.
2. Fill in a task description, a real local folder path, and optionally
   check which capabilities the task needs (`backend`/`frontend`/`testing`/
   `docs`), then dispatch it. You can dispatch several tasks back to back —
   they run in parallel on whichever eligible agents are free.
3. A matched agent walks to a workstation; its live progress (parsed from
   whichever CLI's structured output format that runtime uses) appears as a
   speech bubble and, in the detail panel, as raw scrolling log lines. This
   looks and behaves identically regardless of which CLI is actually running
   underneath.
4. If no eligible agent is free yet, the task shows up in the **Queue**
   panel instead of failing, and gets dispatched automatically once an
   agent frees up or becomes eligible.
5. Two tasks targeting the *same* folder never run at the same time — the
   second one's agent shows "waiting for workspace…" until the first
   finishes.
6. When a CLI process exits, the agent returns to the Public Area and a
   completion (or failure) card appears.
7. Instead of the manual form, type one sentence into the **high-level
   goal** box (with a local folder path) and submit it. A goal card appears
   showing "🧠 Master is planning…"; once the Master calls back with its
   decomposed plan, the resulting subtasks flow through the exact same
   dispatch/queue/completion UI as step 2-6 above — they just happen to
   share a colored border/dot tying them back to their goal card. When every
   subtask has settled, the goal card is replaced with the Master's
   plain-text summary. If planning itself fails (bad/missing credential, the
   model not calling its tool, malformed JSON), the goal card shows the
   failure instead — nothing else on screen is affected.

## Project layout

```
packages/core                    shared types, event schema, Orchestrator (dispatch + capability
                                  matching + per-workspace lock), GoalCoordinator, MasterBrain
                                  interface, shared CLI-adapter helpers, CredentialRouter
                                  (packages/core/src/credentials)
packages/adapters/claude-code    Claude Code CLI adapter (implements RuntimeAdapter)
packages/adapters/opencode       OpenCode CLI adapter (implements RuntimeAdapter)
packages/adapters/cline          Cline CLI adapter (implements RuntimeAdapter)
packages/adapters/codex          Codex CLI adapter (implements RuntimeAdapter)
packages/adapters/master-anthropic  Claude Code CLI headless MasterBrain (implements MasterBrain)
apps/server                      WebSocket + REST server; registers the agent roster
                                  (id -> runtime -> eligibleCapabilities), the
                                  runtime -> adapter table, and the GoalCoordinator
apps/web                         React + PixiJS office UI
```

`RuntimeAdapter` (`packages/core/src/runtime/adapter.ts`) is the interface
the Orchestrator talks to for running a task. `spawnRuntimeProcess`
(imported from `@ai-office/core/node` — a separate subpath so the
Node-only `child_process` code never gets pulled into the browser bundle)
is the shared spawn → line-by-line JSON-tolerant-parse → exit skeleton both
adapters build on; a new adapter only needs to write the part that maps one
CLI's own JSON line shape to a `RuntimeEvent`.

`MasterBrain` (`packages/core/src/master/brain.ts`) is the analogous
interface for the planning step: `plan(goal)` decomposes a goal into
`PlannedTask[]`, `summarize(goal, results)` writes the final report. Its
adapter invokes the logged-in Claude Code CLI as a restricted, headless
subprocess and parses the CLI's JSON output; it never calls the Anthropic
Messages API SDK or reads a Console API key.
`GoalCoordinator` (`packages/core/src/master/goal-coordinator.ts`) sits
beside the Orchestrator (not inside it): it turns one goal into several
`Orchestrator.submitTask()` calls tagged with a shared `goalId`, and
observes the same `OfficeEvent` stream the Orchestrator already broadcasts
to know when to call `summarize()`. Adding a second `MasterBrain`
(e.g. Codex/Gemini) means writing one more file next to
`master-anthropic`; neither the Orchestrator nor `GoalCoordinator` change.
