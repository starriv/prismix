import { describe, expect, it } from "vitest";

import { normalizeDayCount, parseUsageDays } from "@/server/lib/usage";

describe("normalizeDayCount", () => {
  it("clamps 0 to 1 (not fallback)", () => {
    expect(normalizeDayCount(0)).toBe(1);
  });

  it("clamps negative values to 1", () => {
    expect(normalizeDayCount(-5)).toBe(1);
  });

  it("returns 1 at the lower boundary", () => {
    expect(normalizeDayCount(1)).toBe(1);
  });

  it("returns 90 at the upper boundary", () => {
    expect(normalizeDayCount(90)).toBe(90);
  });

  it("clamps 100 to 90", () => {
    expect(normalizeDayCount(100)).toBe(90);
  });

  it("clamps 365 to 90", () => {
    expect(normalizeDayCount(365)).toBe(90);
  });

  it("falls back to 30 for NaN", () => {
    expect(normalizeDayCount(NaN)).toBe(30);
  });

  it("falls back to 30 for Infinity", () => {
    expect(normalizeDayCount(Infinity)).toBe(30);
  });

  it("falls back to 30 for -Infinity", () => {
    expect(normalizeDayCount(-Infinity)).toBe(30);
  });

  it("truncates 7.9 to 7 then clamps", () => {
    expect(normalizeDayCount(7.9)).toBe(7);
  });

  it("truncates -3.7 to -3 then clamps to 1", () => {
    expect(normalizeDayCount(-3.7)).toBe(1);
  });

  it("uses default fallback 30 when value is non-finite and no fallback arg passed", () => {
    expect(normalizeDayCount(NaN)).toBe(30);
  });

  it("uses custom fallback for non-finite input", () => {
    expect(normalizeDayCount(NaN, 7)).toBe(7);
  });

  it("ignores custom fallback when value is finite", () => {
    expect(normalizeDayCount(5, 7)).toBe(5);
  });
});

describe("parseUsageDays", () => {
  it("falls back to 30 for null", () => {
    expect(parseUsageDays(null)).toBe(30);
  });

  it("falls back to 30 for undefined", () => {
    expect(parseUsageDays(undefined)).toBe(30);
  });

  it('falls back to 30 for empty string "" (not 1)', () => {
    expect(parseUsageDays("")).toBe(30);
  });

  it('clamps "0" to 1', () => {
    expect(parseUsageDays("0")).toBe(1);
  });

  it('clamps "-5" to 1', () => {
    expect(parseUsageDays("-5")).toBe(1);
  });

  it('returns 1 for "1"', () => {
    expect(parseUsageDays("1")).toBe(1);
  });

  it('returns 90 for "90"', () => {
    expect(parseUsageDays("90")).toBe(90);
  });

  it('clamps "100" to 90', () => {
    expect(parseUsageDays("100")).toBe(90);
  });

  it('clamps "365" to 90', () => {
    expect(parseUsageDays("365")).toBe(90);
  });

  it('falls back to 30 for non-numeric string "abc"', () => {
    expect(parseUsageDays("abc")).toBe(30);
  });

  it('truncates "7.9" to 7', () => {
    expect(parseUsageDays("7.9")).toBe(7);
  });

  it('treats whitespace " " as 0 (Number(" ")===0) and clamps to 1', () => {
    expect(parseUsageDays(" ")).toBe(1);
  });

  it("uses custom fallback for null", () => {
    expect(parseUsageDays(null, 7)).toBe(7);
  });

  it("uses custom fallback for empty string", () => {
    expect(parseUsageDays("", 7)).toBe(7);
  });

  it("uses custom fallback for non-finite parsed value", () => {
    expect(parseUsageDays("abc", 7)).toBe(7);
  });

  it("ignores custom fallback for a valid value", () => {
    expect(parseUsageDays("5", 7)).toBe(5);
  });
});
