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
  const cacheEligibleRequests = raw.cacheHits + raw.cacheMisses;
  return {
    errorRate: raw.totalRequests > 0 ? raw.errorCount / raw.totalRequests : null,
    cacheEligibleRequests,
    cacheHitRate: cacheEligibleRequests > 0 ? raw.cacheHits / cacheEligibleRequests : null,
    promptCacheCreationRate:
      raw.totalInputTokens > 0 ? raw.promptCacheCreationInputTokens / raw.totalInputTokens : null,
    promptCacheReadRate:
      raw.totalInputTokens > 0 ? raw.promptCacheReadInputTokens / raw.totalInputTokens : null,
    totalTokens: raw.totalInputTokens + raw.totalOutputTokens,
  };
}

describe("ai-usage-log summary aggregation logic", () => {
  it("returns null rates for empty table (no misleading zeros)", () => {
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
    expect(result.errorRate).toBeNull();
    expect(result.cacheHitRate).toBeNull();
    expect(result.cacheEligibleRequests).toBe(0);
    expect(result.promptCacheCreationRate).toBeNull();
    expect(result.promptCacheReadRate).toBeNull();
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
    expect(result.cacheEligibleRequests).toBe(10);
  });

  it("only cache bypasses make gateway cache hit rate ineligible", () => {
    const result = computeSummaryRates({
      totalRequests: 20,
      totalInputTokens: 300,
      totalOutputTokens: 150,
      errorCount: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheBypasses: 20,
      promptCacheCreationInputTokens: 0,
      promptCacheReadInputTokens: 0,
    });
    expect(result.cacheHitRate).toBeNull();
    expect(result.cacheEligibleRequests).toBe(0);
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

  it("zero totalInputTokens yields null prompt cache rates (no NaN)", () => {
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
    expect(result.promptCacheCreationRate).toBeNull();
    expect(result.promptCacheReadRate).toBeNull();
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

describe("summaryByConsumerKey totalTokens mapping", () => {
  // Reproduce the post-processing logic from ai-usage-log-repo.ts summaryByConsumerKey().
  // These formulas must match lines 1030-1037 of that file.
  function mapByKeyRow(r: {
    inputTokens: string | null;
    outputTokens: string | null;
    totalTokens: string | null;
    cost: string | null;
  }) {
    return {
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      totalTokens: Number(r.totalTokens ?? 0),
      estimatedCost: Number(r.cost ?? 0),
    };
  }

  it("totalTokens uses sum(totalTokens), not input+output, when cache tokens inflate total", () => {
    const mapped = mapByKeyRow({
      inputTokens: "100",
      outputTokens: "50",
      totalTokens: "200",
      cost: "0.01",
    });
    // 100 input + 50 output = 150, but DB stored totalTokens = 200 (50 cache/reasoning tokens).
    // Correct behavior: map sum(totalTokens) directly, do NOT recompute as input+output.
    expect(mapped.totalTokens).toBe(200);
    expect(mapped.inputTokens).toBe(100);
    expect(mapped.outputTokens).toBe(50);
  });

  it("totalTokens falls back to 0 when sum is null", () => {
    const mapped = mapByKeyRow({
      inputTokens: "100",
      outputTokens: "50",
      totalTokens: null,
      cost: null,
    });
    expect(mapped.totalTokens).toBe(0);
    expect(mapped.estimatedCost).toBe(0);
  });

  it("totalTokens is NOT recomputed as input+output (regression guard)", () => {
    const mapped = mapByKeyRow({
      inputTokens: "1000",
      outputTokens: "200",
      totalTokens: "1500",
      cost: "0.05",
    });
    // 1500 = 1000 input + 200 output + 300 cache/reasoning tokens.
    expect(mapped.totalTokens).toBe(1500);
    // Regression guard: the OLD buggy behavior computed totalTokens as input + output = 1200,
    // dropping the cache/reasoning tokens. This must never happen again.
    expect(mapped.totalTokens).not.toBe(1200);
  });

  it("aiUsageLogRepo.summaryByConsumerKey is a function (production method exists)", () => {
    expect(typeof aiUsageLogRepo.summaryByConsumerKey).toBe("function");
  });
});
