import { describe, expect, it } from "vitest";

import { validateCorsConfig } from "@/shared/cors";

describe("validateCorsConfig", () => {
  // ── Valid inputs ──────────────────────────────────────────────
  it("accepts null/undefined as empty origins", () => {
    expect(validateCorsConfig(null)).toEqual({ valid: true, config: { origins: [] } });
    expect(validateCorsConfig(undefined)).toEqual({ valid: true, config: { origins: [] } });
  });

  it("accepts wildcard origin", () => {
    const r = validateCorsConfig({ origins: ["*"] });
    expect(r.valid).toBe(true);
    expect(r.config?.origins).toEqual(["*"]);
  });

  it("accepts valid https origins", () => {
    const r = validateCorsConfig({ origins: ["https://example.com", "https://app.example.com"] });
    expect(r.valid).toBe(true);
    expect(r.config?.origins).toHaveLength(2);
  });

  it("accepts http origins (not just https)", () => {
    const r = validateCorsConfig({ origins: ["http://localhost:3000"] });
    expect(r.valid).toBe(true);
    expect(r.config?.origins).toEqual(["http://localhost:3000"]);
  });

  it("accepts full config with all fields", () => {
    const r = validateCorsConfig({
      origins: ["https://a.com"],
      methods: ["GET", "POST"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["X-Request-ID"],
      maxAge: 3600,
      credentials: true,
    });
    expect(r.valid).toBe(true);
    expect(r.config?.credentials).toBe(true);
    expect(r.config?.maxAge).toBe(3600);
    expect(r.config?.allowHeaders).toEqual(["Content-Type"]);
    expect(r.config?.exposeHeaders).toEqual(["X-Request-ID"]);
  });

  it("accepts exactly 20 origins (boundary)", () => {
    const origins = Array.from({ length: 20 }, (_, i) => `https://o${i}.com`);
    const r = validateCorsConfig({ origins });
    expect(r.valid).toBe(true);
    expect(r.config?.origins).toHaveLength(20);
  });

  it("accepts maxAge at boundary values", () => {
    expect(validateCorsConfig({ origins: ["*"], maxAge: 0 }).valid).toBe(true);
    expect(validateCorsConfig({ origins: ["*"], maxAge: 604800 }).valid).toBe(true); // 7 days
  });

  // ── Invalid inputs ────────────────────────────────────────────
  it("rejects non-object input", () => {
    const r1 = validateCorsConfig("string");
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain("JSON object");

    const r2 = validateCorsConfig([]);
    expect(r2.valid).toBe(false);
    expect(r2.error).toContain("JSON object");
  });

  it("rejects non-array origins", () => {
    const r = validateCorsConfig({ origins: "*" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("array");
  });

  it("rejects too many origins (21 exceeds max 20)", () => {
    const origins = Array.from({ length: 21 }, (_, i) => `https://o${i}.com`);
    const r = validateCorsConfig({ origins });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Too many origins");
  });

  it("rejects empty origin string", () => {
    const r = validateCorsConfig({ origins: [""] });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("non-empty string");
  });

  it("rejects non-http origin", () => {
    const r = validateCorsConfig({ origins: ["ftp://x.com"] });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("http");
  });

  it("rejects invalid URL as origin", () => {
    const r = validateCorsConfig({ origins: ["not-a-url"] });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("valid URL");
  });

  it("rejects invalid methods", () => {
    const r = validateCorsConfig({ origins: ["*"], methods: ["HACK"] });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Invalid method");
  });

  it("rejects non-array methods", () => {
    const r = validateCorsConfig({ origins: ["*"], methods: "GET" as unknown });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("methods must be an array");
  });

  it("rejects maxAge out of range", () => {
    const r1 = validateCorsConfig({ origins: ["*"], maxAge: -1 });
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain("maxAge");

    const r2 = validateCorsConfig({ origins: ["*"], maxAge: 604801 }); // 7 days + 1
    expect(r2.valid).toBe(false);
    expect(r2.error).toContain("maxAge");
  });

  it("rejects non-boolean credentials", () => {
    const r = validateCorsConfig({ origins: ["*"], credentials: "yes" as unknown });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("credentials must be a boolean");
  });

  it("rejects non-array allowHeaders", () => {
    const r = validateCorsConfig({ origins: ["*"], allowHeaders: "Content-Type" as unknown });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("allowHeaders must be an array");
  });

  it("rejects non-string entries in exposeHeaders", () => {
    const r = validateCorsConfig({ origins: ["*"], exposeHeaders: [123 as unknown] });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("exposeHeaders entries must be strings");
  });
});
