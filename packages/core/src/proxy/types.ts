/**
 * v0.9: minimal structural types for the two wire formats the local
 * format-translation proxy converts between. Deliberately NOT the full
 * `@anthropic-ai/sdk` / OpenAI SDK type surface — only the fields this
 * translator actually reads or writes. See docs/api-format-translation.md
 * for the research this is based on and the full lossy-field inventory.
 */

// ---------------------------------------------------------------------------
// Anthropic Messages API (the shape the `claude` CLI sends/expects)
// ---------------------------------------------------------------------------

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<{ type: "text"; text: string }>;
  is_error?: boolean;
}

/** Anthropic has more block types (image, document, thinking, ...); this proxy only round-trips the three above. */
export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string; [key: string]: unknown };

export interface AnthropicMessageParam {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  /** Anthropic-native server tools (web_search_20260209, bash_20250124, ...) carry a versioned `type` and no input_schema instead — see isCustomTool(). */
  type?: string;
}

export type AnthropicToolChoice =
  | { type: "auto" }
  | { type: "any" }
  | { type: "none" }
  | { type: "tool"; name: string };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system?: string | Array<{ type: "text"; text: string; [key: string]: unknown }>;
  messages: AnthropicMessageParam[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  [key: string]: unknown;
}

export type AnthropicStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal";

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: AnthropicStopReason | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions API (the shape an "openai-chat-completions" backend speaks)
// ---------------------------------------------------------------------------

export interface OpenAIToolCall {
  index?: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIFunctionTool {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export type OpenAIToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  tools?: OpenAIFunctionTool[];
  tool_choice?: OpenAIToolChoice;
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

export type OpenAIFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "function_call" | null;

export interface OpenAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: OpenAIFinishReason;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface OpenAIChatStreamChunk {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: OpenAIFinishReason;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export function isCustomTool(tool: AnthropicTool): boolean {
  return tool.type === undefined || tool.type === "custom";
}
