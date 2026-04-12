import BigNumber from "bignumber.js";
import { describe, expect, it } from "vitest";

import {
  gt,
  gte,
  lt,
  lte,
  removeTailingZero,
  safeDividedBy,
  safeMinus,
  safeMultipliedBy,
  safePlus,
  toBig,
} from "@/shared/number";
import type { NumInput } from "@/shared/number";

describe("removeTailingZero", () => {
  it("strips trailing zeros", () => {
    expect(removeTailingZero("1.5000")).toBe("1.5");
    expect(removeTailingZero("0.0200")).toBe("0.02");
    expect(removeTailingZero("100.00")).toBe("100");
  });

  it("handles integer input", () => {
    expect(removeTailingZero(42)).toBe("42");
    expect(removeTailingZero("42")).toBe("42");
  });

  it("respects precision parameter", () => {
    expect(removeTailingZero("1.23456789", 4)).toBe("1.2345"); // ROUND_DOWN truncates
  });

  it("handles nil/NaN gracefully", () => {
    expect(removeTailingZero("--")).toBe("--");
    expect(removeTailingZero(null as unknown as NumInput)).toBe("--");
    expect(removeTailingZero(undefined as unknown as NumInput)).toBe("--");
    expect(removeTailingZero(NaN)).toBe("--");
    expect(removeTailingZero("abc")).toBe("--");
  });

  it("returns '--' when isNilExpression is true", () => {
    expect(removeTailingZero("1.5", 8, true)).toBe("--");
  });

  it("appends unit string", () => {
    expect(removeTailingZero("1.5", 8, false, " USDC")).toBe("1.5 USDC");
  });

  it("handles negative numbers", () => {
    expect(removeTailingZero("-1.5000")).toBe("-1.5");
    expect(removeTailingZero("-0.0200")).toBe("-0.02");
  });

  it("handles very small decimals without scientific notation", () => {
    expect(removeTailingZero("0.00000001")).toBe("0.00000001");
    expect(removeTailingZero("0.000000010000")).toBe("0.00000001");
    expect(removeTailingZero("0.001", 4)).toBe("0.001");
    expect(removeTailingZero("0.00000001", 6)).toBe("0");
  });

  it("handles very large numbers", () => {
    expect(removeTailingZero("99999999999999999999")).toBe("99999999999999999999");
  });

  it("uses custom rounding mode", () => {
    // ROUND_UP should round 1.23451 with precision=4 to 1.2346
    expect(removeTailingZero("1.23451", 4, false, "", BigNumber.ROUND_UP)).toBe("1.2346");
  });

  it("zero stays as zero", () => {
    expect(removeTailingZero("0.000")).toBe("0");
    expect(removeTailingZero(0)).toBe("0");
  });
});

describe("safe arithmetic", () => {
  it("safePlus adds correctly", () => {
    expect(safePlus("1.1", "2.2")).toBe("3.3");
    expect(safePlus("0.1", "0.2")).toBe("0.3"); // no float imprecision
  });

  it("safePlus with negative numbers", () => {
    expect(safePlus("-1", "2")).toBe("1");
    expect(safePlus("-1.5", "-2.5")).toBe("-4");
  });

  it("safeMinus subtracts correctly", () => {
    expect(safeMinus("3", "1.5")).toBe("1.5");
    expect(safeMinus("1", "3")).toBe("-2");
  });

  it("safeMultipliedBy multiplies correctly", () => {
    expect(safeMultipliedBy("2", "0.5")).toBe("1");
    expect(safeMultipliedBy("-3", "4")).toBe("-12");
  });

  it("safeDividedBy divides correctly", () => {
    expect(safeDividedBy("10", "4")).toBe("2.5");
    expect(safeDividedBy("-10", "4")).toBe("-2.5");
  });

  it("safeDividedBy handles division by zero", () => {
    // BigNumber returns Infinity
    expect(safeDividedBy("10", "0")).toBe("Infinity");
    expect(safeDividedBy("-10", "0")).toBe("-Infinity");
  });

  it("handles very large numbers (beyond JS safe integer)", () => {
    const big = "9007199254740993"; // Number.MAX_SAFE_INTEGER + 2
    expect(safePlus(big, "1")).toBe("9007199254740994");
    expect(safeMinus(big, "1")).toBe("9007199254740992");
  });

  it("throws on invalid input (BigNumber strict mode)", () => {
    // BigNumber throws on non-numeric strings rather than returning NaN
    expect(() => safePlus("abc", "1")).toThrow();
    expect(() => safeMinus("abc", "1")).toThrow();
    expect(() => safeMultipliedBy("abc", "1")).toThrow();
    expect(() => safeDividedBy("abc", "1")).toThrow();
  });
});

describe("comparisons", () => {
  it("gt", () => {
    expect(gt("1.5", "1")).toBe(true);
    expect(gt("1", "1")).toBe(false);
    expect(gt("-1", "0")).toBe(false);
  });

  it("gte", () => {
    expect(gte("1", "1")).toBe(true);
    expect(gte("0.9", "1")).toBe(false);
    expect(gte("1.0001", "1")).toBe(true);
  });

  it("lt", () => {
    expect(lt("0.5", "1")).toBe(true);
    expect(lt("1", "1")).toBe(false);
    expect(lt("-2", "-1")).toBe(true);
  });

  it("lte", () => {
    expect(lte("1", "1")).toBe(true);
    expect(lte("1.1", "1")).toBe(false);
    expect(lte("-1", "0")).toBe(true);
  });

  it("comparisons with very small differences", () => {
    expect(gt("0.00000002", "0.00000001")).toBe(true);
    expect(lt("0.00000001", "0.00000002")).toBe(true);
  });
});

describe("toBig", () => {
  it("creates BigNumber from string", () => {
    const b = toBig("1.5");
    expect(b.toString()).toBe("1.5");
  });

  it("creates BigNumber from number", () => {
    const b = toBig(42);
    expect(b.toNumber()).toBe(42);
  });

  it("creates BigNumber from another BigNumber", () => {
    const a = toBig("3.14");
    const b = toBig(a);
    expect(b.toString()).toBe("3.14");
  });

  it("NaN input produces NaN BigNumber", () => {
    expect(toBig(NaN).isNaN()).toBe(true);
  });
});
