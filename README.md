# AI Office

An open-source "AI company" office: instead of a wall of terminals, you see a
2D pixel-art office where each worker corresponds to a real coding CLI agent.
Idle workers wander the Public/Talent Area; once assigned a task they walk to
a workstation, work, and return when done.

## Status: vertical slice (v0.4)

This is a progressively-built vertical slice, not the full product vision.
So far:

- 5 agents, backed by **two different real CLI backends** — Claude Code and
  OpenCode — dispatched through a shared `RuntimeAdapter` interface
  (`packages/core/src/runtime/adapter.ts`). Adding a third CLI means
  implementing that interface, not touching the Orchestrator or the UI.
- Multiple tasks dispatch and run **concurrently** across different agents;
  a simple workspace lock stops two agents from ever running a CLI against
  the same directory at the same time.
- A fixed, hand-written capability system: each agent has a fixed
  `eligibleCapabilities` list, tasks declare `requiredCapabilities` (picked
  by the user via checkboxes), and the Orchestrator only dispatches a match.
  Tasks that can't be matched yet sit in a visible queue instead of failing.
- Still no real task decomposition or capability inference — one submitted
  description becomes one task, and the user picks capabilities by hand.
  That's intentionally deferred to a future Master-LLM-driven planning
  layer; the Orchestrator's matching logic won't need to change when that
  lands, only where `requiredCapabilities` comes from.
- Pixel art from Kenney's CC0 "Tiny Dungeon" pack — see
  `apps/web/src/assets/ASSET_LICENSE.md` for provenance.

## Prerequisites

- Node.js 20+
- The `claude` CLI installed and authenticated (`claude auth`), reachable on
  your `PATH` — used by agents whose `runtime` is `"claude-code"`.
- The `opencode` CLI installed and authenticated, reachable on your `PATH`
  — used by agents whose `runtime` is `"opencode"`. See below.

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
(`opencode/muse-spark-1.3-contributor-free`) confirmed to work in this
project's dev environment. If your OpenCode login doesn't have access to
that model, override it per-agent by setting `agent.model` where agents are
constructed in `apps/server/src/index.ts`, or pass a different
`provider/model` string — run `opencode models` to see what's available to
your account.

## Running locally

```bash
npm install
npm run dev
```

This starts the server (`apps/server`, WebSocket + REST, default port 4500)
and the web UI (`apps/web`, Vite dev server, prints its own port — usually
5173) together. Open the URL Vite prints.

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

## Project layout

```
packages/core                  shared types, event schema, Orchestrator (dispatch + capability
                                matching + per-workspace lock), shared CLI-adapter helpers
packages/adapters/claude-code  Claude Code CLI adapter (implements RuntimeAdapter)
packages/adapters/opencode     OpenCode CLI adapter (implements RuntimeAdapter)
apps/server                    WebSocket + REST server; registers the agent roster
                                (id -> runtime -> eligibleCapabilities) and the
                                runtime -> adapter table
apps/web                       React + PixiJS office UI
```

`RuntimeAdapter` (`packages/core/src/runtime/adapter.ts`) is the interface
the Orchestrator talks to for running a task. `spawnRuntimeProcess`
(imported from `@ai-office/core/node` — a separate subpath so the
Node-only `child_process` code never gets pulled into the browser bundle)
is the shared spawn → line-by-line JSON-tolerant-parse → exit skeleton both
adapters build on; a new adapter only needs to write the part that maps one
CLI's own JSON line shape to a `RuntimeEvent`.
