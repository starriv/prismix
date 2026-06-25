import { describe, expect, it } from "vitest";

import { parseIntParam, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";

describe("parseIntParam", () => {
  it("returns null for undefined", () => {
    expect(parseIntParam(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseIntParam("")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseIntParam("abc")).toBeNull();
    expect(parseIntParam("12abc")).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(parseIntParam("NaN")).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(parseIntParam("Infinity")).toBeNull();
  });

  it("returns null for negative numbers", () => {
    expect(parseIntParam("-1")).toBeNull();
    expect(parseIntParam("-100")).toBeNull();
  });

  it("returns null for floating point numbers", () => {
    expect(parseIntParam("1.5")).toBeNull();
    expect(parseIntParam("3.14")).toBeNull();
  });

  it("parses valid positive integers", () => {
    expect(parseIntParam("0")).toBe(0);
    expect(parseIntParam("1")).toBe(1);
    expect(parseIntParam("42")).toBe(42);
    expect(parseIntParam("1000")).toBe(1000);
  });
});

describe("parsePaginationLimit", () => {
  it("returns default (10) for undefined", () => {
    expect(parsePaginationLimit(undefined)).toBe(10);
  });

  it("returns default for invalid input", () => {
    expect(parsePaginationLimit("abc")).toBe(10);
    expect(parsePaginationLimit("-1")).toBe(10);
  });

  it("caps at max (100) for large values", () => {
    expect(parsePaginationLimit("999")).toBe(100);
    expect(parsePaginationLimit("999999")).toBe(100);
  });

  it("returns exact value within range", () => {
    expect(parsePaginationLimit("10")).toBe(10);
    expect(parsePaginationLimit("50")).toBe(50);
    expect(parsePaginationLimit("100")).toBe(100);
  });

  it("supports custom default and max", () => {
    expect(parsePaginationLimit(undefined, 20, 100)).toBe(20);
    expect(parsePaginationLimit("150", 20, 100)).toBe(100);
    expect(parsePaginationLimit("50", 20, 100)).toBe(50);
  });
});

describe("parsePaginationOffset", () => {
  it("returns 0 for undefined", () => {
    expect(parsePaginationOffset(undefined)).toBe(0);
  });

  it("returns 0 for invalid input", () => {
    expect(parsePaginationOffset("abc")).toBe(0);
    expect(parsePaginationOffset("-5")).toBe(0);
  });

  it("returns exact value for valid input", () => {
    expect(parsePaginationOffset("0")).toBe(0);
    expect(parsePaginationOffset("10")).toBe(10);
    expect(parsePaginationOffset("100")).toBe(100);
  });
});
