# Anthropic Messages API ↔ OpenAI Chat Completions translation (v0.9)

## Why this exists

v0.8 let an agent be pinned to a different API backend (`Agent.backendProfile`
→ `BackendProfile`), but assumed every registered backend spoke the same wire
format the `claude` CLI itself speaks — the Anthropic Messages API. That's
true for some third-party/self-hosted backends and false for others: a lot
of self-hosted/third-party model servers (vLLM, LM Studio, Ollama's OpenAI
shim, many "OpenAI-compatible" hosted APIs, ...) only implement **OpenAI
Chat Completions**. Pointing `claude`'s `ANTHROPIC_BASE_URL` straight at one
of those fails outright — the CLI's request body, streaming event shapes,
and tool-calling shape are all specific to the Anthropic API.

v0.9 adds a local HTTP proxy (`apps/server/src/proxy-server.ts`) that every
backendProfile-routed agent's spawned CLI process talks to instead of a
third-party backend directly. `BackendProfile.apiFormat` says which shape
the real backend speaks; the proxy either passes the request through
unmodified (`"anthropic"`) or translates it both directions
(`"openai-chat-completions"`, via `packages/core/src/proxy/translate.ts`).

This is a **lossy** translation. Nothing below claims otherwise — every
field this proxy drops, approximates, or can't represent is listed
explicitly, split into "requests" and "responses/streaming".

## The three areas that actually differ (researched before writing any conversion code)

### 1. System prompt placement

- **Anthropic**: a top-level `system` field, either a plain string or an
  array of `{type: "text", text, cache_control?}` blocks. Never part of
  `messages`.
- **OpenAI**: no top-level field — the system prompt is `messages[0]` with
  `role: "system"`.

Translation: Anthropic's `system` (string or joined array-of-text) becomes
`messages[0] = {role: "system", content: <joined text>}` on the OpenAI side.
`cache_control` on a system block has no OpenAI equivalent and is dropped.

### 2. Tool use / function calling

| | Anthropic | OpenAI Chat Completions |
|---|---|---|
| Tool declaration | `tools: [{name, description, input_schema}]` (custom) or a versioned `type` for Anthropic-native server tools (`bash_20250124`, `web_search_20260209`, ...) | `tools: [{type: "function", function: {name, description, parameters}}]` — function-calling only, no server-executed tool concept |
| Model requests a call | An assistant `content` block: `{type: "tool_use", id, name, input: <object>}`, alongside optional `text` blocks in the same message | `choices[0].message.tool_calls: [{id, type: "function", function: {name, arguments: <JSON string>}}]`, `content` usually `null` |
| Caller returns a result | A **user**-role message containing `{type: "tool_result", tool_use_id, content, is_error?}` block(s) — can hold several tool_results for parallel calls | A separate **`role: "tool"`** message per result, keyed by `tool_call_id`. No `is_error` field. |
| Streaming a call | `content_block_start` (`type: "tool_use"`, carries `id`+`name` up front) → one or more `content_block_delta` (`type: "input_json_delta"`, `partial_json` fragments) → `content_block_stop` | `delta.tool_calls: [{index, id?, function: {name?, arguments?}}]` chunks, correlated by `index` (not a persistent id — id/name typically only appear on that call's first chunk) |
| Forcing a specific tool | `tool_choice: {type: "tool", name}` / `{type: "any"}` / `{type: "auto"}` / `{type: "none"}` | `tool_choice: {type: "function", function: {name}}` / `"required"` / `"auto"` / `"none"` |

Key structural mismatch the translator has to bridge: Anthropic nests
`tool_result` blocks *inside a user message alongside other content*;
OpenAI has *no such nesting* — each tool result is its own top-level
message. `anthropicMessageToOpenAI` (translate.ts) splits one Anthropic
user message with N tool_result blocks into N separate `{role: "tool"}`
OpenAI messages (flushing any plain text in that same Anthropic message to
its own `{role: "user"}` message first, to preserve ordering).

The reverse direction has the same shape problem for *streaming*: OpenAI's
per-chunk `delta.tool_calls[].index` is not the same kind of thing as
Anthropic's `content_block` index (OpenAI's is scoped to "which tool call is
this argument fragment for", Anthropic's is "which content block in this
message is this"). `OpenAIStreamToAnthropicTranslator` keeps its own
`openaiToolCallIndex → anthropicContentBlockIndex` map and assigns a fresh,
sequential Anthropic block index the first time each OpenAI tool-call index
appears, closing the text block (if one is open) before opening the tool
block — Anthropic content blocks are strictly one-open-at-a-time in index
order; OpenAI's delta stream has no equivalent boundary signal of its own.

### 3. Streaming event sequence

- **Anthropic**: a stateful event sequence — `message_start` (message
  metadata + empty `content: []`) → for each content block:
  `content_block_start` (declares the block's `type` and initial state) →
  N × `content_block_delta` (`text_delta` / `input_json_delta` /
  `thinking_delta`) → `content_block_stop` → after all blocks:
  `message_delta` (carries `stop_reason` + final `usage`) → `message_stop`.
  Also periodic `ping` keep-alives (not required for correctness — omitted
  by this proxy; see below).
- **OpenAI**: a flat sequence of `chat.completion.chunk` objects, each
  carrying a `delta` (partial `content` string and/or `tool_calls`
  fragments) and a `finish_reason` that stays `null` until the last chunk,
  terminated by a literal `data: [DONE]` line. No block-start/block-stop
  concept — a "block boundary" is inferred, not signaled.

`OpenAIStreamToAnthropicTranslator` (translate.ts) is the stateful adapter
between these two models: it synthesizes `message_start` on the first
chunk, opens/closes Anthropic content blocks as OpenAI's flat delta stream
implies they should exist, and synthesizes `message_delta` + `message_stop`
the moment a `finish_reason` arrives (or on stream end, via `.finish()`, if
the backend never sends one — so the CLI never hangs waiting for a
terminator that isn't coming).

## Everything this translation drops or approximates (lossy fields)

**Request direction (Anthropic → OpenAI), in `anthropicRequestToOpenAI`:**

| Anthropic field | What happens |
|---|---|
| `top_k` | Dropped — no OpenAI Chat Completions equivalent. |
| `thinking` (extended thinking config) | Dropped — no OpenAI equivalent; a backend that doesn't think won't think regardless. |
| `metadata` | Dropped. |
| `cache_control` (system blocks or content blocks) | Dropped — OpenAI Chat Completions has no prompt-caching primitive in this API shape. |
| Anthropic-native server tools (`web_search_*`, `bash_*`, `text_editor_*`, `code_execution_*`, ...) | **Dropped from the translated `tools` array** (see `isCustomTool`/`droppedTools`) — these run on Anthropic's own infrastructure and have no OpenAI function-calling equivalent a third-party backend could execute anyway. The proxy logs which tool names were dropped on every translated request. |
| `tool_result.is_error` | Folded into the text content as an `ERROR: ` prefix — OpenAI's `{role: "tool"}` message has no structured error field. |
| Non-text content blocks (`image`, `document`, `thinking`, ...) | Dropped — this translator only round-trips `text`/`tool_use`/`tool_result`. |
| `model` | Passed through as-is, **not remapped** — the operator is responsible for setting `Agent.model` (or the backend's own default) to an id the target backend actually understands. |
| `temperature` | Passed through unchanged even though Anthropic's range (0–1) and OpenAI's (0–2) aren't the same scale — no rescaling is applied. |
| `stop_sequences` | Mapped to OpenAI's `stop` array (same semantics). |

**Response direction (OpenAI → Anthropic), in `openAIResponseToAnthropic` / streaming:**

| | What happens |
|---|---|
| `finish_reason: "content_filter"` → `stop_reason: "refusal"` | An approximation, not an equivalence — Anthropic's `refusal` is a policy-level decline with structured `stop_details` (`category`, `explanation`); OpenAI's `content_filter` is a moderation-layer stop with no such structure. Mapped here only so the CLI gets *some* terminal reason instead of a silent `end_turn`. |
| `stop_sequence` | Always `null` in the translated response — OpenAI Chat Completions never reports which stop string actually matched. |
| Response `model` field | Echoes the **request's** model string back, not whatever model id the backend reports serving — Anthropic clients don't expect the response model to differ from the request, and third-party backends' served-model ids frequently live in a different namespace than what the CLI asked for. |
| Malformed/truncated `tool_calls[].function.arguments` JSON | Parsed defensively (`parseToolArguments`) — a parse failure produces an empty `input: {}` object rather than crashing the proxy or the CLI's stream. |
| Streaming `usage` | Best-effort only. The proxy requests `stream_options: {include_usage: true}` on every streamed OpenAI request, but not every OpenAI-compatible backend honors it; when it's absent, `output_tokens` in the synthesized `message_delta` reports `0`. |
| Anthropic `ping` keep-alive events | Never synthesized — omitted rather than faked, since they're not needed over the local loopback hop this proxy runs on. |
| `count_tokens` and any endpoint other than `POST /v1/messages` | **Unsupported** for `openai-chat-completions` profiles — the proxy returns `501` with a clear message rather than guessing. (`"anthropic"`-format profiles get a full byte-level passthrough for any path, so this limitation is specific to the translated format.) |

None of the above is "the proxy is broken" — it's the actual shape of what
Chat Completions can and can't express relative to the Messages API. An
operator picking an `openai-chat-completions` backend should expect: no
server-side tools, no prompt caching, no extended thinking, approximate
refusal detection, and best-effort token usage on streamed responses.
Everything else (text generation, custom tool calling including streamed
tool-call arguments, multi-turn conversation, `max_tokens`, `temperature`,
`top_p`, `stop` sequences) round-trips correctly.

## Architecture

```
claude CLI process (spawned by ClaudeCodeAdapter)
  │  ANTHROPIC_BASE_URL = http://127.0.0.1:<proxy port>/<profileId>/
  ▼
apps/server/src/proxy-server.ts   (this server's own process, started at boot)
  │
  ├─ profile.apiFormat === "anthropic"
  │    byte-level reverse proxy: forward headers/body/SSE unmodified,
  │    only the auth header is replaced with this profile's real credential
  │
  └─ profile.apiFormat === "openai-chat-completions"
       anthropicRequestToOpenAI()  →  POST <baseUrl>/chat/completions
                                          │
       openAIResponseToAnthropic() /      │  (or, if request.stream: true)
       OpenAIStreamToAnthropicTranslator  ◄┘  translate each SSE chunk as it arrives
```

`BACKEND_PROFILES` (`apps/server/src/index.ts`) is still the only place a
new backend is registered — adding one, or changing its `apiFormat`, never
touches `ClaudeCodeAdapter` or the proxy's routing logic.

**Official agents (no `backendProfile`) never reach this proxy.** They keep
v0.7/v0.8's behavior exactly: `ClaudeCodeAdapter` resolves a credential from
`CredentialRouter` and sets `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
directly, or leaves the CLI to fall back to its own `claude auth login`
session if no credential is configured. Routing "official" traffic through
the proxy too was considered and deliberately not done — the fallback to
the CLI's own login session is exactly what "official" is for on a
developer machine with no `AI_OFFICE_BACKEND_*` variables set at all, and
that fallback has no analogue once a proxy hop with no registered profile
sits in between. Only `backendProfile`-routed agents — the ones actually
being "switched" to a specific backend — go through the proxy, which is the
part of the v0.7.3-adjacent "switching is always the same entry point"
principle that's actually load-bearing here.

## Port selection

`AI_OFFICE_PROXY_PORT` (default `43119`, one after the default web port
`43118`). `startFormatTranslationProxy` uses
`packages/core/src/runtime/port-select.ts#selectAvailablePort` — the same
"try the preferred port, then walk upward until something's free, log a
warning naming both ports" behavior `scripts/dev.mjs` (v0.7.3) uses for the
server/web dev ports. It does **not** reimplement dev.mjs's stale-own-
process PID/token reclaim logic: that exists because dev.mjs supervises a
separately-restarted OS process across `tsx watch` reloads, whereas the
proxy is an in-process listener that starts and stops with `apps/server`
itself — there's no separate stale process of its own to reclaim a port
from.

## Testing the translation path

1. `npm run mock-openai --workspace @ai-office/server` (or `-w apps/server`)
   starts `apps/server/src/dev/mock-openai-backend.ts` on port 43199 — a
   minimal OpenAI Chat Completions server that recognizes a Claude Code
   `Write` tool call and drives a deterministic two-turn conversation
   (issue the tool call → see the tool result → reply with text and stop).
2. Set `AI_OFFICE_BACKEND_MOCK_OPENAI_BASE_URL=http://127.0.0.1:43199/v1`
   and any non-empty `AI_OFFICE_BACKEND_MOCK_OPENAI_AUTH_TOKEN`, then start
   `apps/server` normally — `agent-06` in `AGENT_ROSTER` is pre-wired to the
   `mock-openai` profile (`apiFormat: "openai-chat-completions"`).
3. Or, for a self-contained one-shot check that doesn't need the full
   server/web stack: `npm run verify-openai-proxy --workspace
   @ai-office/server`. It spawns the mock backend itself, starts the proxy,
   runs one real `claude -p` task through
   `ClaudeCodeAdapter → proxy → mock backend`, and asserts both that the
   task completed and that the file the mock backend told the CLI to write
   actually exists with the expected content on disk — i.e. a real tool-use
   round trip through the translation layer, not just a text reply.
