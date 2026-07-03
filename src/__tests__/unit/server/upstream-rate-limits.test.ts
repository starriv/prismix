/**
 * Unit tests for upstream rate-limit header capture (Phase 1 — observe-only).
 *
 * Covers:
 * - parseGoDuration / parseRfc3339ToEpochMs / clampCooldownMs helpers
 * - Per-adapter parseRateLimitHeaders for OpenAI, Anthropic, Azure, Gemini
 * - captureQuotaSnapshot dispatcher
 *
 * Deviation note: the spec suggested src/server/ai/lib/upstream-rate-limits.test.ts,
 * but vitest.config.ts only collects tests under src/__tests__/unit. Placed
 * here to match the existing test convention and ensure the suite runs.
 */
import { describe, expect, it } from "vitest";

import {
  captureQuotaSnapshot,
  clampCooldownMs,
  parseGoDuration,
  parseRfc3339ToEpochMs,
} from "@/server/ai/lib/upstream-rate-limits";
import { anthropicAdapter } from "@/server/ai/protocol-adapters/anthropic";
import { azureOpenaiAdapter } from "@/server/ai/protocol-adapters/azure-openai";
import { bedrockAdapter } from "@/server/ai/protocol-adapters/bedrock";
import { geminiAdapter } from "@/server/ai/protocol-adapters/gemini";
import { openaiAdapter } from "@/server/ai/protocol-adapters/openai";

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

// ── parseGoDuration ──────────────────────────────────────────────────

describe("parseGoDuration", () => {
  it("parses seconds", () => {
    expect(parseGoDuration("1s")).toBe(1000);
  });

  it("parses minutes + seconds", () => {
    expect(parseGoDuration("6m0s")).toBe(360000);
  });

  it("parses milliseconds", () => {
    expect(parseGoDuration("17ms")).toBe(17);
  });

  it("parses hours + minutes", () => {
    expect(parseGoDuration("2h45m")).toBe(9900000);
  });

  it("parses hours + minutes + seconds", () => {
    expect(parseGoDuration("1h30m45s")).toBe(5445000);
  });

  it("returns null for empty string", () => {
    expect(parseGoDuration("")).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseGoDuration(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseGoDuration(undefined)).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(parseGoDuration("invalid")).toBeNull();
  });

  it("returns null for trailing garbage", () => {
    expect(parseGoDuration("1sXYZ")).toBeNull();
  });

  it("returns null for gap between segments", () => {
    expect(parseGoDuration("1s 2s")).toBeNull();
  });

  it("returns 0 for zero duration", () => {
    expect(parseGoDuration("0s")).toBe(0);
  });
});

// ── parseRfc3339ToEpochMs ───────────────────────────────────────────

describe("parseRfc3339ToEpochMs", () => {
  it("parses valid RFC 3339 timestamp", () => {
    const ms = parseRfc3339ToEpochMs("2026-05-18T10:15:00Z");
    expect(ms).not.toBeNull();
    expect(typeof ms).toBe("number");
    expect(ms).toBe(Date.parse("2026-05-18T10:15:00Z"));
  });

  it("returns null for invalid string", () => {
    expect(parseRfc3339ToEpochMs("not-a-date")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseRfc3339ToEpochMs("")).toBeNull();
  });

  it("returns null for null", () => {
    expect(parseRfc3339ToEpochMs(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseRfc3339ToEpochMs(undefined)).toBeNull();
  });
});

// ── clampCooldownMs ─────────────────────────────────────────────────

describe("clampCooldownMs", () => {
  it("passes through small values", () => {
    expect(clampCooldownMs(5000)).toBe(5000);
  });

  it("clamps to 10-minute max", () => {
    expect(clampCooldownMs(600001)).toBe(600000);
  });

  it("clamps large Gemini-style values", () => {
    expect(clampCooldownMs(2970000)).toBe(600000);
  });

  it("enforces minimum 1ms for zero input (parseGoDuration('0s') case)", () => {
    expect(clampCooldownMs(0)).toBe(1);
  });

  it("enforces minimum 1ms for negative input", () => {
    expect(clampCooldownMs(-100)).toBe(1);
  });
});

// ── OpenAI parser ────────────────────────────────────────────────────

describe("openaiAdapter.parseRateLimitHeaders", () => {
  it("parses remaining requests and reset duration", () => {
    const headers = makeHeaders({
      "x-ratelimit-remaining-requests": "59",
      "x-ratelimit-reset-requests": "1s",
    });
    const before = Date.now();
    const result = openaiAdapter.parseRateLimitHeaders?.(headers);
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result?.remainingRequests).toBe(59);
    expect(result?.resetRequestsMs).not.toBeNull();
    const reset = result?.resetRequestsMs ?? 0;
    expect(reset).toBeGreaterThanOrEqual(before + 1000);
    expect(reset).toBeLessThanOrEqual(after + 1000);
  });

  it("parses all 6 base fields", () => {
    const headers = makeHeaders({
      "x-ratelimit-limit-requests": "500",
      "x-ratelimit-limit-tokens": "200000",
      "x-ratelimit-remaining-requests": "499",
      "x-ratelimit-remaining-tokens": "199750",
      "x-ratelimit-reset-requests": "6m0s",
      "x-ratelimit-reset-tokens": "5m59s",
    });
    const before = Date.now();
    const result = openaiAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.limitRequests).toBe(500);
    expect(result?.limitTokens).toBe(200000);
    expect(result?.remainingRequests).toBe(499);
    expect(result?.remainingTokens).toBe(199750);
    expect(result?.resetRequestsMs ?? 0).toBeGreaterThanOrEqual(before + 360000);
    expect(result?.resetTokensMs ?? 0).toBeGreaterThanOrEqual(before + 359000);
  });

  it("returns null when no rate-limit headers present", () => {
    const headers = makeHeaders({});
    expect(openaiAdapter.parseRateLimitHeaders?.(headers)).toBeNull();
  });
});

// ── Anthropic parser ────────────────────────────────────────────────

describe("anthropicAdapter.parseRateLimitHeaders", () => {
  it("parses RFC 3339 reset timestamps + retry-after", () => {
    const headers = makeHeaders({
      "anthropic-ratelimit-tokens-reset": "2027-05-18T10:15:00Z",
      "retry-after": "5",
    });
    const result = anthropicAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).toBe(5000);
    expect(result?.resetTokensMs).toBe(Date.parse("2027-05-18T10:15:00Z"));
  });

  it("parses all 6 base anthropic headers", () => {
    const headers = makeHeaders({
      "anthropic-ratelimit-requests-limit": "1000",
      "anthropic-ratelimit-requests-remaining": "999",
      "anthropic-ratelimit-requests-reset": "2027-05-18T10:15:00Z",
      "anthropic-ratelimit-tokens-limit": "80000",
      "anthropic-ratelimit-tokens-remaining": "79000",
      "anthropic-ratelimit-tokens-reset": "2027-05-18T10:15:30Z",
    });
    const result = anthropicAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.limitRequests).toBe(1000);
    expect(result?.remainingRequests).toBe(999);
    expect(result?.resetRequestsMs).toBe(Date.parse("2027-05-18T10:15:00Z"));
    expect(result?.limitTokens).toBe(80000);
    expect(result?.remainingTokens).toBe(79000);
    expect(result?.resetTokensMs).toBe(Date.parse("2027-05-18T10:15:30Z"));
  });

  it("clamps past timestamps to 1s forward window", () => {
    const pastTimestamp = new Date(Date.now() - 60000).toISOString();
    const headers = makeHeaders({
      "anthropic-ratelimit-requests-reset": pastTimestamp,
    });
    const before = Date.now();
    const result = anthropicAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.resetRequestsMs ?? 0).toBeGreaterThanOrEqual(before + 1000);
  });

  it("does NOT parse tokens-reset as Go duration (regression for sagentic-ai bug)", () => {
    const headers = makeHeaders({
      "anthropic-ratelimit-tokens-reset": "2027-05-18T10:15:00Z",
    });
    const result = anthropicAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.resetTokensMs).toBe(Date.parse("2027-05-18T10:15:00Z"));
  });

  it("returns null when no rate-limit headers present", () => {
    const headers = makeHeaders({});
    expect(anthropicAdapter.parseRateLimitHeaders?.(headers)).toBeNull();
  });
});

// ── Azure OpenAI parser ──────────────────────────────────────────────

describe("azureOpenaiAdapter.parseRateLimitHeaders", () => {
  it("normalizes -1 limit sentinel to null", () => {
    const headers = makeHeaders({
      "x-ratelimit-limit-requests": "-1",
      "x-ratelimit-reset-tokens": "0",
    });
    const result = azureOpenaiAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.limitRequests).toBeNull();
    expect(result?.resetTokensMs).toBeNull();
  });

  it("normalizes -1 remaining sentinel to null", () => {
    const headers = makeHeaders({
      "x-ratelimit-remaining-requests": "-1",
    });
    const result = azureOpenaiAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.remainingRequests).toBeNull();
  });

  it("parses reset as integer seconds (not Go duration)", () => {
    const headers = makeHeaders({
      "x-ratelimit-reset-requests": "5",
      "x-ratelimit-reset-tokens": "10",
    });
    const before = Date.now();
    const result = azureOpenaiAdapter.parseRateLimitHeaders?.(headers);
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result?.resetRequestsMs ?? 0).toBeGreaterThanOrEqual(before + 5000);
    expect(result?.resetRequestsMs ?? 0).toBeLessThanOrEqual(after + 5000);
    expect(result?.resetTokensMs ?? 0).toBeGreaterThanOrEqual(before + 10000);
  });

  it("parses retry-after-ms on 429", () => {
    const headers = makeHeaders({
      "retry-after-ms": "2000",
    });
    const result = azureOpenaiAdapter.parseRateLimitHeaders?.(headers);

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).toBe(2000);
  });

  it("returns null when no rate-limit headers present", () => {
    const headers = makeHeaders({});
    expect(azureOpenaiAdapter.parseRateLimitHeaders?.(headers)).toBeNull();
  });
});

// ── Gemini parser ───────────────────────────────────────────────────

describe("geminiAdapter.parseRateLimitHeaders", () => {
  it("parses 429 error body with quotaResetDelay and quotaResetTimeStamp", () => {
    const errorBody = {
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "QUOTA_EXHAUSTED",
            metadata: {
              quotaResetDelay: "49m30s",
              quotaResetTimeStamp: "2026-04-10T01:47:33Z",
            },
          },
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "2970s",
          },
        ],
      },
    };
    const result = geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody);

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).toBe(2970000);
    expect(result?.resetRequestsMs).toBe(Date.parse("2026-04-10T01:47:33Z"));
    expect(result?.remainingRequests).toBeNull();
    expect(result?.remainingTokens).toBeNull();
    expect(result?.limitRequests).toBeNull();
    expect(result?.limitTokens).toBeNull();
  });

  it("returns null when no error body provided", () => {
    expect(geminiAdapter.parseRateLimitHeaders?.(new Headers())).toBeNull();
  });

  it("returns null when error body has no quota metadata", () => {
    const errorBody = { error: { code: 429, message: "quota exceeded" } };
    expect(geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody)).toBeNull();
  });

  it("returns null when details array is missing", () => {
    const errorBody = { error: { code: 429 } };
    expect(geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody)).toBeNull();
  });

  it("derives retryAfterMs from quotaResetTimeStamp alone (L5 fix)", () => {
    const futureTimestamp = new Date(Date.now() + 30_000).toISOString();
    const errorBody = {
      error: {
        code: 429,
        details: [
          {
            metadata: {
              quotaResetTimeStamp: futureTimestamp,
            },
          },
        ],
      },
    };
    const before = Date.now();
    const result = geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody);
    const after = Date.now();

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).not.toBeNull();
    const retryAfter = result?.retryAfterMs ?? 0;
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30_000);
    expect(retryAfter).toBeGreaterThanOrEqual(30_000 - (after - before));
    expect(result?.resetRequestsMs).toBe(Date.parse(futureTimestamp));
  });

  it("does not derive retryAfterMs from past quotaResetTimeStamp", () => {
    const pastTimestamp = new Date(Date.now() - 60_000).toISOString();
    const errorBody = {
      error: {
        code: 429,
        details: [
          {
            metadata: {
              quotaResetTimeStamp: pastTimestamp,
            },
          },
        ],
      },
    };
    const result = geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody);

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).toBeNull();
    expect(result?.resetRequestsMs).toBe(Date.parse(pastTimestamp));
  });

  it("prefers quotaResetDelay over quotaResetTimeStamp for retryAfterMs", () => {
    const futureTimestamp = new Date(Date.now() + 600_000).toISOString();
    const errorBody = {
      error: {
        code: 429,
        details: [
          {
            metadata: {
              quotaResetDelay: "30s",
              quotaResetTimeStamp: futureTimestamp,
            },
          },
        ],
      },
    };
    const result = geminiAdapter.parseRateLimitHeaders?.(new Headers(), errorBody);

    expect(result).not.toBeNull();
    expect(result?.retryAfterMs).toBe(30_000);
    expect(result?.resetRequestsMs).toBe(Date.parse(futureTimestamp));
  });
});

// ── Bedrock (no parser) ──────────────────────────────────────────────

describe("bedrockAdapter (no rate-limit parser)", () => {
  it("does not export parseRateLimitHeaders", () => {
    expect(bedrockAdapter.parseRateLimitHeaders).toBeUndefined();
  });
});

// ── captureQuotaSnapshot dispatcher ──────────────────────────────────

describe("captureQuotaSnapshot", () => {
  it("returns null when adapter has no parseRateLimitHeaders", () => {
    const response = new Response("{}", { headers: makeHeaders({}) });
    const snapshot = captureQuotaSnapshot(bedrockAdapter, "cred-1", "bedrock", response);
    expect(snapshot).toBeNull();
  });

  it("returns null when adapter parser returns null", () => {
    const response = new Response("{}", { headers: makeHeaders({}) });
    const snapshot = captureQuotaSnapshot(openaiAdapter, "cred-1", "openai", response);
    expect(snapshot).toBeNull();
  });

  it("fills in credentialId, provider, and capturedAt", () => {
    const headers = makeHeaders({
      "x-ratelimit-remaining-requests": "42",
      "x-ratelimit-reset-requests": "1s",
    });
    const response = new Response("{}", { headers });
    const before = Date.now();
    const snapshot = captureQuotaSnapshot(openaiAdapter, "cred-99", "openai", response);
    const after = Date.now();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.credentialId).toBe("cred-99");
    expect(snapshot?.provider).toBe("openai");
    expect(snapshot?.remainingRequests).toBe(42);
    expect(snapshot?.remainingTokens).toBeNull();
    expect(snapshot?.limitRequests).toBeNull();
    expect(snapshot?.limitTokens).toBeNull();
    expect(snapshot?.resetRequestsMs).not.toBeNull();
    expect(snapshot?.resetRequestsMs ?? 0).toBeGreaterThanOrEqual(before + 1000);
    expect(snapshot?.resetRequestsMs ?? 0).toBeLessThanOrEqual(after + 1000);
    expect(snapshot?.resetTokensMs).toBeNull();
    expect(snapshot?.retryAfterMs).toBeNull();
    expect(snapshot?.capturedAt).not.toBeNull();
    const captured = Date.parse(snapshot?.capturedAt ?? "");
    expect(captured).toBeGreaterThanOrEqual(before);
    expect(captured).toBeLessThanOrEqual(after + 1000);
  });

  it("passes errorBody to Gemini adapter", () => {
    const errorBody = {
      error: {
        code: 429,
        details: [
          {
            metadata: {
              quotaResetDelay: "49m30s",
              quotaResetTimeStamp: "2026-04-10T01:47:33Z",
            },
          },
        ],
      },
    };
    const response = new Response("{}", { headers: new Headers() });
    const snapshot = captureQuotaSnapshot(geminiAdapter, "cred-1", "gemini", response, errorBody);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.retryAfterMs).toBe(2970000);
    expect(snapshot?.provider).toBe("gemini");
  });
});
