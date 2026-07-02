import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { AiUsageRecord } from "@/web/api/schemas";
import { buildPerformanceDetailRows } from "@/web/pages/ai-logs/log-detail";
import {
  formatBytes,
  formatDurationMs,
  formatGatewayCacheHitRate,
  formatProviderPromptCacheReadRate,
  hasPerformanceMetrics,
} from "@/web/pages/ai-logs/performance";

function makeLog(overrides: Partial<AiUsageRecord> = {}): AiUsageRecord {
  return {
    id: 1,
    endpointCredentialId: null,
    endpointId: "test",
    modelId: "test-model",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: null,
    latencyMs: null,
    statusCode: 200,
    requestId: "req-test",
    error: null,
    createdAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatDurationMs", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatDurationMs(null)).toBe("-");
    expect(formatDurationMs(undefined)).toBe("-");
  });
  it("formats sub-second as ms", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(500)).toBe("500ms");
    expect(formatDurationMs(999)).toBe("999ms");
  });
  it("formats seconds", () => {
    expect(formatDurationMs(1000)).toBe("1s");
    expect(formatDurationMs(1500)).toBe("1.5s");
  });
  it("formats minutes", () => {
    expect(formatDurationMs(60000)).toBe("1m");
    expect(formatDurationMs(90000)).toBe("1.5m");
  });
});

describe("formatBytes", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(undefined)).toBe("-");
  });
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(512)).toBe("512B");
    expect(formatBytes(1023)).toBe("1023B");
  });
  it("formats KB", () => {
    expect(formatBytes(1024)).toBe("1KB");
    expect(formatBytes(1536)).toBe("1.5KB");
  });
  it("formats MB", () => {
    expect(formatBytes(1048576)).toBe("1MB");
    expect(formatBytes(1572864)).toBe("1.5MB");
  });
});

describe("formatGatewayCacheHitRate", () => {
  it("returns an unavailable marker when there are no cache-eligible requests", () => {
    expect(formatGatewayCacheHitRate(null)).toBe("—");
    expect(formatGatewayCacheHitRate({ cacheEligibleRequests: 0, cacheHitRate: 0 })).toBe("—");
  });

  it("formats hit rate when hit/miss denominator exists", () => {
    expect(formatGatewayCacheHitRate({ cacheEligibleRequests: 10, cacheHitRate: 0.4 })).toBe("40%");
  });
});

describe("formatProviderPromptCacheReadRate", () => {
  it("returns unavailable when no provider cache tokens were observed", () => {
    expect(formatProviderPromptCacheReadRate(null)).toBe("—");
    expect(
      formatProviderPromptCacheReadRate({
        promptCacheCreationInputTokens: 0,
        promptCacheReadInputTokens: 0,
        promptCacheReadRate: 0,
      }),
    ).toBe("—");
  });

  it("formats zero read rate when provider cache token fields were observed through writes", () => {
    expect(
      formatProviderPromptCacheReadRate({
        promptCacheCreationInputTokens: 100,
        promptCacheReadInputTokens: 0,
        promptCacheReadRate: 0,
      }),
    ).toBe("0%");
  });
});

describe("hasPerformanceMetrics", () => {
  it("returns false for legacy row (all null)", () => {
    expect(hasPerformanceMetrics(makeLog())).toBe(false);
  });
  it("returns true when cacheStatus is set", () => {
    expect(hasPerformanceMetrics(makeLog({ cacheStatus: "hit" }))).toBe(true);
    expect(hasPerformanceMetrics(makeLog({ cacheStatus: "miss" }))).toBe(true);
    expect(hasPerformanceMetrics(makeLog({ cacheStatus: "bypass" }))).toBe(true);
  });
  it("returns true when retryCount > 0", () => {
    expect(hasPerformanceMetrics(makeLog({ retryCount: 5 }))).toBe(true);
  });
  it("returns false when retryCount is 0 (filtered)", () => {
    expect(hasPerformanceMetrics(makeLog({ retryCount: 0 }))).toBe(false);
  });
  it("returns true when upstreamTtfbMs > 0", () => {
    expect(hasPerformanceMetrics(makeLog({ upstreamTtfbMs: 300 }))).toBe(true);
  });
  it("returns false when upstreamTtfbMs is 0 (filtered)", () => {
    expect(hasPerformanceMetrics(makeLog({ upstreamTtfbMs: 0 }))).toBe(false);
  });
  it("returns true when streamChunks > 0", () => {
    expect(hasPerformanceMetrics(makeLog({ streamChunks: 100 }))).toBe(true);
  });
  it("returns true when cacheReadInputTokens > 0", () => {
    expect(hasPerformanceMetrics(makeLog({ cacheReadInputTokens: 128 }))).toBe(true);
  });
  it("returns false when only latencyMs is set (not in checked list)", () => {
    expect(hasPerformanceMetrics(makeLog({ latencyMs: 500 }))).toBe(false);
  });
});

describe("buildPerformanceDetailRows", () => {
  const t = ((key: string) => key) as TFunction;
  const keysFor = (overrides: Partial<AiUsageRecord>) =>
    buildPerformanceDetailRows(makeLog(overrides), t).map((row) => row.key);

  it("hides inapplicable non-stream and cache-token rows for streaming bypass logs", () => {
    const keys = keysFor({
      routeType: "chat",
      isStream: true,
      cacheStatus: "bypass",
      routingMs: 2,
      queueWaitMs: 1,
      upstreamTtfbMs: 1800,
      firstChunkMs: 1900,
      billingMs: 0,
      requestBytes: 454 * 1024,
      responseBytes: 7600,
      streamChunks: 25,
      streamBytes: 7600,
      streamPingCount: 0,
      streamAbortReason: "completed",
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });

    expect(keys).toContain("first-chunk");
    expect(keys).toContain("stream-chunks");
    expect(keys).toContain("stream-bytes");
    expect(keys).toContain("abort-reason");
    expect(keys).not.toContain("cache-lookup");
    expect(keys).not.toContain("cache-write");
    expect(keys).not.toContain("upstream-body");
    expect(keys).not.toContain("transform");
    expect(keys).not.toContain("response-bytes");
    expect(keys).not.toContain("stream-pings");
    expect(keys).not.toContain("cache-read-tokens");
    expect(keys).not.toContain("cache-write-tokens");
  });

  it("shows cache and non-stream processing rows when those probes exist", () => {
    const keys = keysFor({
      routeType: "chat",
      isStream: false,
      cacheStatus: "miss",
      cacheLookupMs: 1,
      cacheWriteMs: 2,
      upstreamBodyMs: 30,
      transformMs: 1,
      responseBytes: 2048,
      cacheReadInputTokens: 128,
    });

    expect(keys).toContain("cache-lookup");
    expect(keys).toContain("cache-write");
    expect(keys).toContain("upstream-body");
    expect(keys).toContain("transform");
    expect(keys).toContain("response-bytes");
    expect(keys).toContain("cache-read-tokens");
    expect(keys).not.toContain("first-chunk");
  });
});
