/**
 * OpenAI adapter — passthrough for all OpenAI-compatible upstreams.
 *
 * Covers: OpenAI, DeepSeek, Groq, Zhipu GLM, Mistral, Together, Ollama, etc.
 * These upstreams accept the OpenAI chat completions format natively, so
 * transformRequest/transformResponse are identity functions.
 */
import { buildOpenAiCompatibleUrl } from "../lib/openai-compatible-url";
import { extractTokenUsageFromUsageObject } from "../lib/token-usage";
import { parseGoDuration, type UpstreamQuotaSnapshot } from "../lib/upstream-rate-limits";
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

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Parse `x-ratelimit-*` headers for the OpenAI family.
 *
 * Reset values are Go `time.Duration` strings (e.g. `"1s"`, `"6m0s"`); the
 * absolute reset epoch is computed as `Date.now() + parseGoDuration(header)`.
 */
export function parseOpenAiRateLimitHeaders(
  headers: Headers,
): Partial<UpstreamQuotaSnapshot> | null {
  const limitRequests = parseNonNegativeInt(headers.get("x-ratelimit-limit-requests"));
  const limitTokens = parseNonNegativeInt(headers.get("x-ratelimit-limit-tokens"));
  const remainingRequests = parseNonNegativeInt(headers.get("x-ratelimit-remaining-requests"));
  const remainingTokens = parseNonNegativeInt(headers.get("x-ratelimit-remaining-tokens"));

  const resetRequestsDuration = parseGoDuration(headers.get("x-ratelimit-reset-requests"));
  const resetTokensDuration = parseGoDuration(headers.get("x-ratelimit-reset-tokens"));
  const now = Date.now();
  const resetRequestsMs = resetRequestsDuration == null ? null : now + resetRequestsDuration;
  const resetTokensMs = resetTokensDuration == null ? null : now + resetTokensDuration;

  const hasAny =
    limitRequests !== null ||
    limitTokens !== null ||
    remainingRequests !== null ||
    remainingTokens !== null ||
    resetRequestsMs !== null ||
    resetTokensMs !== null;
  if (!hasAny) return null;

  return {
    remainingRequests,
    remainingTokens,
    limitRequests,
    limitTokens,
    resetRequestsMs,
    resetTokensMs,
  };
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
    return buildOpenAiCompatibleUrl(baseUrl, "chat/completions");
  },

  parseRateLimitHeaders: parseOpenAiRateLimitHeaders,
};
