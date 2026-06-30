import { describe, expect, it } from "vitest";

import { aiUsageRecordSchema, aiUsageSummarySchema } from "@/web/api/ai-schemas";

describe("ai log performance schemas", () => {
  it("parses legacy usage rows without performance fields", () => {
    const parsed = aiUsageRecordSchema.parse({
      id: 1,
      endpointCredentialId: null,
      endpointId: "openai",
      modelId: "gpt-test",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      estimatedCost: "0.001",
      latencyMs: 250,
      statusCode: 200,
      requestId: "req_legacy",
      error: null,
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.cacheStatus).toBeUndefined();
    expect(parsed.cacheReadInputTokens).toBeUndefined();
  });

  it("parses usage rows with performance and cache token fields", () => {
    const parsed = aiUsageRecordSchema.parse({
      id: 2,
      endpointCredentialId: 10,
      endpointId: "anthropic",
      modelId: "claude-test",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      estimatedCost: "0.002",
      latencyMs: 1500,
      routeType: "chat",
      isStream: true,
      cacheStatus: "miss",
      upstreamTtfbMs: 300,
      firstChunkMs: 450,
      streamChunks: 12,
      streamBytes: 4096,
      cacheCreationInputTokens: 64,
      cacheReadInputTokens: 128,
      statusCode: 200,
      requestId: "req_perf",
      error: null,
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(parsed.upstreamTtfbMs).toBe(300);
    expect(parsed.cacheReadInputTokens).toBe(128);
  });

  it("defaults new aggregate performance fields for old summary payloads", () => {
    const parsed = aiUsageSummarySchema.parse({
      totalRequests: 1,
      totalInputTokens: 10,
      totalOutputTokens: 5,
      totalTokens: 15,
      totalEstimatedCost: 0.001,
      errorCount: 0,
      errorRate: 0,
      byEndpoint: [],
      byModel: [],
    });

    expect(parsed.cacheHitRate).toBe(0);
    expect(parsed.cacheEligibleRequests).toBe(0);
    expect(parsed.p95LatencyMs).toBe(0);
    expect(parsed.promptCacheReadRate).toBe(0);
  });

  it("parses aggregate cache denominator fields", () => {
    const parsed = aiUsageSummarySchema.parse({
      totalRequests: 12,
      totalInputTokens: 100,
      totalOutputTokens: 20,
      totalTokens: 120,
      totalEstimatedCost: 0.001,
      errorCount: 0,
      errorRate: 0,
      cacheHits: 2,
      cacheMisses: 3,
      cacheBypasses: 7,
      cacheEligibleRequests: 5,
      cacheHitRate: 0.4,
      byEndpoint: [],
      byModel: [],
    });

    expect(parsed.cacheEligibleRequests).toBe(5);
    expect(parsed.cacheHitRate).toBe(0.4);
  });
});
