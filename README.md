# AI Office

An open-source "AI company" office: instead of a wall of terminals, you see a
2D pixel-art office where each worker corresponds to a real coding CLI agent.
Idle workers wander the Public/Talent Area; once assigned a task they walk to
a workstation, work, and return when done.

## Status: vertical slice (v0.7)

This is a progressively-built vertical slice, not the full product vision.
So far:

- 5 agents, backed by **two different real CLI backends** — Claude Code and
  OpenCode — dispatched through a shared `RuntimeAdapter` interface
  (`packages/core/src/runtime/adapter.ts`). Adding a third CLI means
  implementing that interface, not touching the Orchestrator or the UI.
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
  (`packages/core/src/master/brain.ts`) — an LLM call, not a CLI subprocess
  — decomposes it into several subtasks and judges each one's
  `requiredCapabilities` itself, via Anthropic tool-use
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
- Provider credentials go through a `CredentialRouter`
  (`packages/core/src/credentials`) instead of each piece reading one
  hardcoded env var: `AnthropicMasterBrain` and `ClaudeCodeAdapter` both
  resolve the same `"anthropic"` provider, so a second `ANTHROPIC_API_KEY_BACKUP`
  is picked up automatically and, if the primary key ever gets a 401/403/429
  from the live API, the very same `plan()`/`summarize()` call retries once
  against the backup instead of failing outright. A source that fails is
  skipped for the rest of that process — see "Setting up the Master" below.
  The server logs every detected source's id/provider/availability at
  startup (never the secret value), and the header shows a live
  "Credentials: N/M available" pill fed by the same router.

## Prerequisites

- Node.js 20+
- The `claude` CLI installed and authenticated (`claude auth`), reachable on
  your `PATH` — used by agents whose `runtime` is `"claude-code"`.
- The `opencode` CLI installed and authenticated, reachable on your `PATH`
  — used by agents whose `runtime` is `"opencode"`. See below.
- An Anthropic API credential for the **Master** planning step. See
  "Setting up the Master" below — this is separate from the `claude` CLI's
  own login.

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

### Setting up the Master

`packages/adapters/master-anthropic` calls the Anthropic Messages API
directly with the official SDK — it does **not** shell out to the `claude`
CLI, so simply having `claude` logged in interactively does not cover it.
Two credential shapes both work:

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # a raw API key, OR
export ANTHROPIC_AUTH_TOKEN=sk-ant-oat...  # a long-lived token from `claude setup-token`
                                            # (uses your Claude subscription, no separate API billing)
# optional:
export ANTHROPIC_BASE_URL=...         # custom endpoint, if you use one
export ANTHROPIC_MASTER_MODEL=...     # defaults to claude-haiku-4-5-20251001
```

before starting the server. **Model availability varies by credential.**
This project's own `claude setup-token` credential consistently returned
`429 rate_limit_error` for `claude-sonnet-5` (confirmed with isolated
single-message calls, not assumed) but worked immediately on
`claude-haiku-4-5-20251001` — that's why that's the hardcoded default. If
your credential has different access, override it with
`ANTHROPIC_MASTER_MODEL`.

**Optional: one or more backup credentials.** Set `ANTHROPIC_API_KEY_BACKUP`
(and, if you need more, `_BACKUP2`/`_BACKUP3`/`_BACKUP4`) — or the same
suffixes on `ANTHROPIC_AUTH_TOKEN` — to give the `CredentialRouter`
somewhere to fail over to. If the primary gets a 401/403/429 from a live
call, that source is marked failed for the rest of this process and the
very same `plan()`/`summarize()` call retries once against the next
available one, so a rotated/rate-limited key doesn't take down Master
planning for the whole session (only a server restart clears a source
marked failed — there's no automatic recovery in this phase). Both
`ClaudeCodeAdapter` and `AnthropicMasterBrain` resolve the same
`"anthropic"` provider from the router, so a backup key covers both.

If no `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (or backup) is set, or
every configured one has already failed, the server still starts fine and
every other feature (including the manual task path) keeps working — only
`POST /api/goals` fails, cleanly, with a `goal_failed` event (`authFailure:
true`) explaining the missing/exhausted credential instead of a crash. This
was verified by hand in this project's own dev environment before a
credential was added — that failure path is what actually ran before
`claude setup-token` was used to add one. The server also logs every
detected credential source's id/provider/availability at startup — check
that output first if `POST /api/goals` isn't working as expected.

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

1. Open the web UI — you should see 5 agents wandering the Public/Talent
   Area. Agents `agent-01`..`03` run on Claude Code, `agent-04`/`05` run on
   OpenCode (click an agent to see its `Runtime` in the detail panel).
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
packages/adapters/master-anthropic  Anthropic Messages API MasterBrain (implements MasterBrain)
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
`PlannedTask[]`, `summarize(goal, results)` writes the final report. It
calls an LLM API directly rather than wrapping a CLI subprocess, since
Master never needs filesystem/shell access — only structured input/output.
`GoalCoordinator` (`packages/core/src/master/goal-coordinator.ts`) sits
beside the Orchestrator (not inside it): it turns one goal into several
`Orchestrator.submitTask()` calls tagged with a shared `goalId`, and
observes the same `OfficeEvent` stream the Orchestrator already broadcasts
to know when to call `summarize()`. Adding a second `MasterBrain`
(e.g. Codex/Gemini) means writing one more file next to
`master-anthropic`; neither the Orchestrator nor `GoalCoordinator` change.
