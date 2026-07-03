/**
 * Upstream rate-limit header capture — Phase 1 (observe-only).
 *
 * Normalizes the heterogeneous rate-limit/quota signals returned by upstream
 * LLM providers (OpenAI, Anthropic, Azure OpenAI, Google Gemini) into a single
 * provider-agnostic `UpstreamQuotaSnapshot`.
 *
 * Per-adapter parsers live in `src/server/ai/protocol-adapters/`. This module
 * exports the shared types, parsing helpers, and the dispatcher that combines
 * an adapter's partial parse with credential identity to produce a full
 * snapshot.
 *
 * Phase 2 (cooldown) and Phase 3 (routing) build on this foundation.
 */
import type { ProtocolAdapter } from "../protocol-adapters/types";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Normalized, provider-agnostic view of upstream rate-limit quota.
 *
 * All reset values are absolute epoch milliseconds (normalized from whichever
 * format the provider uses — Go duration, integer seconds, or RFC 3339
 * timestamp).
 */
export interface UpstreamQuotaSnapshot {
  credentialId: string;
  provider: "openai" | "anthropic" | "azure-openai" | "gemini" | "bedrock";

  /** Remaining requests in current window. null = provider did not report. */
  remainingRequests: number | null;

  /** Remaining tokens in current window. null = provider did not report. */
  remainingTokens: number | null;

  /** Max requests per window, if reported. null = unknown. */
  limitRequests: number | null;

  /** Max tokens per window, if reported. null = unknown. */
  limitTokens: number | null;

  /**
   * Absolute epoch ms when the request window resets.
   * Computed as: now + parsed-reset-duration (OpenAI/Azure) OR
   *               parsed RFC 3339 timestamp (Anthropic/Gemini).
   * null = provider did not report or sentinel (-1/0 from Azure bug).
   */
  resetRequestsMs: number | null;
  resetTokensMs: number | null;

  /**
   * Only set on 429 responses. Recommended backoff in ms.
   * OpenAI: not documented → derive from resetRequestsMs.
   * Anthropic: `retry-after` header × 1000.
   * Azure: `retry-after-ms` header (already in ms).
   * Gemini: `quotaResetDelay` from error body, parsed to ms.
   */
  retryAfterMs: number | null;

  /** ISO 8601 timestamp when this snapshot was captured. */
  capturedAt: string;
}

// ── Duration / timestamp parsing helpers ──────────────────────────────

const GO_DURATION_UNIT_MS: Record<string, number> = {
  ns: 1 / 1_000_000,
  us: 1 / 1000,
  "\u00B5s": 1 / 1000, // µs (micro sign U+00B5, used by Go's time.Duration.String())
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

const GO_DURATION_PATTERN = /(\d+)(ns|us|\u00B5s|ms|s|m|h)/g;

/**
 * Parse a Go `time.Duration` string (e.g. `"1s"`, `"6m0s"`, `"17ms"`,
 * `"2h45m"`, `"1h30m45s"`) into milliseconds.
 *
 * Returns `null` for malformed input (does NOT throw).
 * Handles both `us` (ASCII) and `µs` (U+00B5 micro sign) — Go emits the latter.
 */
export function parseGoDuration(s: string | null | undefined): number | null {
  if (s == null) return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;

  let total = 0;
  let lastIndex = 0;
  for (const match of trimmed.matchAll(GO_DURATION_PATTERN)) {
    // Reject if there are skipped characters between segments (malformed).
    if (match.index !== lastIndex) return null;

    const value = parseInt(match[1] ?? "", 10);
    const unit = match[2] ?? "";
    const multiplier = GO_DURATION_UNIT_MS[unit];
    if (multiplier === undefined) return null;

    total += value * multiplier;
    lastIndex = match.index + match[0].length;
  }

  // Reject if the entire string was not consumed (trailing garbage).
  if (lastIndex !== trimmed.length) return null;
  return total;
}

/**
 * Parse an RFC 3339 timestamp (e.g. `"2026-05-18T10:15:00Z"`) to epoch
 * milliseconds.
 *
 * Returns `null` for invalid input (does NOT throw). `Date.parse` returns
 * `NaN` for unparseable input — this wrapper normalizes that to `null`.
 */
export function parseRfc3339ToEpochMs(s: string | null | undefined): number | null {
  if (s == null) return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;

  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

// ── Cooldown clamping ────────────────────────────────────────────────

/** Maximum cooldown duration (10 minutes) — see resolved decision #2. */
export const MAX_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Clamp a cooldown duration to the 10-minute maximum.
 *
 * Gemini's `quotaResetDelay` can be ~50 minutes; we intentionally cap it to
 * avoid a single 429 blocking a credential for an hour.
 *
 * Also enforces a minimum of 1ms — `parseGoDuration("0s")` returns 0, and
 * Redis `SET key value PX 0` rejects the command. A 0ms cooldown is
 * meaningless anyway (no cooldown).
 */
export function clampCooldownMs(ms: number): number {
  return Math.max(1, Math.min(ms, MAX_COOLDOWN_MS));
}

// ── Dispatcher ───────────────────────────────────────────────────────

/**
 * Capture a quota snapshot from an upstream response.
 *
 * Delegates to the adapter's optional `parseRateLimitHeaders` method, then
 * fills in credential identity and capture timestamp.
 *
 * Returns `null` if the adapter does not expose rate-limit headers (e.g.
 * Bedrock) or if the response carries no parseable quota data.
 *
 * For providers that embed quota in the error body (Gemini), pass the parsed
 * error body as the fourth argument.
 */
export function captureQuotaSnapshot(
  adapter: ProtocolAdapter,
  credentialId: string,
  provider: UpstreamQuotaSnapshot["provider"],
  response: Response,
  errorBody?: unknown,
): UpstreamQuotaSnapshot | null {
  if (!adapter.parseRateLimitHeaders) return null;

  const parsed = adapter.parseRateLimitHeaders(response.headers, errorBody);
  if (!parsed) return null;

  return normalizeSnapshot(parsed, credentialId, provider);
}

/**
 * Merge a partial adapter-parsed snapshot with credential identity.
 *
 * Ensures every field is present (null where the adapter did not report).
 */
function normalizeSnapshot(
  parsed: Partial<UpstreamQuotaSnapshot>,
  credentialId: string,
  provider: UpstreamQuotaSnapshot["provider"],
): UpstreamQuotaSnapshot {
  return {
    credentialId,
    provider,
    remainingRequests: parsed.remainingRequests ?? null,
    remainingTokens: parsed.remainingTokens ?? null,
    limitRequests: parsed.limitRequests ?? null,
    limitTokens: parsed.limitTokens ?? null,
    resetRequestsMs: parsed.resetRequestsMs ?? null,
    resetTokensMs: parsed.resetTokensMs ?? null,
    retryAfterMs: parsed.retryAfterMs ?? null,
    capturedAt: new Date().toISOString(),
  };
}
