/**
 * OpenAI adapter — passthrough for all OpenAI-compatible upstreams.
 *
 * Covers: OpenAI, DeepSeek, Groq, Zhipu GLM, Mistral, Together, Ollama, etc.
 * These upstreams accept the OpenAI chat completions format natively, so
 * transformRequest/transformResponse are identity functions.
 */
import { extractTokenUsageFromUsageObject } from "../lib/token-usage";
import type {
  BuildUrlOptions,
  OpenAIChatBody,
  OpenAIChatResponse,
  ProtocolAdapter,
  TokenUsage,
} from "./types";

function extractUsageFromObject(body: unknown): TokenUsage | null {
  const obj = body as Record<string, unknown> | null;
  const usage = obj?.usage as Record<string, unknown> | undefined;
  return extractTokenUsageFromUsageObject(usage, { returnZeroWhenEmpty: true });
}

function usesMaxCompletionTokens(model: string): boolean {
  return /^(?:gpt-5|o[134])(?:[.-]|$)/.test(model);
}

export const openaiAdapter: ProtocolAdapter = {
  format: "openai",

  transformRequest(body: OpenAIChatBody): unknown {
    let normalized: OpenAIChatBody | Omit<OpenAIChatBody, "max_tokens"> = body;
    if (body.max_tokens && usesMaxCompletionTokens(body.model)) {
      const { max_tokens, ...rest } = body;
      normalized = { ...rest, max_completion_tokens: max_tokens };
    }

    // Inject stream_options so OpenAI-compatible upstreams include usage in SSE chunks.
    if (normalized.stream) {
      return { ...normalized, stream_options: { include_usage: true } };
    }
    return normalized;
  },

  transformResponse(body: unknown): OpenAIChatResponse {
    return body as OpenAIChatResponse;
  },

  extractUsage(body: unknown): TokenUsage | null {
    return extractUsageFromObject(body);
  },

  transformStreamEvent(eventData: string): string | null {
    return eventData;
  },

  extractStreamUsage(eventData: string): TokenUsage | null {
    try {
      const parsed = JSON.parse(eventData) as Record<string, unknown>;
      return extractUsageFromObject(parsed);
    } catch {
      return null;
    }
  },

  isStreamDone(eventData: string): boolean {
    return eventData.trim() === "[DONE]";
  },

  buildUrl(baseUrl: string, _opts: BuildUrlOptions): string {
    // Ensure no double slash: strip trailing slash from baseUrl
    const base = baseUrl.replace(/\/+$/, "");
    return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  },
};
