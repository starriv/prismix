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
  ProviderAdapter,
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

// ── Adapter ──────────────────────────────────────────────────────────

export const anthropicAdapter: ProviderAdapter = {
  format: "anthropic",

  buildUrl(baseUrl: string, _opts: BuildUrlOptions): string {
    return `${baseUrl.replace(/\/+$/, "")}/messages`;
  },

  transformRequest(body: OpenAIChatBody): unknown {
    // Extract system/developer messages → top-level `system` field
    const systemMessages = body.messages.filter((m) => INSTRUCTION_ROLES.has(m.role));
    const nonSystemMessages = body.messages.filter((m) => !INSTRUCTION_ROLES.has(m.role));

    const systemText = systemMessages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .filter(Boolean)
      .join("\n\n");

    // Build Anthropic request — spread to preserve extra fields (tools, etc.)
    const { messages: _msgs, max_tokens, ...rest } = body;

    return {
      ...rest,
      messages: nonSystemMessages,
      max_tokens: max_tokens ?? DEFAULT_MAX_TOKENS,
      ...(systemText ? { system: systemText } : {}),
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
