/**
 * Key Provider Revenue Share — unit tests.
 *
 * Tests the revenue share calculation logic used in the async write handler.
 */
import { describe, expect, it } from "vitest";

import { gt, removeTailingZero, safeMinus, safeMultipliedBy } from "@/shared/number";

// ── Revenue share calculation (mirrors the logic in ai/index.ts) ──────

function calculateRevenueShare(
  consumerCost: string,
  upstreamCost: string,
  revenueSharePercent: number,
): { platformProfit: string; providerShare: string } {
  const platformProfit = safeMinus(consumerCost, upstreamCost);
  const providerShare = gt(platformProfit, "0")
    ? removeTailingZero(safeMultipliedBy(platformProfit, revenueSharePercent / 100), 6)
    : "0";
  return { platformProfit, providerShare };
}

describe("revenue share calculation", () => {
  it("calculates 70% share of markup profit", () => {
    // upstream: $0.002, consumer: $0.003 (50% markup)
    const result = calculateRevenueShare("0.003", "0.002", 70);
    expect(result.platformProfit).toBe("0.001");
    expect(result.providerShare).toBe("0.0007");
  });

  it("calculates 50% share", () => {
    const result = calculateRevenueShare("0.010", "0.005", 50);
    expect(result.platformProfit).toBe("0.005");
    expect(result.providerShare).toBe("0.0025");
  });

  it("calculates 100% share — all profit goes to provider", () => {
    const result = calculateRevenueShare("0.010", "0.005", 100);
    expect(result.platformProfit).toBe("0.005");
    expect(result.providerShare).toBe("0.005");
  });

  it("calculates 0% share — platform keeps all profit", () => {
    const result = calculateRevenueShare("0.010", "0.005", 0);
    expect(result.platformProfit).toBe("0.005");
    expect(result.providerShare).toBe("0");
  });

  it("returns zero share when consumerCost equals upstreamCost (0% markup)", () => {
    const result = calculateRevenueShare("0.005", "0.005", 70);
    expect(result.platformProfit).toBe("0");
    expect(result.providerShare).toBe("0");
  });

  it("handles larger amounts", () => {
    // $10 upstream, $15 consumer (50% markup), 70% share
    const result = calculateRevenueShare("15", "10", 70);
    expect(result.platformProfit).toBe("5");
    expect(result.providerShare).toBe("3.5");
  });

  it("handles very small amounts with precision", () => {
    // $0.0002 upstream, $0.0003 consumer
    const result = calculateRevenueShare("0.0003", "0.0002", 70);
    expect(result.platformProfit).toBe("0.0001");
    expect(result.providerShare).toBe("0.00007");
  });
});
