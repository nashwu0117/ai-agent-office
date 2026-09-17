# Changelog

Every round from v0.1 through v0.10, oldest to newest. Each round was driven
by a separate written build prompt (not committed to this repo); this file
reconstructs it from `git log` and the docs each round left behind, since no
CHANGELOG existed until now.

A methodology note on precision: most versions below map to an explicit
version string somewhere in the commit history or a doc's own header (noted
inline as "explicit tag"). A few — v0.2, v0.6, v0.6.2, v0.9.1 — have no such
tag; their placement is reconstructed from commit content and chronological
order in `git log`, and is this document's best-effort grouping rather than
a verified historical record.

## v0.10.1 — Master Brain via Claude Code subscription login

Replaced the Master Brain's direct Anthropic Messages API SDK transport with
Claude Code CLI headless mode (`claude -p --output-format json`). Planning
uses `--json-schema` and parses `structured_output`, with a defensive text-
JSON fallback and one retry for malformed model output. The subprocess has a
hard timeout/output cap and strips all Anthropic API-key, auth-token, gateway,
and alternate cloud-provider selectors so it can only use the operator's
existing Claude.ai Pro/Max CLI login.

CredentialRouter now models Master as one `claude-code-cli-session` source;
API-key fallback remains available to worker routing but intentionally has no
meaning for Master. The backend/credential panel labels Master as
"Claude subscription login", says "Console API key: Not used", and shows the
CLI JSON/JSON Schema transport. Added focused tests for structured output,
one-shot parse retry, subscription-quota errors, environment scrubbing, and
missing-session behavior.

## v0.1 — Initial agent loop

Monorepo scaffold, core `Agent`/`Task`/`OfficeEvent` types and the
Orchestrator state machine, a Claude Code CLI `RuntimeAdapter`, the
WebSocket+REST server wiring it to 5 agents, and a first React+PixiJS UI
(idle/walk/work states, live progress bubble, completion cards). Verified
end to end against the real `claude` CLI: dispatch → walk to desk → live
progress → real file edit → completion.

Commits: `4c54267`, `e9e5fb7`, `94a87a4`, `1f530c3`, `2c03e44`

## v0.2 — Pixel-art rendering pass

Replaced emoji/color-circle placeholders with Kenney's CC0 "Tiny Dungeon"
pack — five distinct agent sprites, tile-grid world authoring, integer
sprite scaling and nearest-neighbor texture filtering so 16×16 art stays
crisp. No orchestrator/server/state-machine changes; re-verified the v0.1
loop still worked against the real CLI with the new visuals in place.

Commit: `c4e23ef`

## v0.3 — Concurrent dispatch and capabilities

Replaced "one pending task, one available agent" with a real scheduler:
`eligibleCapabilities` vs. granted `capabilities`, a `KeyedLock` serializing
access per `workspacePath`, and `scheduleDispatch()` re-matching all pending
tasks against all free agents on every change. UI gained a capability
checkbox form, an always-visible pending-task queue, and eligible-vs-granted
capability display. Verified with 5 real concurrent tasks across 5
workspaces.

Commits: `592b48c`, `8fb8784`

## v0.4 — Mixed-runtime roster

Added `packages/adapters/opencode` implementing the same `RuntimeAdapter`
interface as Claude Code, and an `adapters: Record<string, RuntimeAdapter>`
dispatch table so the Orchestrator no longer assumes one CLI. Verified a
claude-code agent and an opencode agent working simultaneously with
independent progress bubbles, plus a full v0.3 regression against the
now-mixed roster.

**Known issue found and fixed in-round:** OpenCode's account default model
(`muse-spark-1.3-contributor-free`) took 7+ minutes on a single-file write
and never completed one verification run; switched the hardcoded default to
`nemotron-3.5-lightning-free` (verified 15–50s), documented how to override
per-agent.

Commits: `a18baed`, `9eebae5`, `2042333`

## v0.5 — Master planning

`MasterBrain` interface (`plan(goal) → PlannedTask[]`, `summarize(goal,
results) → string`) plus `AnthropicMasterBrain`, calling the Anthropic
Messages API directly with a forced `submit_plan` tool call rather than
wrapping a CLI subprocess. New `POST /api/goals` path (alongside, not
replacing, the manual capability-picker `POST /api/tasks`): `GoalCoordinator`
fans one goal out into several tagged tasks and asks the Master for a
summary once they've all settled.

Commits: `f04ebba`, `6dde2cf`, `2b2f9b3`

## v0.5.1 — Workspace-escape security incident

**Incident:** a Master-planned OpenCode subtask given an ambiguous
instruction edited this project's own `README.md` instead of its assigned
scratch directory; the process exited 0, so the Orchestrator recorded it as
done before the escape was noticed by hand.

Response, two layers: Layer 2 (prevention) wraps every CLI invocation in a
`bubblewrap` sandbox — the whole filesystem read-only except the task's own
`workspacePath`, `/tmp`, and each CLI's own state directory. Layer 1
(detection/backstop) — `GitRepoGuard` — snapshots `git status --porcelain`
on the protected repo before/after every task and force-reverts any
out-of-workspace change, marking the task failed with `securityViolation:
true`. `SECURITY.md` documents both layers and, explicitly, what's still
*not* protected: paths outside the one configured `protectedRepoPath` if
Layer 2 isn't active, credential/secret exfiltration via a CLI's own
already-authorized requests, and resource exhaustion — none of that was in
scope for this pass.

Commits: `d7a8bb2`, `a30b88f`, `acf4d14`

## v0.6 — Dependency-aware planning

`PlannedTask.dependsOn` (exact-title references within one plan) plus
orchestrator-side dependency resolution: `submitTaskBatch()` creates a
goal's tasks atomically, starts dependents in a new `blocked` state instead
of `pending`, and a new `reconcileBlockedTasks()` promotes/cascades them as
their dependencies finish or fail. Cycles and unknown-title references are
rejected before a single Task is created. UI shows `blocked` /
`blocked_failed_dependency` as distinct, non-color-only queue states. Also
folded in this round: pixel-styled UI chrome and a sprite-consistency fix.

Commits: `fc5dbbd`, `666c1f9`, `68eac3a`, `cee35da`, `a9b577d`

## v0.6.1 — Real-API test attempt (blocked)

Attempted the first real end-to-end test of Master planning against the
live Anthropic API. No usable `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` was
available in the environment at the time; per this project's standing rule,
the assistant's own Claude Code login was not substituted in to fake a
result. Reported as not completable rather than skipped or faked. No code
changes, no commit.

## v0.6.2 — Layout redesign, hardening, accessibility

Office scene redesign (zoned Public Area/workstation row, ordered desks,
decorative props, higher detail density), a WebSocket client hardening pass
(guards against React StrictMode's mount/unmount/remount double-connect),
responsive breakpoints for tablet/mobile, and a full WCAG 2.1 AA
accessibility pass — landmark/skip-link, labeled forms, a parallel DOM agent
list for the Pixi canvas (`.agent-access-list`), one polite live region for
all status changes, and non-color-coded failure states (the same five
categories v0.9.1 later re-checked: ordinary/security/dependency/
authentication failure, plus pending/blocked). See
`docs/accessibility-audit.md` for full contrast measurements and the
keyboard-flow proof.

Commits: `68cb548`, `38f0581`, `c8e995e`, `68f85af`, `2c0ba08`, `74eaa89`

## v0.7 — Provider-aware credential routing

`CredentialRouter`: every `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (plus
`_BACKUP`/`_BACKUP2-4` variants) found in the environment becomes a
provider-scoped, priority-ordered credential source, shared by
`AnthropicMasterBrain` and `ClaudeCodeAdapter` so a source that fails
mid-call is skipped by every later `resolve()` for the rest of the process.
UI surfaces credential availability and auth failures instead of a bare
error. Documented in `docs/` (credential routing and failover).

Commits: `1edae92`, `38f514a`, `52b5a52`, `a33e0f8`

## v0.7.1 — Real-API fallback test attempt (blocked)

Second attempt at a real-API test — this time the v0.7 credential-fallback
path specifically (invalid primary → valid backup). Same blocker as v0.6.1:
no real Anthropic credential available in the environment. Reported
honestly as incomplete; no code changes, no commit.

## v0.7.3 — Dev port-conflict handling

`selectAvailablePort()`: the dev server/web processes now try their
preferred port and walk upward to the next free one instead of potentially
killing an unrelated process that already holds the preferred port. (Explicit
tag: referenced by name — "reuses v0.7.3's port-conflict fallback
behavior" — in the v0.9 proxy commit below.)

Commit: `6eb0aa6`

## v0.8 — Per-agent backend routing (research + foundation)

**Research (`docs/cc-switch-research.md`, explicit tag: "v0.8 spike"):**
investigated using the already-installed `cc-switch` tool to route different
agents to different API backends. Finding: `cc-switch`'s own CLI has no
non-GUI argument surface on this box, and more fundamentally its schema only
supports one *globally current* profile and one *singleton* proxy config per
CLI tool — there is no per-request or per-process routing primitive, so it
cannot safely serve N concurrent agents on different backends without them
racing each other.

**Foundation:** `Agent.backendProfile` / `BackendProfile` /
`BackendProfileError` types, resolved to per-process `ANTHROPIC_BASE_URL`/
`ANTHROPIC_AUTH_TOKEN` env overrides at CLI-spawn time instead — each spawned
process gets its own isolated environment, sidestepping cc-switch's
single-global-state problem entirely.

Commit: `66afc80` (this commit's own message notes it also carries v0.9's
`apiFormat` field — the two rounds' type additions landed together)

## v0.9 — API format translation

Not every third-party/self-hosted backend speaks the Anthropic Messages API
the `claude` CLI expects — many only implement OpenAI Chat Completions. Added
a local HTTP proxy (`apps/server/src/proxy-server.ts`) every
backendProfile-routed agent talks to instead of the backend directly:
`apiFormat: "anthropic"` profiles get a byte-level passthrough,
`apiFormat: "openai-chat-completions"` profiles get full request/response/
streaming translation (`packages/core/src/proxy/translate.ts`). A mock
OpenAI backend and an end-to-end verification script exercise the translated
path, including a real tool-use round trip.

**Documented known limitations (lossy translation, `docs/api-format-translation.md`):**
dropped on the request side — `top_k`, `thinking`, `metadata`,
`cache_control`, Anthropic-native server tools (`web_search_*`, `bash_*`,
`text_editor_*`, ...), non-text content blocks (image/document/thinking);
`temperature` passed through unrescaled despite differing ranges. Dropped or
approximated on the response side — `stop_sequence` always `null`,
`content_filter → refusal` is an approximation not an equivalence, response
`model` echoes the request rather than the backend's served model id,
streaming token usage is best-effort only. Only `POST /v1/messages` is
supported for translated profiles (`count_tokens` and others return `501`);
"anthropic"-format profiles have no such limit since they're a full
passthrough.

Commits: `56194d9`, `2c66c1c`, `a645bb7`, `634b178`

## v0.9.1 — Regression check

Re-ran the v0.6.2 accessibility pass's five-failure-category and full
form→queue→detail-panel walk after v0.9's changes. Two findings carried
forward, neither fixed in this round: a PixiJS `Only Containers will be
allowed` `addChild` deprecation warning, and `.agent-access-list` (the a11y
pass's DOM agent list) being visually covered by the canvas and unclickable
with a mouse. No commits found for this round in the current history; this
entry is reconstructed from the v0.10 build prompt's own references to it,
not from a doc this repo has on file.

## v0.10 — Backend/credential management UI, real-API testing, CHANGELOG

**Part A — Backend & Credentials management UI:** the UI v0.7–v0.9
deliberately deferred. A panel showing every detected credential source and
registered backend profile, forms to add/edit a backend profile, and
per-agent backend reassignment — all without a restart, and never
displaying a secret value (env var *names* only). `BackendProfileStore` and
`AgentBackendAssignmentStore` persist to
`apps/server/data/{backend-profiles,agent-backend-assignments}.json`.
Verified via direct REST calls in this round: create/edit/duplicate-reject/
reserved-id-reject on profiles, reassign/reject-non-claude-code-agent on
agents, and confirmed both persist across a real server restart.

Commit: `ee8a1c8`

**Part B — Real-API end-to-end testing:** see this round's own test report
for full results and exactly which of the four checks could and couldn't be
completed with the credentials available.

**Part C — this file.**

**Part D:** wrote `docs/pending-font-layout-integration-check.md`, a
checklist to run once the in-progress, out-of-scope font/layout batch
(`index.css`, `ASSET_LICENSE.md`, `OfficeScene.tsx`, `assets/fonts/`) is
committed. Not executed this round — that work was still uncommitted.

Commit: `5bac362`
