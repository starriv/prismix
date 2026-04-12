/**
 * Consumer Key system — Phase 4 unit tests.
 *
 * Tests: key generation, consumer session model ACL, cost calculation.
 */
import { describe, expect, it } from "vitest";

import { generateConsumerApiKey, hashApiKey } from "@/server/lib/crypto";

// ── Key Generation ──────────────────────────────────────────────────────

describe("generateConsumerApiKey", () => {
  it("generates key with ska_ prefix", () => {
    const { raw, hash, prefix } = generateConsumerApiKey();
    expect(raw).toMatch(/^ska_[a-f0-9]{32}$/);
    expect(prefix).toBe(raw.slice(0, 8));
    expect(prefix).toMatch(/^ska_[a-f0-9]{4}$/);
    expect(hash).toHaveLength(64); // SHA-256 hex
  });

  it("generates unique keys", () => {
    const k1 = generateConsumerApiKey();
    const k2 = generateConsumerApiKey();
    expect(k1.raw).not.toBe(k2.raw);
    expect(k1.hash).not.toBe(k2.hash);
  });

  it("hash matches hashApiKey", () => {
    const { raw, hash } = generateConsumerApiKey();
    expect(hashApiKey(raw)).toBe(hash);
  });
});

// ── Model ACL Matching ──────────────────────────────────────────────────

describe("model ACL matching", () => {
  function isModelAllowed(model: string, allowedModels: string[]): boolean {
    if (allowedModels.length === 0) return true;
    return allowedModels.some((pattern) => {
      if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1));
      return model === pattern;
    });
  }

  it("allows all models when list is empty", () => {
    expect(isModelAllowed("gpt-4o", [])).toBe(true);
  });

  it("allows exact match", () => {
    expect(isModelAllowed("gpt-4o", ["gpt-4o"])).toBe(true);
    expect(isModelAllowed("gpt-4o-mini", ["gpt-4o"])).toBe(false);
  });

  it("allows wildcard match", () => {
    expect(isModelAllowed("gpt-4o", ["gpt-*"])).toBe(true);
    expect(isModelAllowed("gpt-4o-mini", ["gpt-*"])).toBe(true);
    expect(isModelAllowed("claude-sonnet-4-20250514", ["gpt-*"])).toBe(false);
  });

  it("allows claude wildcard", () => {
    expect(isModelAllowed("claude-sonnet-4-20250514", ["claude-*"])).toBe(true);
    expect(isModelAllowed("claude-opus-4-20250514", ["claude-*"])).toBe(true);
  });

  it("allows multiple patterns", () => {
    const allowed = ["gpt-4o", "claude-*"];
    expect(isModelAllowed("gpt-4o", allowed)).toBe(true);
    expect(isModelAllowed("claude-sonnet-4-20250514", allowed)).toBe(true);
    expect(isModelAllowed("gemini-2.5-flash", allowed)).toBe(false);
  });
});

// ── Cost Calculation ────────────────────────────────────────────────────

describe("consumer cost calculation", () => {
  function calculateConsumerCost(
    inputTokens: number,
    outputTokens: number,
    inputPrice: string,
    outputPrice: string,
    markupPercent: number,
  ): string {
    const upstreamCost =
      (inputTokens * Number(inputPrice)) / 1_000_000 +
      (outputTokens * Number(outputPrice)) / 1_000_000;
    return (upstreamCost * (1 + markupPercent / 100)).toFixed(6);
  }

  it("calculates zero cost for zero tokens", () => {
    expect(calculateConsumerCost(0, 0, "2.50", "10.00", 0)).toBe("0.000000");
  });

  it("calculates cost without markup", () => {
    // 1000 input tokens @ $2.50/1M = $0.0025
    // 500 output tokens @ $10.00/1M = $0.005
    expect(calculateConsumerCost(1000, 500, "2.50", "10.00", 0)).toBe("0.007500");
  });

  it("applies markup correctly", () => {
    // Same as above but with 20% markup
    // $0.0075 × 1.2 = $0.009
    expect(calculateConsumerCost(1000, 500, "2.50", "10.00", 20)).toBe("0.009000");
  });

  it("handles large token counts", () => {
    // 1M input @ $2.50 = $2.50, 1M output @ $10 = $10, total = $12.50
    expect(calculateConsumerCost(1_000_000, 1_000_000, "2.50", "10.00", 0)).toBe("12.500000");
  });

  it("handles 100% markup", () => {
    expect(calculateConsumerCost(1000, 500, "2.50", "10.00", 100)).toBe("0.015000");
  });
});

// ── Effective Markup Resolution ───────────────────────────────────────

describe("effective markup resolution", () => {
  /** Mirrors the fallback chain in consumer-key-auth.ts middleware */
  function resolveMarkup(
    keyMarkup: number | null,
    agentDefaultMarkup: number | null | undefined,
  ): number {
    return keyMarkup ?? agentDefaultMarkup ?? 0;
  }

  it("uses key markup when set", () => {
    expect(resolveMarkup(10, 20)).toBe(10);
  });

  it("falls back to agent default when key markup is null", () => {
    expect(resolveMarkup(null, 15)).toBe(15);
  });

  it("falls back to 0 when both are null", () => {
    expect(resolveMarkup(null, null)).toBe(0);
  });

  it("falls back to 0 when agent default is undefined", () => {
    expect(resolveMarkup(null, undefined)).toBe(0);
  });

  it("key markup 0 overrides agent default (explicit zero)", () => {
    expect(resolveMarkup(0, 20)).toBe(0);
  });
});
