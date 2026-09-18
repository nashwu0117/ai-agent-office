# Quickstart

_English version. The web UI itself is bilingual (Traditional Chinese / English, toggle in the top-right corner) as of v0.17 — this document is English-only._

One page to get back into this project without asking anyone anything.
Everything here is current as of v0.21. For the full feature list and
architecture, see [`README.md`](./README.md).

## 0. First-time use checklist

If you're starting from zero, do these in order:

1. **Decide if you need `AI_OFFICE_ACCESS_PASSWORD`.** Only required if
   you'll reach this app through something other than
   `localhost`/`127.0.0.1` (a Cloudflare Tunnel, a reverse proxy, another
   machine on your LAN). Plain localhost use needs nothing here. See
   [§2](#2-access-control-if-you-expose-this-beyond-localhost).
2. **Log in to whichever CLIs back the agents you want to use** — nothing
   in this project needs an Anthropic Console API key:
   - `claude auth login` — the two official Claude Code agents + Master Brain.
   - `opencode auth login` — the OpenCode agent.
   - `codex login` — the Codex agent.
   - `cline auth` (or set `CLINE_API_KEY`) — the Cline agent.
3. **If you want any of the 8 third-party-backend agents (3 NVIDIA, 3 b.ai,
   1 Experiential Labs, 1 vyceai), fill in their API keys** in
   `apps/server/.env.local` — see [§4](#4-what-needs-a-key-first). Skip
   this if you're fine with 5 of 13 agents (all built-in CLI logins) and
   don't want to spend real third-party quota.
4. **Start the app**: `npm install` (first time only), then `npm run dev`.
5. **Open the web UI** at the URL the launcher prints. If you're going
   through a tunnel and set a password in step 1, you'll see a login
   screen first — enter the password there.
6. **Dispatch something** — a manual task or a high-level goal, both
   described in [§5](#5-dispatching-work-from-the-web-ui).

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

## 2. Access control (if you expose this beyond localhost)

As of v0.18 — added because this project only ever assumed a single
operator on localhost through v0.16, and that stopped being true the moment
it got put behind a Cloudflare Tunnel for outside access.

- **Plain `http://localhost:43118` use is unchanged** — no password, same
  as always. The gate only engages when a request's `Host` header isn't
  `localhost`/`127.0.0.1`/`::1` (e.g. arriving through a tunnel or reverse
  proxy).
- **Turn it on:**
  ```bash
  # apps/server/.env.local
  AI_OFFICE_ACCESS_PASSWORD=choose-a-real-password-here
  ```
  Restart the server. Anyone reaching the app through a non-localhost
  hostname now sees a login screen first; every `/api` route and the
  WebSocket feed refuse to do anything without it. A successful login sets
  an `httpOnly` session cookie good for 30 days; the header's **Log out**
  button (shown only when the gate is active) clears it early.
- **If you don't set `AI_OFFICE_ACCESS_PASSWORD`: there is no default
  password.** Every non-localhost request is refused outright (`503`), not
  silently allowed through. The server says so loudly at startup.
- `AI_OFFICE_REQUIRE_AUTH=true` forces the login gate even on localhost
  (useful for testing it, or if you'd rather always require a session
  regardless of `Host`).
- `AI_OFFICE_ALLOWED_ORIGINS` — comma-separated extra CORS origins, on top
  of the built-ins (`http://localhost:43118`/`http://127.0.0.1:43118` and
  this project's own Cloudflare Tunnel hostname,
  `https://your-tunnel-host.example`, from `~/.cloudflared/config.yml`).
  Only needed if you add another hostname later.
- **Rate limits** on top of the login gate: login attempts (10/15 min),
  task/goal dispatch (30/5 min), backend-profile model listing (30/5 min),
  and a general 300/min ceiling on everything else under `/api`. These are
  effectively *per-server*, not per-remote-client — cloudflared and the
  Vite dev proxy both run on this same machine, so every request reaches
  Express from `127.0.0.1` regardless of the real external caller (see
  `apps/server/src/rate-limits.ts`'s doc comment).
- **What this deliberately doesn't do:** no accounts, no roles, no
  password rotation/expiry, and no defense once someone already has the
  password — one shared secret for one operator, matching this project's
  explicit scope. It also only protects `apps/server`'s own routes; it does
  not inspect or change your actual Cloudflare Tunnel/Access setup — if you
  want Cloudflare-side authentication too (Cloudflare Access, requiring
  login before cloudflared even forwards the request), set that up
  separately in the Cloudflare Zero Trust dashboard.

## 3. What already works, no key required

As of v0.21 there are **13 agents**, across 8 provider slots. Five agents
authenticate through their own CLI's login session — nothing to fill in as
an env var:

| What | Backed by | Status |
|---|---|---|
| Master Brain (the "high-level goal" box) | `claude` CLI, Claude.ai Pro/Max login | ready — `claude auth login` already done |
| agent-01, agent-02 | Claude Code, official Anthropic subscription | ready |
| agent-03 | OpenCode CLI | ready — `opencode auth login` already done |
| agent-04 | Codex CLI (OpenAI), `codex login` session | see the **Codex verification** note below |
| agent-05 | Cline CLI, `cline auth` login (free-tagged model by default) | ready if you've run `cline auth`; `CLINE_API_KEY` is an optional alternative/override, not a requirement — see §4 |

**Codex verification (from v0.20, re-confirmed still applies):**
`CodexAdapter` is registered in `AGENT_ROSTER` for `agent-04`
(`runtime: "codex"`), and the credential factory checks for a real login
session at `~/.codex/auth.json`, reporting the agent as
unavailable-but-still-visible rather than silently pretending to work if
you haven't run `codex login`. A prior round of this project actually
dispatched a real task end-to-end through the full Orchestrator →
CodexAdapter → real `codex exec --json` process pipeline (not a mock) this
way. **If you haven't run `codex login` on your own machine, this agent
will show as available in the UI but every dispatched task will fail fast
with an auth/login error from the `codex` CLI itself — run `codex login`
first, then it works the same way.**

**Caveat on third-party profiles in general:** the "Ready" status in the
Backend & Credentials panel only means the required env vars are set, not
that every task will succeed — third-party backends can be flaky,
rate-limited, or have since deprecated the configured model. If a task
fails, check the agent's "Live CLI output" in the detail panel first.

The `mock-openai` BackendProfile is a dev/test-only demo of the
translated-backend proxy path — it needs `npm run mock-openai` (in
`apps/server`) running locally by hand and isn't assigned to any agent by
default; it isn't meant for real tasks.

## 4. What needs a key first

8 agents (`agent-06` through `agent-13`) are wired to real third-party
backends and need credentials. Set these in `apps/server/.env.local`
(git-ignored — never commit real values) and restart the server
(`tsx --env-file-if-exists=.env.local`, wired into both `npm run dev` and
`npm run start`).

```bash
# apps/server/.env.local — fill in only what you're setting up

# agent-06 / NVIDIA NIM #1 — https://build.nvidia.com (create an API key)
AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_1_MODEL=          # e.g. meta/llama-3.1-70b-instruct

# agent-07 / NVIDIA NIM #2 — same source as above, a second key
AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_2_MODEL=

# agent-08 / NVIDIA NIM #3 — same source, a third key
AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL=https://integrate.api.nvidia.com/v1
AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_3_MODEL=

# agent-09 / b.ai #1 — https://b.ai (API key from your b.ai account)
AI_OFFICE_BACKEND_BAI_1_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_1_AUTH_TOKEN=

# agent-10 / b.ai #2 — same source, a second key
AI_OFFICE_BACKEND_BAI_2_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_2_AUTH_TOKEN=

# agent-11 / b.ai #3 — same source, a third key
AI_OFFICE_BACKEND_BAI_3_BASE_URL=https://api.b.ai
AI_OFFICE_BACKEND_BAI_3_AUTH_TOKEN=

# agent-12 / platform.experientiallabs.ai — https://platform.experientiallabs.ai
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_BASE_URL=https://api.experientiallabs.ai
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_AUTH_TOKEN=

# agent-13 / vyceai — https://vyceai.com. NEW in v0.21 — its exact wire
# format (Anthropic Messages vs. OpenAI Chat Completions) was not confirmed
# from official docs (none were found; see README's "vyceai research"
# note), so its apiFormat ships "unset". Fill in the URL/key here, then go
# to the Backend & Credentials panel and pick the correct API format for
# it yourself before dispatching a task through it — the panel will not
# guess, and refuses to route a task through an "unset" profile with a
# clear error instead of misinterpreting its bytes.
AI_OFFICE_BACKEND_VYCEAI_1_BASE_URL=
AI_OFFICE_BACKEND_VYCEAI_1_AUTH_TOKEN=

# agent-05 / Cline runtime (optional — not a BackendProfile, its own
# CLI/credential; agent-05 already works via `cline auth` login without
# this, see §3). Only set this if you specifically want Cline's own
# hosted "cline" provider or a different free-tagged model via override.
CLINE_API_KEY=
```

Per-role model mapping (which upstream model id to send when the CLI
requests Sonnet/Opus/Fable/Haiku, plus a Subagent catch-all and a Fallback
model), custom headers, and a custom JSON body override are all set from
the Backend & Credentials panel now too (v0.21) — see §7.

Until a var is filled in, its agent still shows up and looks "available" in
the UI — dispatching a task to it just fails fast and clearly (a
"⚙ Backend profile error" card) instead of silently spending someone else's
quota. Full background on why each backend speaks the API shape it does:
[`docs/backend-profiles-v0.13.md`](./docs/backend-profiles-v0.13.md).

## 5. Dispatching work from the web UI

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

## 6. Language

Click the **EN** / **中文** button in the top-right header to toggle the
whole UI between English and Traditional Chinese (added in v0.17). It's a
plain client-side toggle — no restart, no server involvement, and it
doesn't affect this document (English-only) or any other `.md` file.

## 7. Backend & Credentials panel

The **Backend & Credentials** button in the header opens a panel with:

- **Credential sources** — the subscription-based sources
  (`claude-code-cli`, `opencode-native`, `codex-native`) plus Cline's own
  `cline`/`CLINE_API_KEY` source, and whether each looks usable.
- **Backend profiles** (v0.21: rebuilt as a cc-switch-style single-provider
  editor) — a left-hand list of every provider (every registered
  `BackendProfile`, plus the four CLI-login providers: Claude Code
  official, OpenCode, Codex, Cline). Pick one to edit it in full on the
  right: name, Base URL, API key (never echoed back in plaintext — blank
  means "keep as-is", type/paste a new value to overwrite), upstream API
  format, per-role model mapping (Sonnet/Opus/Fable/Haiku/Subagent, plus a
  Fallback model), custom headers/body overrides for providers that need
  extra static parameters, and a live preview of what the profile actually
  resolves to (secret values always masked). The four CLI-login providers
  show a simplified view instead — just login status and how to log in —
  since they have no Base URL/API key of their own. This replaced the old
  table-of-profiles-plus-add-form UI entirely; there's no "add/delete
  provider" UI (the provider list still comes from `AGENT_ROSTER`/
  `BackendProfile` in `apps/server/src/index.ts`).
- **Default backend profile** — a dropdown of every registered profile
  plus "Official (Anthropic)". This sets which profile any *newly added,
  unassigned* agent falls back to; it doesn't retroactively move an agent
  that already has its own profile (from `AGENT_ROSTER` or a per-agent
  override). Per-agent overrides are set from each agent's own row in the
  agent → backend assignment table further down the same panel.

## 8. Known limitations

- **Freebuff has no adapter.** Its CLI has no headless or API surface at
  all (confirmed twice — see
  [`docs/runtime-research-v0.13.1.md`](./docs/runtime-research-v0.13.1.md)).
  Not a bug to fix; there's nothing to integrate against yet.
- **cc-switch can't route concurrent agents to different backends** — it's
  a single global active-profile switch (desktop GUI + one active config),
  not a per-request routing mechanism, so this project talks to each
  backend directly instead of through it. Full research:
  [`docs/cc-switch-research.md`](./docs/cc-switch-research.md).
- **vyceai's wire format is unconfirmed.** No official API documentation
  was found for it (see README's "vyceai research" note) — its
  `BackendProfile` ships with `apiFormat: "unset"` rather than a guessed
  value, and the proxy refuses to route a task through it until the
  operator picks "Anthropic Messages API" or "OpenAI Chat Completions" for
  it in the Backend & Credentials panel.
- **Role → model mapping's "Subagent" role is a best-effort catch-all, not
  real subagent detection.** Claude Code's outbound request for a
  subagent's own model choice isn't distinguishable from an ordinary
  request for the same model family at the HTTP layer the format-
  translation proxy sees, so `subagent`'s mapping (if set) only catches a
  request that matched none of Sonnet/Opus/Haiku/Fable's own substring
  match — see `RoleModelMap`'s doc comment in
  `packages/core/src/credentials/backend-profile.ts`.
- **The accessible agent list can be behind the canvas for mouse users.**
  `.agent-access-list` (screen-reader-first agent list) may still be
  visually covered by the office canvas in some layouts, so a sighted
  mouse user may need to click the agent's sprite in the scene itself
  rather than this list — see
  [`docs/pending-font-layout-integration-check.md`](./docs/pending-font-layout-integration-check.md)
  for the original history.
