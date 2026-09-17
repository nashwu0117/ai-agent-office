/**
 * v0.9: pure Anthropic Messages API <-> OpenAI Chat Completions translation.
 * No I/O here — apps/server/src/proxy-server.ts owns the HTTP plumbing
 * (forwarding, SSE writing, auth headers). Kept pure so it's unit-testable
 * without a live backend.
 *
 * This is a LOSSY translation. Every place a field is dropped or
 * approximated is commented at the point it happens; the full inventory is
 * also written up in docs/api-format-translation.md. Nothing here silently
 * pretends the two APIs are equivalent — anything not handled is either
 * passed through best-effort or explicitly dropped with a comment.
 */
import type {
  AnthropicContentBlock,
  AnthropicMessageParam,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
  AnthropicTextBlock,
  AnthropicToolUseBlock,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIChatStreamChunk,
  OpenAIFinishReason,
  OpenAIMessage,
  OpenAIToolCall,
} from "./types.js";
import { isCustomTool } from "./types.js";

let syntheticIdCounter = 0;
function syntheticId(prefix: string): string {
  syntheticIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${syntheticIdCounter}`;
}

// ---------------------------------------------------------------------------
// Request: Anthropic -> OpenAI
// ---------------------------------------------------------------------------

export interface RequestTranslationResult {
  request: OpenAIChatRequest;
  /** Tool names present in the Anthropic request that have no OpenAI function-calling equivalent (Anthropic-native server tools) and were dropped. */
  droppedTools: string[];
}

export function anthropicRequestToOpenAI(req: AnthropicMessagesRequest): RequestTranslationResult {
  const messages: OpenAIMessage[] = [];

  if (req.system) {
    const systemText =
      typeof req.system === "string" ? req.system : req.system.map((block) => block.text).join("\n\n");
    if (systemText.trim()) messages.push({ role: "system", content: systemText });
    // cache_control on system blocks (if any) has no OpenAI equivalent — dropped.
  }

  for (const message of req.messages) {
    messages.push(...anthropicMessageToOpenAI(message));
  }

  const droppedTools: string[] = [];
  let tools: OpenAIChatRequest["tools"];
  if (req.tools && req.tools.length > 0) {
    const custom = req.tools.filter((tool) => {
      const ok = isCustomTool(tool);
      if (!ok) droppedTools.push(tool.name);
      return ok;
    });
    if (custom.length > 0) {
      tools = custom.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      }));
    }
  }

  const out: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream,
  };
  if (tools) out.tools = tools;
  if (req.tool_choice) out.tool_choice = translateToolChoice(req.tool_choice);
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop_sequences && req.stop_sequences.length > 0) out.stop = req.stop_sequences;
  // Dropped, no OpenAI Chat Completions equivalent: top_k, thinking,
  // metadata, cache_control (anywhere), stop_sequence matching on response.
  if (req.stream) out.stream_options = { include_usage: true };

  return { request: out, droppedTools };
}

function translateToolChoice(choice: NonNullable<AnthropicMessagesRequest["tool_choice"]>): OpenAIChatRequest["tool_choice"] {
  switch (choice.type) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "any":
      return "required";
    case "tool":
      return { type: "function", function: { name: choice.name } };
  }
}

function anthropicMessageToOpenAI(message: AnthropicMessageParam): OpenAIMessage[] {
  if (typeof message.content === "string") {
    return [{ role: message.role, content: message.content }];
  }

  const out: OpenAIMessage[] = [];
  let textParts: string[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  const flushText = () => {
    if (textParts.length > 0) {
      out.push({ role: message.role, content: textParts.join("") });
      textParts = [];
    }
  };

  for (const block of message.content) {
    if (block.type === "text") {
      textParts.push((block as AnthropicTextBlock).text);
    } else if (block.type === "tool_use") {
      const tu = block as AnthropicToolUseBlock;
      toolCalls.push({
        id: tu.id,
        type: "function",
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      });
    } else if (block.type === "tool_result") {
      // tool_result blocks don't nest inside a user message in OpenAI's
      // shape — each becomes its own standalone {role: "tool"} message,
      // flushing any accumulated text first to keep ordering sane.
      flushText();
      const tr = block as import("./types.js").AnthropicToolResultBlock;
      const content = typeof tr.content === "string" ? tr.content : (tr.content ?? []).map((c) => c.text).join("\n");
      out.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.is_error ? `ERROR: ${content}` : content });
      // is_error has no first-class OpenAI field — folded into the text
      // above (lossy: a backend can no longer distinguish it structurally).
    }
    // image/document/thinking/other block types: dropped, no OpenAI Chat
    // Completions Messages-array equivalent this translator implements.
  }

  if (toolCalls.length > 0) {
    out.push({ role: "assistant", content: textParts.length > 0 ? textParts.join("") : null, tool_calls: toolCalls });
  } else {
    flushText();
  }

  return out;
}

// ---------------------------------------------------------------------------
// Response: OpenAI -> Anthropic (non-streaming)
// ---------------------------------------------------------------------------

const FINISH_REASON_TO_STOP_REASON: Record<Exclude<OpenAIFinishReason, null>, AnthropicStopReason> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  function_call: "tool_use",
  // Not a semantic match — Anthropic's "refusal" is a policy-level safety
  // decline with structured `stop_details`; OpenAI's "content_filter" is a
  // moderation-layer stop. Mapped here only so callers get SOME terminal
  // reason other than a silent "end_turn"; documented in
  // docs/api-format-translation.md as an approximation, not an equivalence.
  content_filter: "refusal",
};

export function mapFinishReason(reason: OpenAIFinishReason): AnthropicStopReason {
  if (reason === null) return "end_turn";
  return FINISH_REASON_TO_STOP_REASON[reason] ?? "end_turn";
}

export function openAIResponseToAnthropic(resp: OpenAIChatResponse, requestModel: string): AnthropicMessagesResponse {
  const choice = resp.choices[0];
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];

  if (choice?.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  for (const tc of choice?.message.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id ?? syntheticId("toolu"),
      name: tc.function?.name ?? "",
      input: parseToolArguments(tc.function?.arguments),
    });
  }

  return {
    id: resp.id.startsWith("msg_") ? resp.id : `msg_${resp.id}`,
    type: "message",
    role: "assistant",
    // Echoes the model the CLI originally requested rather than whatever
    // model string the third-party backend reports back — the two are
    // frequently different identifier spaces (e.g. an Anthropic model alias
    // vs. the backend's own served-model name) and Anthropic clients don't
    // expect the response model to differ from the request. Documented.
    model: requestModel,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason ?? null),
    // OpenAI Chat Completions never reports which stop string matched —
    // always null here even when a `stop` sequence is what ended the turn.
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Malformed/truncated tool-call JSON from the backend — never crash the
    // proxy over it; surfaced as an empty input rather than failing the
    // whole response. See docs/api-format-translation.md.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Response: OpenAI -> Anthropic (streaming)
// ---------------------------------------------------------------------------

/** One Anthropic SSE event: `event: <event>` + `data: <JSON.stringify(data)>`. */
export interface AnthropicSSEEvent {
  event: string;
  data: Record<string, unknown>;
}

interface OpenAIToolCallState {
  anthropicIndex: number;
  id: string;
  name: string;
}

/**
 * Stateful, one-per-response translator: feed it each parsed OpenAI stream
 * chunk in arrival order via `.chunk()`, it returns the Anthropic SSE
 * events that chunk produces (zero or more — most chunks produce exactly
 * one, a tool-call's first chunk produces two: content_block_start then
 * content_block_delta). Call `.finish()` once after the OpenAI stream ends
 * (on `[DONE]` or the connection closing) to flush any still-open blocks —
 * covers a backend that closes the stream without ever sending a
 * `finish_reason`.
 *
 * Anthropic's `ping` keep-alive events are never synthesized — not needed
 * over a local loopback connection, and documented as omitted rather than
 * silently pretended-equivalent. See docs/api-format-translation.md.
 */
export class OpenAIStreamToAnthropicTranslator {
  private readonly messageId: string;
  private readonly model: string;
  private startedMessage = false;
  private nextIndex = 0;
  private textBlockIndex: number | undefined;
  private textBlockOpen = false;
  private readonly toolCallsByOpenAIIndex = new Map<number, OpenAIToolCallState>();
  private finished = false;
  private finalOutputTokens = 0;

  constructor(model: string) {
    this.messageId = syntheticId("msg");
    this.model = model;
  }

  chunk(chunk: OpenAIChatStreamChunk): AnthropicSSEEvent[] {
    if (this.finished) return [];
    const events: AnthropicSSEEvent[] = [];
    const choice = chunk.choices?.[0];

    if (!this.startedMessage) {
      this.startedMessage = true;
      events.push({
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: this.messageId,
            type: "message",
            role: "assistant",
            model: this.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: chunk.usage?.prompt_tokens ?? 0, output_tokens: 0 },
          },
        },
      });
    }

    if (chunk.usage?.completion_tokens !== undefined) this.finalOutputTokens = chunk.usage.completion_tokens;
    if (!choice) return events;

    if (choice.delta.content) {
      if (this.textBlockIndex === undefined) {
        this.textBlockIndex = this.nextIndex++;
        this.textBlockOpen = true;
        events.push({
          event: "content_block_start",
          data: { type: "content_block_start", index: this.textBlockIndex, content_block: { type: "text", text: "" } },
        });
      }
      events.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: this.textBlockIndex,
          delta: { type: "text_delta", text: choice.delta.content },
        },
      });
    }

    for (const tc of choice.delta.tool_calls ?? []) {
      const key = tc.index ?? 0;
      let state = this.toolCallsByOpenAIIndex.get(key);
      if (!state) {
        // A tool call starting closes any still-open text block first —
        // Anthropic content blocks are strictly sequential (one open at a
        // time within the ordering the index implies), while OpenAI's delta
        // stream has no equivalent "block closed" signal of its own.
        if (this.textBlockOpen) {
          events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: this.textBlockIndex } });
          this.textBlockOpen = false;
        }
        const anthropicIndex = this.nextIndex++;
        state = { anthropicIndex, id: tc.id ?? syntheticId("toolu"), name: tc.function?.name ?? "" };
        this.toolCallsByOpenAIIndex.set(key, state);
        events.push({
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: anthropicIndex,
            content_block: { type: "tool_use", id: state.id, name: state.name, input: {} },
          },
        });
      }
      if (tc.function?.arguments) {
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: state.anthropicIndex,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          },
        });
      }
    }

    if (choice.finish_reason) {
      events.push(...this.closeAllBlocks());
      events.push({
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: mapFinishReason(choice.finish_reason), stop_sequence: null },
          usage: { output_tokens: this.finalOutputTokens },
        },
      });
      events.push({ event: "message_stop", data: { type: "message_stop" } });
      this.finished = true;
    }

    return events;
  }

  /** Call once after the OpenAI stream ends without ever sending a `finish_reason` chunk — flushes any open blocks so the CLI still sees a well-formed terminal sequence instead of hanging. */
  finish(): AnthropicSSEEvent[] {
    if (this.finished) return [];
    this.finished = true;
    if (!this.startedMessage) return [];
    return [
      ...this.closeAllBlocks(),
      {
        event: "message_delta",
        data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: this.finalOutputTokens } },
      },
      { event: "message_stop", data: { type: "message_stop" } },
    ];
  }

  private closeAllBlocks(): AnthropicSSEEvent[] {
    const events: AnthropicSSEEvent[] = [];
    if (this.textBlockOpen) {
      events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: this.textBlockIndex } });
      this.textBlockOpen = false;
    }
    for (const state of this.toolCallsByOpenAIIndex.values()) {
      events.push({ event: "content_block_stop", data: { type: "content_block_stop", index: state.anthropicIndex } });
    }
    this.toolCallsByOpenAIIndex.clear();
    return events;
  }
}
