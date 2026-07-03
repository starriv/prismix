/**
 * Azure OpenAI adapter — delegates all transforms to the OpenAI adapter.
 *
 * Azure uses the same request/response format as OpenAI but with a different
 * URL pattern: /openai/deployments/{model}/chat/completions?api-version=...
 * Auth uses api-key header (configured via endpoint authConfig).
 */
import type { UpstreamQuotaSnapshot } from "../lib/upstream-rate-limits";
import { openaiAdapter } from "./openai";
import type { BuildUrlOptions, ProtocolAdapter } from "./types";

const API_VERSION = "2024-02-01";

const AZURE_SENTINEL_LIMIT = -1;
const AZURE_SENTINEL_RESET = 0;
const AZURE_SENTINEL_REMAINING = -1;

function parseNonNegativeInt(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Parse Azure OpenAI rate-limit headers.
 *
 * Same header NAMES as OpenAI, but reset values are PLAIN INTEGERS (seconds),
 * NOT Go durations. Azure's Responses API is known to return `-1` for limit
 * and `0` for reset (confirmed Microsoft bug) — these sentinels are normalized
 * to `null`. The 429-only `retry-after-ms` header is already in milliseconds.
 */
export function parseAzureOpenAiRateLimitHeaders(
  headers: Headers,
): Partial<UpstreamQuotaSnapshot> | null {
  const rawLimitRequests = headers.get("x-ratelimit-limit-requests");
  const rawLimitTokens = headers.get("x-ratelimit-limit-tokens");
  const rawRemainingRequests = headers.get("x-ratelimit-remaining-requests");
  const rawRemainingTokens = headers.get("x-ratelimit-remaining-tokens");
  const rawResetRequests = headers.get("x-ratelimit-reset-requests");
  const rawResetTokens = headers.get("x-ratelimit-reset-tokens");

  const limitRequests =
    rawLimitRequests == null || Number(rawLimitRequests) === AZURE_SENTINEL_LIMIT
      ? null
      : parseNonNegativeInt(rawLimitRequests);
  const limitTokens =
    rawLimitTokens == null || Number(rawLimitTokens) === AZURE_SENTINEL_LIMIT
      ? null
      : parseNonNegativeInt(rawLimitTokens);
  const remainingRequests =
    rawRemainingRequests == null || Number(rawRemainingRequests) === AZURE_SENTINEL_REMAINING
      ? null
      : parseNonNegativeInt(rawRemainingRequests);
  const remainingTokens =
    rawRemainingTokens == null || Number(rawRemainingTokens) === AZURE_SENTINEL_REMAINING
      ? null
      : parseNonNegativeInt(rawRemainingTokens);

  const now = Date.now();
  const resetRequestsSec =
    rawResetRequests == null || Number(rawResetRequests) === AZURE_SENTINEL_RESET
      ? null
      : parseNonNegativeInt(rawResetRequests);
  const resetTokensSec =
    rawResetTokens == null || Number(rawResetTokens) === AZURE_SENTINEL_RESET
      ? null
      : parseNonNegativeInt(rawResetTokens);
  const resetRequestsMs = resetRequestsSec == null ? null : now + resetRequestsSec * 1000;
  const resetTokensMs = resetTokensSec == null ? null : now + resetTokensSec * 1000;

  const retryAfterMs = parseNonNegativeInt(headers.get("retry-after-ms"));

  const hasAnyHeader =
    rawLimitRequests !== null ||
    rawLimitTokens !== null ||
    rawRemainingRequests !== null ||
    rawRemainingTokens !== null ||
    rawResetRequests !== null ||
    rawResetTokens !== null ||
    headers.get("retry-after-ms") !== null;
  if (!hasAnyHeader) return null;

  return {
    remainingRequests,
    remainingTokens,
    limitRequests,
    limitTokens,
    resetRequestsMs,
    resetTokensMs,
    retryAfterMs,
  };
}

export const azureOpenaiAdapter: ProtocolAdapter = {
  format: "azure-openai",

  buildUrl(baseUrl: string, opts: BuildUrlOptions): string {
    const base = baseUrl.replace(/\/+$/, "");
    return `${base}/openai/deployments/${opts.model}/chat/completions?api-version=${API_VERSION}`;
  },

  // All transform methods delegate to the OpenAI adapter (same format)
  transformRequest: openaiAdapter.transformRequest,
  transformResponse: openaiAdapter.transformResponse,
  extractUsage: openaiAdapter.extractUsage,
  transformStreamEvent: openaiAdapter.transformStreamEvent,
  extractStreamUsage: openaiAdapter.extractStreamUsage,
  isStreamDone: openaiAdapter.isStreamDone,

  parseRateLimitHeaders: parseAzureOpenAiRateLimitHeaders,
};
