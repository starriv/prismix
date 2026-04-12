import { describe, expect, it } from "vitest";

import { validateCustomHeaders } from "@/shared/http-headers";

describe("validateCustomHeaders", () => {
  // ── Valid inputs ──────────────────────────────────────────────
  it("accepts null/undefined as valid empty", () => {
    expect(validateCustomHeaders(null)).toEqual({ valid: true, headers: {} });
    expect(validateCustomHeaders(undefined)).toEqual({ valid: true, headers: {} });
  });

  it("accepts a valid headers object", () => {
    const result = validateCustomHeaders({ "X-Custom": "value", Accept: "text/html" });
    expect(result.valid).toBe(true);
    expect(result.headers).toEqual({ "X-Custom": "value", Accept: "text/html" });
  });

  it("trims header names and values", () => {
    const result = validateCustomHeaders({ "  X-Foo  ": "  bar  " });
    expect(result.valid).toBe(true);
    expect(result.headers).toEqual({ "X-Foo": "bar" });
  });

  it("accepts exactly 20 headers (boundary)", () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 20; i++) obj[`X-Header-${i}`] = "v";
    const result = validateCustomHeaders(obj);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.headers!)).toHaveLength(20);
  });

  it("allows HTAB in header values", () => {
    const result = validateCustomHeaders({ "X-Foo": "val\tue" });
    expect(result.valid).toBe(true);
    expect(result.headers!["X-Foo"]).toBe("val\tue");
  });

  // ── Invalid inputs ────────────────────────────────────────────
  it("rejects non-object input", () => {
    expect(validateCustomHeaders("string").valid).toBe(false);
    expect(validateCustomHeaders(42).valid).toBe(false);
    expect(validateCustomHeaders([]).valid).toBe(false);
  });

  it("rejects 21 headers (exceeds max 20)", () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 21; i++) obj[`X-Header-${i}`] = "v";
    const result = validateCustomHeaders(obj);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Too many");
  });

  it("rejects empty header name", () => {
    expect(validateCustomHeaders({ "": "value" }).valid).toBe(false);
  });

  it("rejects header name exceeding 128 chars", () => {
    const longName = "X-" + "a".repeat(128);
    expect(validateCustomHeaders({ [longName]: "v" }).valid).toBe(false);
  });

  it("rejects invalid characters in header name", () => {
    expect(validateCustomHeaders({ "X-Foo Bar": "v" }).valid).toBe(false); // space
  });

  it("rejects all 11 forbidden headers", () => {
    const forbidden = [
      "Host",
      "Content-Length",
      "Transfer-Encoding",
      "Connection",
      "Via",
      "Upgrade",
      "Keep-Alive",
      "TE",
      "Trailer",
      "Proxy-Authorization",
      "Proxy-Authenticate",
    ];
    for (const h of forbidden) {
      const result = validateCustomHeaders({ [h]: "v" });
      expect(result.valid, `${h} should be forbidden`).toBe(false);
      expect(result.error).toContain("reserved");
    }
  });

  it("rejects non-string values", () => {
    const result = validateCustomHeaders({ "X-Foo": 123 as unknown });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("string");
  });

  it("rejects values exceeding 4096 chars", () => {
    const result = validateCustomHeaders({ "X-Foo": "a".repeat(5000) });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("4096");
  });

  it("rejects control characters in values", () => {
    expect(validateCustomHeaders({ "X-Foo": "val\x00ue" }).valid).toBe(false);
    expect(validateCustomHeaders({ "X-Foo": "val\nue" }).valid).toBe(false);
  });
});
