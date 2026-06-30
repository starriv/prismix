import { describe, expect, it } from "vitest";

import type { AiUsageRecord } from "@/web/api/schemas";
import {
  formatBytes,
  formatDurationMs,
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
