/**
 * OpenAI adapter — passthrough for all OpenAI-compatible providers.
 *
 * Covers: OpenAI, DeepSeek, Groq, Zhipu GLM, Mistral, Together, Ollama, etc.
 * These providers accept the OpenAI chat completions format natively, so
 * transformRequest/transformResponse are identity functions.
 */
import type {
  BuildUrlOptions,
  OpenAIChatBody,
  OpenAIChatResponse,
  ProviderAdapter,
  TokenUsage,
} from "./types";

function extractUsageFromObject(body: unknown): TokenUsage | null {
  const obj = body as Record<string, unknown> | null;
  const usage = obj?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export const openaiAdapter: ProviderAdapter = {
  format: "openai",

  transformRequest(body: OpenAIChatBody): unknown {
    // Inject stream_options so OpenAI-compatible providers include usage in SSE chunks
    if (body.stream) {
      return { ...body, stream_options: { include_usage: true } };
    }
    return body;
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
    return `${base}/chat/completions`;
  },
};
