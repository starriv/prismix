/**
 * Anthropic Messages adapter — bidirectional format conversion.
 *
 * Converts between the gateway's OpenAI-compatible format and Anthropic's
 * Messages API format. Handles:
 * - Request: system message extraction, max_tokens default
 * - Response: content array → string, stop_reason mapping, usage mapping
 * - Streaming: content_block_delta → OpenAI delta, message_stop detection
 */
import { match } from "ts-pattern";

import type {
  BuildUrlOptions,
  OpenAIChatBody,
  OpenAIChatResponse,
  ProtocolAdapter,
  TokenUsage,
} from "./types";

/** Default max_tokens if not specified (Anthropic requires it). */
const DEFAULT_MAX_TOKENS = 4096;
const INSTRUCTION_ROLES = new Set(["system", "developer"]);

// ── Stop reason mapping ──────────────────────────────────────────────

function mapStopReason(stopReason: string | null | undefined): string | null {
  if (!stopReason) return null;
  return match(stopReason)
    .with("end_turn", () => "stop")
    .with("stop_sequence", () => "stop")
    .with("max_tokens", () => "length")
    .with("tool_use", () => "tool_calls")
    .otherwise(() => stopReason);
}

// ── Anthropic response types (minimal) ───────────────────────────────

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  [key: string]: unknown;
}

interface AnthropicStreamEvent {
  type: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function mapOpenAiToolToAnthropic(tool: unknown): unknown {
  if (!isRecord(tool)) return tool;
  if (tool.type !== "function" || !isRecord(tool.function)) return tool;

  const fn = tool.function;
  const result: Record<string, unknown> = {
    name: typeof fn.name === "string" ? fn.name : "",
    input_schema: isRecord(fn.parameters) ? fn.parameters : { type: "object" },
  };

  if (typeof fn.description === "string") {
    result.description = fn.description;
  }

  for (const key of [
    "cache_control",
    "strict",
    "defer_loading",
    "allowed_callers",
    "input_examples",
    "eager_input_streaming",
  ]) {
    if (key in tool) result[key] = tool[key];
    if (key in fn) result[key] = fn[key];
  }

  return result;
}

function mapTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map(mapOpenAiToolToAnthropic);
}

function mapToolChoice(toolChoice: unknown): unknown {
  if (toolChoice == null) return undefined;

  if (typeof toolChoice === "string") {
    if (toolChoice === "required" || toolChoice === "any") return { type: "any" };
    if (toolChoice === "auto" || toolChoice === "none") return { type: toolChoice };
    return toolChoice;
  }

  if (!isRecord(toolChoice)) return toolChoice;
  if (toolChoice.type === "function" && isRecord(toolChoice.function)) {
    const name = toolChoice.function.name;
    if (typeof name === "string") return { type: "tool", name };
  }

  return toolChoice;
}

function mapStopSequences(stop: unknown, existing: unknown): unknown {
  if (existing !== undefined) return existing;
  if (typeof stop === "string" && stop.length > 0) return [stop];
  if (Array.isArray(stop)) {
    const values = stop.filter((item): item is string => typeof item === "string");
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function mapAssistantMessage(message: OpenAIChatBody["messages"][number]) {
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length === 0 && typeof message.content === "string") {
    return { role: "assistant", content: message.content };
  }

  const content: Array<Record<string, unknown>> = [];
  const text = textFromContent(message.content);
  if (text) content.push({ type: "text", text });

  for (const [index, toolCall] of toolCalls.entries()) {
    if (!isRecord(toolCall)) continue;
    const fn = isRecord(toolCall.function) ? toolCall.function : {};
    if (typeof fn.name !== "string") continue;

    content.push({
      type: "tool_use",
      id: typeof toolCall.id === "string" ? toolCall.id : `toolu_${index}`,
      name: fn.name,
      input: parseJsonObject(fn.arguments),
    });
  }

  return {
    role: "assistant",
    content: content.length > 0 ? content : "",
  };
}

function mapToolResultMessage(message: OpenAIChatBody["messages"][number]) {
  const block: Record<string, unknown> = {
    type: "tool_result",
    tool_use_id: typeof message.tool_call_id === "string" ? message.tool_call_id : "",
    content:
      typeof message.content === "string" || Array.isArray(message.content) ? message.content : "",
  };

  if (typeof message.is_error === "boolean") {
    block.is_error = message.is_error;
  }

  return { role: "user", content: [block] };
}

function mapMessages(messages: OpenAIChatBody["messages"]) {
  return messages.map((message) => {
    if (message.role === "assistant") return mapAssistantMessage(message);
    if (message.role === "tool") return mapToolResultMessage(message);
    return message;
  });
}

// ── Adapter ──────────────────────────────────────────────────────────

export const anthropicAdapter: ProtocolAdapter = {
  format: "anthropic",

  buildUrl(baseUrl: string, _opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  },

  transformRequest(body: OpenAIChatBody): unknown {
    // Extract system/developer messages → top-level `system` field
    const systemMessages = body.messages.filter((m) => INSTRUCTION_ROLES.has(m.role));
    const nonSystemMessages = body.messages.filter((m) => !INSTRUCTION_ROLES.has(m.role));

    const systemText = systemMessages
      .map((m) => textFromContent(m.content))
      .filter(Boolean)
      .join("\n\n");

    const { max_tokens, stop, stop_sequences, tool_choice, tools, ...rest } = body;
    const passthroughFields: Record<string, unknown> = { ...rest };
    for (const key of [
      "max_completion_tokens",
      "messages",
      "parallel_tool_calls",
      "response_format",
      "stream_options",
    ]) {
      delete passthroughFields[key];
    }

    const mappedTools = mapTools(tools);
    const mappedToolChoice = mapToolChoice(tool_choice);
    const mappedStopSequences = mapStopSequences(stop, stop_sequences);

    return {
      ...passthroughFields,
      messages: mapMessages(nonSystemMessages),
      max_tokens: max_tokens ?? DEFAULT_MAX_TOKENS,
      ...(systemText ? { system: systemText } : {}),
      ...(mappedTools ? { tools: mappedTools } : {}),
      ...(mappedToolChoice ? { tool_choice: mappedToolChoice } : {}),
      ...(mappedStopSequences ? { stop_sequences: mappedStopSequences } : {}),
    };
  },

  transformResponse(body: unknown): OpenAIChatResponse {
    const res = body as AnthropicResponse;

    // Concatenate all text content blocks
    const textParts =
      res.content?.filter((c) => c.type === "text" && c.text).map((c) => c.text) ?? [];
    const content = textParts.length > 0 ? textParts.join("") : null;

    // Check for tool_use blocks
    const toolCalls = res.content?.filter((c) => c.type === "tool_use") ?? [];

    const message: Record<string, unknown> = {
      role: res.role ?? "assistant",
      content,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls.map((tc, i) => ({
        index: i,
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      }));
    }

    return {
      id: res.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: res.model,
      choices: [
        {
          index: 0,
          message: message as OpenAIChatResponse["choices"][0]["message"],
          finish_reason: mapStopReason(res.stop_reason),
        },
      ],
      usage: res.usage
        ? {
            prompt_tokens:
              res.usage.input_tokens +
              (res.usage.cache_creation_input_tokens ?? 0) +
              (res.usage.cache_read_input_tokens ?? 0),
            completion_tokens: res.usage.output_tokens,
            total_tokens:
              res.usage.input_tokens +
              (res.usage.cache_creation_input_tokens ?? 0) +
              (res.usage.cache_read_input_tokens ?? 0) +
              res.usage.output_tokens,
          }
        : undefined,
    };
  },

  extractUsage(body: unknown): TokenUsage | null {
    const res = body as AnthropicResponse | null;
    if (!res?.usage) return null;

    const baseInput = res.usage.input_tokens ?? 0;
    const cacheCreation = res.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = res.usage.cache_read_input_tokens ?? 0;
    const outputTokens = res.usage.output_tokens ?? 0;
    const inputTokens = baseInput + cacheCreation + cacheRead;

    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheCreationInputTokens: cacheCreation,
      cacheReadInputTokens: cacheRead,
    };
  },

  transformStreamEvent(eventData: string): string | null {
    let event: AnthropicStreamEvent;
    try {
      event = JSON.parse(eventData) as AnthropicStreamEvent;
    } catch {
      return null;
    }

    return match(event.type)
      .with("content_block_delta", () => {
        const delta = (event as Record<string, unknown>).delta as
          | Record<string, unknown>
          | undefined;
        if (!delta) return null;

        // text delta → OpenAI delta format
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          return JSON.stringify({
            choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
          });
        }

        // tool input delta
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          return JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (event as Record<string, unknown>).index ?? 0,
                      function: { arguments: delta.partial_json },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        }

        return null;
      })
      .with("message_delta", () => {
        // message_delta carries stop_reason — emit as final chunk with finish_reason
        const delta = (event as Record<string, unknown>).delta as
          | Record<string, unknown>
          | undefined;
        const stopReason = delta?.stop_reason as string | undefined;
        if (stopReason) {
          return JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(stopReason) }],
          });
        }
        return null;
      })
      .with("content_block_start", () => {
        // M5: Forward tool_use block start with id and name for tool-call streaming
        const contentBlock = (event as Record<string, unknown>).content_block as
          | Record<string, unknown>
          | undefined;
        if (contentBlock?.type === "tool_use") {
          return JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (event as Record<string, unknown>).index ?? 0,
                      id: contentBlock.id,
                      type: "function",
                      function: { name: contentBlock.name, arguments: "" },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        }
        return null;
      })
      .with("error", () => {
        // Forward Anthropic error events to client
        const errorObj = (event as Record<string, unknown>).error as
          | Record<string, unknown>
          | undefined;
        return JSON.stringify({
          error: {
            message: errorObj?.message ?? "Anthropic stream error",
            type: errorObj?.type ?? "stream_error",
          },
        });
      })
      .otherwise(() => null); // Skip: message_start, content_block_stop, ping
  },

  extractStreamUsage(eventData: string): TokenUsage | null {
    let event: AnthropicStreamEvent;
    try {
      event = JSON.parse(eventData) as AnthropicStreamEvent;
    } catch {
      return null;
    }

    return match(event.type)
      .with("message_start", () => {
        // message_start contains input_tokens + cache token fields in message.usage
        const message = (event as Record<string, unknown>).message as
          | Record<string, unknown>
          | undefined;
        const usage = message?.usage as Record<string, unknown> | undefined;
        if (!usage) return null;
        const baseInput = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
        const cacheCreation =
          typeof usage.cache_creation_input_tokens === "number"
            ? usage.cache_creation_input_tokens
            : 0;
        const cacheRead =
          typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : 0;
        const inputTokens = baseInput + cacheCreation + cacheRead;
        return {
          inputTokens,
          outputTokens: 0,
          totalTokens: inputTokens,
          cacheCreationInputTokens: cacheCreation,
          cacheReadInputTokens: cacheRead,
        } as TokenUsage;
      })
      .with("message_delta", () => {
        // message_delta contains output_tokens in usage
        const usage = (event as Record<string, unknown>).usage as
          | Record<string, unknown>
          | undefined;
        if (!usage) return null;
        const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
        return { inputTokens: 0, outputTokens, totalTokens: outputTokens } as TokenUsage;
      })
      .otherwise(() => null);
  },

  isStreamDone(eventData: string): boolean {
    try {
      const event = JSON.parse(eventData) as AnthropicStreamEvent;
      return event.type === "message_stop";
    } catch {
      return false;
    }
  },
};
