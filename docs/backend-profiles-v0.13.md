# v0.13 Part D: backend profile expansion — environment variables to set

This lists exactly which environment variables to add to `apps/server/.env.local`
(git-ignored — see Part F below) for each backend profile added in v0.13.
**No key values appear in this file or anywhere else in the repo** — only
the variable *names* the server reads them from, per this project's own
credential-handling rule (see `BackendProfile`'s doc-comment in
`packages/core/src/credentials/backend-profile.ts`).

Every profile below is pre-registered in `AGENT_ROSTER`
(`apps/server/src/index.ts`) against one dedicated agent, so as soon as its
two (or three) env vars are set and the server is restarted, that agent's
next dispatched task actually uses it — no other setup needed. Until then,
the agent still registers and appears "available" in the UI, but any task
dispatched to it fails fast with a clear `backendProfileError` instead of
silently falling back to the official Anthropic credential (existing v0.8
behavior, unchanged).

## NVIDIA NIM ×3 (`nvidia-1` / `nvidia-2` / `nvidia-3` → `agent-08`/`09`/`10`)

Speaks OpenAI Chat Completions (confirmed against a real NVIDIA NIM backend
in v0.11 — see `docs/api-format-translation.md`), so each also needs a
`_MODEL` override var (v0.11's `modelOverrideEnvVar` mechanism): the `claude`
CLI sends an Anthropic model id these backends don't recognize, so the
local format-translation proxy substitutes this value before forwarding.

| Profile | Base URL env var | Auth token env var | Model override env var |
|---|---|---|---|
| `nvidia-1` | `AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL` | `AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN` | `AI_OFFICE_BACKEND_NVIDIA_1_MODEL` |
| `nvidia-2` | `AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL` | `AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN` | `AI_OFFICE_BACKEND_NVIDIA_2_MODEL` |
| `nvidia-3` | `AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL` | `AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN` | `AI_OFFICE_BACKEND_NVIDIA_3_MODEL` |

Base URL is NVIDIA's OpenAI-compatible endpoint's root (ending in `/v1`,
same convention as the existing `mock-openai`/`nvidia-real` profiles), e.g.
`https://integrate.api.nvidia.com/v1`. Model override is whatever NIM model
slug that key actually has access to, e.g. `meta/llama-3.1-70b-instruct`.

## b.ai ×3 (`bai-1` / `bai-2` / `bai-3` → `agent-11`/`12`/`13`)

Speaks the real Anthropic Messages API at `/v1/messages` (confirmed against
`docs.b.ai/llmservice/api/` — see `docs/runtime-research-v0.13.md`), so
these are byte-passthrough `anthropic`-format profiles — no model-override
var (the CLI's own model id is forwarded as-is; b.ai's own model catalog
determines what's valid there).

| Profile | Base URL env var | Auth token env var |
|---|---|---|
| `bai-1` | `AI_OFFICE_BACKEND_BAI_1_BASE_URL` | `AI_OFFICE_BACKEND_BAI_1_AUTH_TOKEN` |
| `bai-2` | `AI_OFFICE_BACKEND_BAI_2_BASE_URL` | `AI_OFFICE_BACKEND_BAI_2_AUTH_TOKEN` |
| `bai-3` | `AI_OFFICE_BACKEND_BAI_3_BASE_URL` | `AI_OFFICE_BACKEND_BAI_3_AUTH_TOKEN` |

Base URL is the host only, **no `/v1` suffix** — `https://api.b.ai` — since
the `claude` CLI itself appends `/v1/messages` and this repo's proxy just
concatenates `baseUrl + requestPath` for `anthropic`-format profiles (see
`passthroughToAnthropic` in `apps/server/src/proxy-server.ts`). Auth token
is your b.ai API key (`sk-...`).

## platform.experientiallabs.ai ×1 (`experientiallabs-1` → `agent-14`)

Also the real Anthropic Messages API (confirmed against
`platform.experientiallabs.ai/docs/coding-agents` — see
`docs/runtime-research-v0.13.md`), same byte-passthrough shape as b.ai
above.

| Profile | Base URL env var | Auth token env var |
|---|---|---|
| `experientiallabs-1` | `AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_BASE_URL` | `AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_AUTH_TOKEN` |

Base URL, again host only, no `/v1` suffix: `https://api.experientiallabs.ai`.
Auth token is your gateway key (`xpl_<40 hex>`). One extra step specific to
this gateway: its model ids are **dot-form** gateway slugs (e.g.
`claude-opus-5`), not Anthropic's own dashed wire ids — set the agent's
`model` field in `AGENT_ROSTER` (`apps/server/src/index.ts`) to a slug this
gateway actually grants your key, or requests fail with `403
model_not_granted`. If you route a non-Claude model through it, also see
the gateway's own note about setting `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to
avoid premature context compaction.

## Runtime credential (not a `BackendProfile`): Cline

Cline is a different *runtime* (`runtime: "cline"`, `agent-07`), not a
Claude Code backend profile — it doesn't go through
`BackendProfile`/the format-translation proxy at all, since it's a whole
separate CLI binary (`packages/adapters/cline`). Its one credential is:

| Purpose | Env var |
|---|---|
| Cline's own hosted "cline" provider (free-tagged models) | `CLINE_API_KEY` |

If unset, the adapter falls back to whatever `cline auth` login session is
already cached under `~/.cline` on this machine (same as OpenCode's
credential story) — see the README's "Setting up Cline" section.

## Example `.env.local` skeleton (names only — fill in real values yourself)

```bash
# apps/server/.env.local — git-ignored, never commit real values here

# NVIDIA NIM x3
AI_OFFICE_BACKEND_NVIDIA_1_BASE_URL=
AI_OFFICE_BACKEND_NVIDIA_1_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_1_MODEL=
AI_OFFICE_BACKEND_NVIDIA_2_BASE_URL=
AI_OFFICE_BACKEND_NVIDIA_2_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_2_MODEL=
AI_OFFICE_BACKEND_NVIDIA_3_BASE_URL=
AI_OFFICE_BACKEND_NVIDIA_3_AUTH_TOKEN=
AI_OFFICE_BACKEND_NVIDIA_3_MODEL=

# b.ai x3
AI_OFFICE_BACKEND_BAI_1_BASE_URL=
AI_OFFICE_BACKEND_BAI_1_AUTH_TOKEN=
AI_OFFICE_BACKEND_BAI_2_BASE_URL=
AI_OFFICE_BACKEND_BAI_2_AUTH_TOKEN=
AI_OFFICE_BACKEND_BAI_3_BASE_URL=
AI_OFFICE_BACKEND_BAI_3_AUTH_TOKEN=

# platform.experientiallabs.ai x1
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_BASE_URL=
AI_OFFICE_BACKEND_EXPERIENTIALLABS_1_AUTH_TOKEN=

# Cline runtime (not a BackendProfile)
CLINE_API_KEY=
```

Any var left blank simply means that one profile/agent stays unavailable
(fails fast on dispatch) until filled in — every other already-working
agent/profile is unaffected.
