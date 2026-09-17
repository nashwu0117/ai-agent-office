# v0.13 Part A: Cline / Freebuff / experientiallabs.ai research

Researched live via web search/fetch against each project's own docs/repo
(not guessed from the name). Sources are linked inline. Conclusions below
directly decide the scope of Parts B/C/D in the v0.13 build prompt.

## Cline — headless CLI: **feasible, real adapter shipped (Part B)**

Cline shipped a genuine standalone CLI (`cline`, npm package `cline`,
"Cline CLI 2.0", Feb 2026) with an actual non-interactive/headless mode —
this is not the VSCode extension being puppeted, it's a separate binary.

Verified against [docs.cline.bot/usage/cli-overview](https://docs.cline.bot/usage/cli-overview)
and the CLI's own README at
[github.com/cline/cline/blob/main/apps/cli/README.md](https://github.com/cline/cline/blob/main/apps/cli/README.md):

- Invocation: `cline [flags] "<task description>"` — no subcommand, task is
  a trailing positional string (same shape as this repo's other adapters).
- Headless/scriptable output: `--json` streams NDJSON, one object per line,
  fields `type` (`"ask" | "say"`), `text`, `ts`, optionally `say`, `ask`,
  `reasoning`, `partial`. Not documented as a stable public contract (same
  caveat this repo already applies to Claude Code's and OpenCode's own JSON
  line shapes) — parsed defensively, same as those two.
- Unattended execution: `--auto-approve [true|false]` (equivalently
  `--yolo`, which also exits once the turn finishes) — required for a
  headless worker with nobody present to approve tool calls, same role as
  Claude Code's `--permission-mode acceptEdits` and OpenCode's `--auto`.
- `-c, --cwd <path>` sets the working directory — maps directly to
  `task.workspacePath`.
- `-m, --model <id>` (default `anthropic/claude-sonnet-4.6`) and
  `-P, --provider <id>` (default `cline`) select model/provider per
  invocation — maps to `agent.model`.
- Authentication, from
  [docs/api/authentication.mdx](https://github.com/cline/cline/blob/main/docs/api/authentication.mdx)
  and the CLI README: `CLINE_API_KEY` env var authenticates against Cline's
  own hosted "Cline Provider" without any interactive `cline auth` login —
  the same shape as this repo's env-var-backed `CredentialSource`
  (`packages/core/src/credentials/sources.ts`), so it plugs into
  `CredentialRouter` exactly like Claude Code's Anthropic key does, no new
  credential-source machinery needed. (Direct provider keys —
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY` — are also
  read if `-P`/`--provider` selects that provider instead of `cline`.)
- Free quota: [docs.cline.bot/getting-started/free-models](https://docs.cline.bot/getting-started/free-models)
  confirms the Cline Provider model selector has models tagged `FREE`,
  reachable through the same `CLINE_API_KEY` sign-in — matching this
  build's "免費額度" requirement without BYOK to a paid provider.
- Process lifecycle: neither source documents an explicit "done" event in
  the JSON stream (no `type: "done"`) — matches this repo's existing
  pattern (`spawnRuntimeProcess`, `packages/core/src/runtime/process-handle.ts`)
  where task completion is driven by the child process's exit code, not by
  a specific event payload. `ClineAdapter` needs no special-casing here.

**Conclusion: shipped as `packages/adapters/cline` (Part B).**

## Freebuff — **not feasible today, no adapter shipped (Part C stops at "why")**

Freebuff (`CodebuffAI/freebuff`, npm `freebuff`) ships **only an
interactive TUI**. There is no official headless/print mode and no
documented HTTP API to call instead.

Evidence, not assumption:
- The README (`github.com/CodebuffAI/freebuff/blob/main/README.md`) documents
  exactly one usage path: `npm install -g freebuff` then `freebuff` run
  interactively inside a project directory. No flags, no API section.
- Two *open, unresolved* feature requests confirm the gap directly from the
  maintainers' own issue tracker:
  [CodebuffAI/freebuff#947](https://github.com/CodebuffAI/freebuff/issues/947)
  ("Feature request: headless/print mode + SDK support for freebuff
  authToken, for third-party orchestrators") and
  [CodebuffAI/freebuff#1322](https://github.com/CodebuffAI/freebuff/issues/1322)
  ("Headless Freebuff CLI"). As of this research (2026-09), Freebuff is at
  v0.0.140 and neither `-p`/`--print`, `--headless`, nor `--json` exist.
- The only "headless" workaround found in the wild
  (`simplyjackfoster/devin-task` PR #6, `RNK-Enterprise/freebuff-mcp-server`)
  drives the real interactive TUI inside a pseudo-terminal and scrapes its
  screen output, because Freebuff ships no non-interactive mode at all.
  That's screen-scraping a TUI, not calling a supported interface — exactly
  the kind of "build something that doesn't actually run reliably just to
  claim the box is checked" this build prompt says not to do.
- The daily-point system ("100 Freebucks/day, refill at midnight Pacific,
  don't carry over," per [freebuff.com](https://freebuff.com/)) is also
  never exposed as a queryable balance anywhere — there's no command or
  endpoint to check remaining budget before dispatching a task, which would
  matter for the "avoid running a worker into a wall mid-task" concern Part
  C raises, but is moot without a headless entrypoint to attach that check
  to in the first place.

**Conclusion: no `FreebuffAdapter`. This is an honest stop, not a deferred
TODO — revisit only if Freebuff ships an official headless/API surface
(watch #947/#1322).** No `runtime: "freebuff"` agent is added to
`AGENT_ROSTER`.

## platform.experientiallabs.ai — **Anthropic Messages API, not OpenAI** (Part D)

This one mattered because the build prompt explicitly says not to assume a
wire format. Checked
[platform.experientiallabs.ai/docs/coding-agents](https://platform.experientiallabs.ai/docs/coding-agents)
directly (Experiential Labs' own coding-agent setup page), since this
backend fronts many providers and speaks more than one protocol depending
on path:

- `/v1/chat/completions` and `/v1/responses` are OpenAI-shaped, but the
  **Claude Code-specific configuration path is `/v1/messages`, the
  Anthropic Messages protocol** — the coding-agents doc says to point
  `ANTHROPIC_BASE_URL` at `https://api.experientiallabs.ai` (no `/v1`
  suffix — Claude Code's own CLI appends `/v1/messages` itself, same
  convention this repo's proxy already assumes for the `nvidia`/
  `mock-openai` profiles).
- Auth: `ANTHROPIC_API_KEY` (format `xpl_<40 hex>`), sent as `x-api-key` —
  this repo's `apiFormat: "anthropic"` proxy path
  (`apps/server/src/proxy-server.ts`'s `passthroughToAnthropic`) already
  sends exactly that header, unmodified byte-passthrough. No new
  translation code needed.
- Model ids must be the gateway's own **dot-form** slugs (e.g.
  `claude-opus-5`, not a dashed Anthropic wire id) — set via `agent.model`/
  `ANTHROPIC_MODEL`, same mechanism already used for OpenCode's model
  override; not a `BackendProfile` field, since (per that field's own
  doc-comment) `modelOverrideEnvVar` only applies to
  `openai-chat-completions` profiles.

**Conclusion: registered as `apiFormat: "anthropic"` (byte-passthrough,
zero new proxy code) — see `experientiallabs-1` in Part D.**

## b.ai — **Anthropic Messages API** (Part D)

Checked [docs.b.ai/llmservice/api/](https://docs.b.ai/llmservice/api/) directly
(the official B.AI LLM Service API reference):

- Exposes three protocols at `api.b.ai`: `/v1/responses` (OpenAI
  Responses), `/v1/chat/completions` (OpenAI Chat Completions), and
  `/v1/messages` (Anthropic Messages) — doc states this last one is "the
  Anthropic message format and is suitable for the Anthropic SDK, Claude
  Code, and other clients that use the Messages protocol."
- Confirmed the exact endpoint with a verbatim curl example from the docs:
  `curl https://api.b.ai/v1/messages -H "x-api-key: $BAI_API_KEY" -H
  "anthropic-version: 2023-06-01" ...` — so, same as experientiallabs
  above, the `baseUrlEnvVar` value operators set is the host only
  (`https://api.b.ai`, no `/v1`), since the `claude` CLI appends
  `/v1/messages` itself and this repo's proxy just concatenates.
- Auth accepts either `Authorization: Bearer <key>` or `x-api-key: <key>`
  (docs state the two are equivalent) — again exactly what the existing
  `apiFormat: "anthropic"` passthrough already sends.

**Conclusion: registered as `apiFormat: "anthropic"` for all three
`bai-1`/`bai-2`/`bai-3` profiles — see Part D.**
