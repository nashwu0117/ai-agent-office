# Quickstart

One page to get back into this project without asking anyone anything.
Everything here is current as of v0.14. For the full feature list and
architecture, see [`README.md`](./README.md).

## 1. Start it

```bash
npm install     # only needed once, or after pulling dependency changes
npm run dev
```

This starts **both** halves together:

- `apps/server` — WebSocket + REST orchestrator, default port `43117`
- `apps/web` — the React/PixiJS office UI (Vite dev server), default port `43118`

The launcher prints the ports it actually selected (it auto-advances past a
port that's in genuine use by something else) — open whatever URL it prints
for the web app. It also records its own process identity under
`.ai-office-dev/`, so running `npm run dev` again safely reclaims the ports
from a stale run of this same checkout instead of erroring.

Run the two halves separately if you want independent restart control:

```bash
npm run dev:server
npm run dev:web
```

Override the ports with `AI_OFFICE_SERVER_PORT` / `AI_OFFICE_WEB_PORT` if
`43117`/`43118` are unavailable.

## 2. What already works, no key required

These all use a CLI already logged into a subscription on this machine —
nothing to fill in:

| What | Backed by | Status |
|---|---|---|
| Master Brain (the "high-level goal" box) | `claude` CLI, Claude.ai Pro/Max login | ready — `claude auth login` already done |
| agent-02, agent-03 | Claude Code, official Anthropic subscription | ready |
| agent-04, agent-05 | OpenCode CLI | ready — `opencode auth login` already done |
| agent-01 | Claude Code routed through the `nvidia-real` backend profile | ready per the Backend & Credentials panel (its key is already set in `apps/server/.env.local`) — see the caveat below |

**Caveat on agent-01 / `nvidia-real`:** the panel showing "Ready" only means
its two env vars are set, not that every task will succeed — during this
check a real dispatched task on this profile failed with a generic CLI
error unrelated to any of v0.14's own changes (real third-party backends
can be flaky, rate-limited, or have since deprecated the configured model).
If it fails again, check the agent's "Live CLI output" in the detail panel
first.

agent-06 (`mock-openai`) is a dev/test-only profile — it needs
`npm run mock-openai` (in `apps/server`) running locally and isn't meant for
real tasks.

## 3. What needs a key first

Nine agents are wired to real third-party backends but need credentials.
Set these in `apps/server/.env.local` (git-ignored — never commit real
values) and restart the server; as of v0.14 that file is actually loaded
(`tsx --env-file-if-exists=.env.local`, wired into both `npm run dev` and
`npm run start` — previously it was documentation-only and silently
ignored, fixed in this pass).

```bash
# apps/server/.env.local — fill in only what you're setting up

# agent-08 / NVIDIA NIM #1 — https://build.nvidia.com (create an API key)
AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_1_MODEL=          # e.g. meta/llama-3.1-70b-instruct

# agent-09 / NVIDIA NIM #2 — same source as above, a second key
AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_2_MODEL=

# agent-10 / NVIDIA NIM #3 — same source, a third key
AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_3_MODEL=

# agent-11 / b.ai #1 — https://b.ai (API key from your b.ai account)
AI_OFFICE_BACKEND_BAI_1_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_1_AUTH_TOKEN=

# agent-12 / b.ai #2 — same source, a second key
AI_OFFICE_BACKEND_BAI_2_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_2_AUTH_TOKEN=

# agent-13 / b.ai #3 — same source, a third key
AI_OFFICE_BACKEND_BAI_3_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_3_AUTH_TOKEN=

# agent-14 / platform.experientiallabs.ai — https://platform.experientiallabs.ai
# Also set this agent's `model` in AGENT_ROSTER (apps/server/src/index.ts) to
# a dot-form gateway slug your key is actually granted (e.g. "claude-opus-5"),
# or requests fail with 403 model_not_granted.
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_BASE_URL=https://api.experientiallabs.ai
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_AUTH_TOKEN=

# agent-07 / Cline runtime (not a BackendProfile — its own CLI/credential)
# Source: Cline's own hosted provider has free-tagged models; get a key via
# the cline CLI's own login, or run `cline auth` interactively instead.
CLINE_API_KEY=
```

Until a var is filled in, its agent still shows up and looks "available" in
the UI — dispatching a task to it just fails fast and clearly (a
"⚙ Backend profile error" card) instead of silently spending someone else's
quota. Full background on why each backend speaks the API shape it does:
[`docs/backend-profiles-v0.13.md`](./docs/backend-profiles-v0.13.md).

## 4. Dispatching work from the web UI

Two ways to hand off work, both feeding the same dispatch/queue/completion
pipeline:

1. **High-level goal** (top box): type one sentence plus a local folder
   path, submit. A goal card appears ("🧠 Master is planning…"), then shows
   how many subtasks it decomposed the goal into and dispatches them
   automatically. When every subtask settles, the card is replaced by the
   Master's plain-text summary.
2. **Manual task** (second box): type a task description, a folder path,
   and check which capabilities it needs yourself
   (`backend`/`frontend`/`testing`/`docs`), then dispatch.

Either way: if no eligible agent is free, the task shows up in the
**Queue** panel on the right instead of failing, and dispatches
automatically once one frees up. Click any agent (in the office scene, or
via the accessible agent list if the canvas is in the way — see known
limitations below) to open its detail panel and watch raw CLI output
stream in live. When a task finishes, a completion (or failure) card
appears at the bottom of the main column.

## 5. Setting the default backend

The **Backend & Credentials** button in the header opens a panel with:

- **Credential sources** — the two subscription-based sources
  (`claude-code-cli`, `opencode-native`) plus Cline's own `cline`/`CLINE_API_KEY`
  source, and whether each looks usable. The Cline row used to disappear
  entirely instead of showing "Unavailable" when the key wasn't set — fixed
  in this pass (`packages/core/src/credentials/factory.ts`).
- **Backend profiles** — every registered profile, its API format, which
  two (or three) env vars it needs, and a live **Ready** / **Missing env
  var(s)** status per profile (never the secret values themselves).
- **Default backend profile** — a dropdown of every registered profile
  plus "Official (Anthropic)". This sets which profile any *newly added,
  unassigned* agent falls back to; it doesn't retroactively move an agent
  that already has its own profile (from `AGENT_ROSTER` or a per-agent
  override). Per-agent overrides are set from each agent's own row in this
  same panel.

## 6. Known limitations

- **Freebuff has no adapter.** Its CLI has no headless or API surface at
  all (confirmed twice — see
  [`docs/runtime-research-v0.13.1.md`](./docs/runtime-research-v0.13.1.md)).
  Not a bug to fix; there's nothing to integrate against yet.
- **cc-switch can't route concurrent agents to different backends** — it's
  a single global active-profile switch (desktop GUI + one active config),
  not a per-request routing mechanism, so this project talks to each
  backend directly instead of through it. Full research:
  [`docs/cc-switch-research.md`](./docs/cc-switch-research.md).
- **PixiJS `addChild` deprecation warning** in the browser console
  (`Only Containers will be allowed to be added`, from `sign.addChild(textLayer)`
  in `addZoneSign`, `OfficeScene.tsx`) — cosmetic console noise, not a
  runtime break. The code path is unchanged as of v0.14 (confirmed by
  reading the source); the live-console behavior itself wasn't
  re-confirmed this round since no browser tool was available in that
  session — see
  [`docs/pending-font-layout-integration-check.md`](./docs/pending-font-layout-integration-check.md).
- **The accessible agent list can be behind the canvas for mouse users.**
  `.agent-access-list` (screen-reader-first agent list) may still be
  visually covered by the office canvas in some layouts, so a sighted
  mouse user may need to click the agent's sprite in the scene itself
  rather than this list. Not independently re-confirmed live this round
  (same reason as above) — see the doc linked above for the full history
  and what was and wasn't re-checked.
