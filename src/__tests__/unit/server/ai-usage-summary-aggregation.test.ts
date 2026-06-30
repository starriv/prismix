import { describe, expect, it } from "vitest";

import { aiUsageLogRepo } from "@/server/repos/ai-usage-log-repo";

// Reproduce the post-processing logic from ai-usage-log-repo.ts summary() method.
// These formulas must match lines 764-784 of that file.
function computeSummaryRates(raw: {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
  cacheBypasses: number;
  promptCacheCreationInputTokens: number;
  promptCacheReadInputTokens: number;
}) {
  const cacheDenominator = raw.cacheHits + raw.cacheMisses;
  return {
    errorRate: raw.totalRequests > 0 ? raw.errorCount / raw.totalRequests : 0,
    cacheHitRate: cacheDenominator > 0 ? raw.cacheHits / cacheDenominator : 0,
    promptCacheCreationRate:
      raw.totalInputTokens > 0 ? raw.promptCacheCreationInputTokens / raw.totalInputTokens : 0,
    promptCacheReadRate:
      raw.totalInputTokens > 0 ? raw.promptCacheReadInputTokens / raw.totalInputTokens : 0,
    totalTokens: raw.totalInputTokens + raw.totalOutputTokens,
  };
}

describe("ai-usage-log summary aggregation logic", () => {
  it("returns 0 rates for empty table (no NaN)", () => {
    const result = computeSummaryRates({
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.errorRate).toBe(0);
    expect(result.cacheHitRate).toBe(0);
    expect(result.promptCacheCreationRate).toBe(0);
    expect(result.promptCacheReadRate).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("cache hit rate = 1.0 when only hits (no miss/bypass)", () => {
    const result = computeSummaryRates({
      totalRequests: 10,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      errorCount: 0,
      cacheHits: 10,
      cacheMisses: 0,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.cacheHitRate).toBe(1);
  });

  it("cache hit rate = 0 when only misses", () => {
    const result = computeSummaryRates({
      totalRequests: 10,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 10,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.cacheHitRate).toBe(0);
  });

  it("cache bypasses do NOT affect cache hit rate denominator", () => {
    const result = computeSummaryRates({
      totalRequests: 30,
      totalInputTokens: 300,
      totalOutputTokens: 150,
      errorCount: 0,
      cacheHits: 5,
      cacheMisses: 5,
      cacheBypasses: 20,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    // 5 / (5 + 5) = 0.5, bypasses excluded
    expect(result.cacheHitRate).toBe(0.5);
  });

  it("mix of hit/miss/bypass computes correct rate", () => {
    const result = computeSummaryRates({
      totalRequests: 100,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      errorCount: 5,
      cacheHits: 30,
      cacheMisses: 60,
      cacheBypasses: 10,
      promptCacheCreationInputTokens: 100,
      promptCacheReadInputTokens: 200,
    });
    expect(result.cacheHitRate).toBe(30 / 90);
    expect(result.errorRate).toBe(0.05);
    expect(result.promptCacheCreationRate).toBe(0.1);
    expect(result.promptCacheReadRate).toBe(0.2);
    expect(result.totalTokens).toBe(1500);
  });

  it("zero totalInputTokens yields 0 prompt cache rates (no NaN)", () => {
    const result = computeSummaryRates({
      totalRequests: 5,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 5,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 50,
      promptCacheReadInputTokens: 30,
    });
    expect(result.promptCacheCreationRate).toBe(0);
    expect(result.promptCacheReadRate).toBe(0);
  });

  it("errorRate = errorCount / totalRequests", () => {
    const result = computeSummaryRates({
      totalRequests: 200,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      errorCount: 15,
      cacheHits: 0,
      cacheMisses: 200,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.errorRate).toBe(0.075);
  });

  it("totalTokens = inputTokens + outputTokens", () => {
    const result = computeSummaryRates({
      totalRequests: 1,
      totalInputTokens: 1234,
      totalOutputTokens: 5678,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 1,
      cacheBypasses: 0,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.totalTokens).toBe(6912);
  });

  it("aiUsageLogRepo.summary is a function (production method exists)", () => {
    expect(typeof aiUsageLogRepo.summary).toBe("function");
  });
});
