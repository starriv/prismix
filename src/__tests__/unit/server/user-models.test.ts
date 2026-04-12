/**
 * User Models Catalog — unit tests for ACL union, markup resolution, and consumer pricing.
 *
 * Tests the pure logic extracted from GET /api/user/models endpoint.
 */
import { describe, expect, it } from "vitest";

import { removeTailingZero, safeMultipliedBy } from "@/shared/number";

// ── ACL Union Logic ─────────────────────────────────────────────────

function isModelAllowed(modelId: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("*") ? modelId.startsWith(pattern.slice(0, -1)) : modelId === pattern,
  );
}

/** Compute unified ACL from multiple keys' allowedModels lists. */
function buildUnifiedAcl(keyAcls: string[][]): { hasOpenAccess: boolean; patterns: string[] } {
  if (keyAcls.length === 0) return { hasOpenAccess: true, patterns: [] };

  const allPatterns: string[] = [];
  for (const models of keyAcls) {
    if (models.length === 0) return { hasOpenAccess: true, patterns: [] };
    allPatterns.push(...models);
  }
  return { hasOpenAccess: false, patterns: [...new Set(allPatterns)] };
}

describe("ACL union across keys", () => {
  it("returns open access when no keys exist", () => {
    const result = buildUnifiedAcl([]);
    expect(result.hasOpenAccess).toBe(true);
  });

  it("returns open access when any key has empty ACL", () => {
    const result = buildUnifiedAcl([["gpt-4o"], []]);
    expect(result.hasOpenAccess).toBe(true);
  });

  it("merges patterns from multiple keys", () => {
    const result = buildUnifiedAcl([["gpt-*"], ["claude-*"]]);
    expect(result.hasOpenAccess).toBe(false);
    expect(result.patterns).toEqual(["gpt-*", "claude-*"]);
  });

  it("deduplicates patterns", () => {
    const result = buildUnifiedAcl([["gpt-4o", "claude-*"], ["gpt-4o"]]);
    expect(result.hasOpenAccess).toBe(false);
    expect(result.patterns).toEqual(["gpt-4o", "claude-*"]);
  });

  it("filters models by unified patterns", () => {
    const { patterns } = buildUnifiedAcl([["gpt-*"], ["claude-sonnet-4-20250514"]]);
    expect(isModelAllowed("gpt-4o", patterns)).toBe(true);
    expect(isModelAllowed("gpt-4o-mini", patterns)).toBe(true);
    expect(isModelAllowed("claude-sonnet-4-20250514", patterns)).toBe(true);
    expect(isModelAllowed("claude-opus-4-20250514", patterns)).toBe(false);
    expect(isModelAllowed("gemini-2.5-flash", patterns)).toBe(false);
  });
});

// ── Markup Resolution ───────────────────────────────────────────────

describe("effective markup resolution", () => {
  function resolveMarkup(
    keyMarkups: Array<{ keyMarkup: number | null; agentMarkup: number | null }>,
    globalDefault: number,
  ): number {
    if (keyMarkups.length === 0) return globalDefault;

    const resolved = keyMarkups.map(
      ({ keyMarkup, agentMarkup }) => keyMarkup ?? agentMarkup ?? globalDefault,
    );
    return Math.min(...resolved);
  }

  it("returns global default when no keys", () => {
    expect(resolveMarkup([], 20)).toBe(20);
  });

  it("uses key-level markup when set", () => {
    expect(resolveMarkup([{ keyMarkup: 10, agentMarkup: 30 }], 20)).toBe(10);
  });

  it("falls back to agent markup", () => {
    expect(resolveMarkup([{ keyMarkup: null, agentMarkup: 15 }], 20)).toBe(15);
  });

  it("falls back to global default", () => {
    expect(resolveMarkup([{ keyMarkup: null, agentMarkup: null }], 20)).toBe(20);
  });

  it("takes minimum across multiple keys", () => {
    expect(
      resolveMarkup(
        [
          { keyMarkup: 30, agentMarkup: null },
          { keyMarkup: 10, agentMarkup: null },
          { keyMarkup: null, agentMarkup: 25 },
        ],
        20,
      ),
    ).toBe(10);
  });
});

// ── Consumer Price Calculation ──────────────────────────────────────

describe("consumer price calculation", () => {
  function consumerPrice(basePrice: string, markupPercent: number): string {
    const multiplier = 1 + markupPercent / 100;
    return removeTailingZero(safeMultipliedBy(basePrice, multiplier), 6);
  }

  it("returns base price with 0% markup", () => {
    expect(consumerPrice("2.50", 0)).toBe("2.5");
  });

  it("applies 20% markup", () => {
    expect(consumerPrice("10.00", 20)).toBe("12");
  });

  it("applies 50% markup", () => {
    expect(consumerPrice("2.50", 50)).toBe("3.75");
  });

  it("handles zero price", () => {
    expect(consumerPrice("0", 20)).toBe("0");
  });

  it("handles small fractional prices", () => {
    expect(consumerPrice("0.15", 10)).toBe("0.165");
  });
});
