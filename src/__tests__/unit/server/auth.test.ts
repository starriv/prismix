import { describe, expect, it, vi } from "vitest";

import {
  buildSiweMessage,
  consumeNonce,
  createNonce,
  getNonceCount,
} from "@/server/middleware/auth";

describe("nonce system", () => {
  const ADDR = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

  it("creates and consumes a nonce", () => {
    const nonce = createNonce(ADDR);
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBe(32); // 16 bytes hex

    const consumed = consumeNonce(ADDR);
    expect(consumed).toBe(nonce);
  });

  it("nonce is single-use (second consume returns null)", () => {
    createNonce(ADDR);
    consumeNonce(ADDR);
    expect(consumeNonce(ADDR)).toBeNull();
  });

  it("returns null for unknown address", () => {
    expect(consumeNonce("0x0000000000000000000000000000000000000000")).toBeNull();
  });

  it("is case-insensitive on address", () => {
    const nonce = createNonce(ADDR.toLowerCase());
    expect(consumeNonce(ADDR.toUpperCase())).toBe(nonce);
  });

  it("isolates user and admin scopes", () => {
    const userNonce = createNonce(ADDR, "user");
    const adminNonce = createNonce(ADDR, "admin");

    // Cannot consume user nonce with admin scope
    expect(consumeNonce(ADDR, "admin")).toBe(adminNonce);
    expect(consumeNonce(ADDR, "user")).toBe(userNonce);
  });

  it("overwrites nonce on re-creation for same address+scope", () => {
    const nonce1 = createNonce(ADDR);
    const nonce2 = createNonce(ADDR);
    expect(nonce1).not.toBe(nonce2);
    // Only the second nonce is valid
    expect(consumeNonce(ADDR)).toBe(nonce2);
    // First nonce is gone
    expect(consumeNonce(ADDR)).toBeNull();
  });

  it("expires after TTL", () => {
    vi.useFakeTimers();
    createNonce(ADDR);
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes > 5 min TTL
    expect(consumeNonce(ADDR)).toBeNull();
    vi.useRealTimers();
  });

  it("is valid just before TTL", () => {
    vi.useFakeTimers();
    const nonce = createNonce(ADDR);
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes < 5 min TTL
    expect(consumeNonce(ADDR)).toBe(nonce);
    vi.useRealTimers();
  });

  it("getNonceCount tracks active nonces", () => {
    const before = getNonceCount();
    createNonce("0x1111111111111111111111111111111111111111");
    expect(getNonceCount()).toBe(before + 1);
    consumeNonce("0x1111111111111111111111111111111111111111");
    expect(getNonceCount()).toBe(before);
  });
});

describe("buildSiweMessage (EIP-4361)", () => {
  const TEST_ORIGIN = "https://test.example.com";

  it("includes required EIP-4361 fields", () => {
    const msg = buildSiweMessage("0xABC", "nonce123", TEST_ORIGIN);
    expect(msg).toContain("wants you to sign in with your Ethereum account:");
    expect(msg).toContain("0xABC");
    expect(msg).toContain("Nonce: nonce123");
    expect(msg).toContain("Version: 1");
    expect(msg).toContain("Chain ID:");
    expect(msg).toContain("URI:");
    expect(msg).toContain("Issued At:");
  });

  it("includes Prismix statement", () => {
    const msg = buildSiweMessage("0xDEF", "n1", TEST_ORIGIN);
    expect(msg).toContain("Sign in to Prismix");
  });

  it("puts address on the second line per EIP-4361 spec", () => {
    const msg = buildSiweMessage("0xABC", "n1", TEST_ORIGIN);
    const lines = msg.split("\n");
    expect(lines[1]).toBe("0xABC");
  });

  it("uses request origin for domain and URI when provided", () => {
    const msg = buildSiweMessage("0xABC", "n1", "https://app.example.com");
    expect(msg).toContain("app.example.com wants you to sign in");
    expect(msg).toContain("URI: https://app.example.com");
  });

  it("uses request origin with port for domain and URI", () => {
    const msg = buildSiweMessage("0xABC", "n1", "https://app.example.com:8443");
    expect(msg).toContain("app.example.com wants you to sign in");
    expect(msg).toContain("URI: https://app.example.com:8443");
  });

  it("throws when origin is not provided and no env vars set", () => {
    expect(() => buildSiweMessage("0xABC", "n1")).toThrow("Missing origin");
  });

  it("throws when origin is malformed", () => {
    expect(() => buildSiweMessage("0xABC", "n1", "not-a-valid-url")).toThrow("Invalid origin");
  });

  it("uses CORS_ORIGIN env var when origin is not provided", () => {
    process.env.CORS_ORIGIN = "https://app.example.com";
    try {
      const msg = buildSiweMessage("0xABC", "n1");
      expect(msg).toContain("app.example.com wants you to sign in");
      expect(msg).toContain("URI: https://app.example.com");
    } finally {
      delete process.env.CORS_ORIGIN;
    }
  });

  it("uses DOMAIN env var when origin and CORS_ORIGIN are not provided", () => {
    process.env.DOMAIN = "myapp.io";
    try {
      const msg = buildSiweMessage("0xABC", "n1");
      expect(msg).toContain("myapp.io wants you to sign in");
      expect(msg).toContain("URI: https://myapp.io");
    } finally {
      delete process.env.DOMAIN;
    }
  });
});
