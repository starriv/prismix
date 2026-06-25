import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildSiweMessage,
  consumeNonce,
  createNonce,
  getNonceCount,
} from "@/server/middleware/auth";

const redisMock = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();

  function getLiveValue(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    store,
    redis: {
      async set(key: string, value: string, _mode: "PX", ttlMs: number) {
        store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return "OK";
      },
      async get(key: string) {
        return getLiveValue(key);
      },
      async eval(_script: string, _keyCount: number, key: string) {
        const value = getLiveValue(key);
        store.delete(key);
        return value;
      },
      async del(key: string) {
        const existed = store.delete(key);
        return existed ? 1 : 0;
      },
      async scan(_cursor: string, _match: "MATCH", pattern: string) {
        const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
        const keys = [...store.keys()].filter((key) => key.startsWith(prefix) && getLiveValue(key));
        return ["0", keys] as [string, string[]];
      },
    },
  };
});

vi.mock("@/server/lib/redis", () => ({
  getRedis: () => redisMock.redis,
}));

describe("nonce system", () => {
  const ADDR = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";

  beforeEach(() => {
    redisMock.store.clear();
    vi.useRealTimers();
  });

  it("creates and consumes a nonce", async () => {
    const nonce = await createNonce(ADDR);
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBe(32); // 16 bytes hex

    const consumed = await consumeNonce(ADDR);
    expect(consumed).toBe(nonce);
  });

  it("nonce is single-use (second consume returns null)", async () => {
    await createNonce(ADDR);
    await consumeNonce(ADDR);
    expect(await consumeNonce(ADDR)).toBeNull();
  });

  it("returns null for unknown address", async () => {
    expect(await consumeNonce("0x0000000000000000000000000000000000000000")).toBeNull();
  });

  it("is case-insensitive on address", async () => {
    const nonce = await createNonce(ADDR.toLowerCase());
    expect(await consumeNonce(ADDR.toUpperCase())).toBe(nonce);
  });

  it("isolates user and admin scopes", async () => {
    const userNonce = await createNonce(ADDR, "user");
    const adminNonce = await createNonce(ADDR, "admin");

    // Cannot consume user nonce with admin scope
    expect(await consumeNonce(ADDR, "admin")).toBe(adminNonce);
    expect(await consumeNonce(ADDR, "user")).toBe(userNonce);
  });

  it("overwrites nonce on re-creation for same address+scope", async () => {
    const nonce1 = await createNonce(ADDR);
    const nonce2 = await createNonce(ADDR);
    expect(nonce1).not.toBe(nonce2);
    // Only the second nonce is valid
    expect(await consumeNonce(ADDR)).toBe(nonce2);
    // First nonce is gone
    expect(await consumeNonce(ADDR)).toBeNull();
  });

  it("expires after TTL", async () => {
    vi.useFakeTimers();
    await createNonce(ADDR);
    vi.advanceTimersByTime(6 * 60 * 1000); // 6 minutes > 5 min TTL
    expect(await consumeNonce(ADDR)).toBeNull();
    vi.useRealTimers();
  });

  it("is valid just before TTL", async () => {
    vi.useFakeTimers();
    const nonce = await createNonce(ADDR);
    vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes < 5 min TTL
    expect(await consumeNonce(ADDR)).toBe(nonce);
    vi.useRealTimers();
  });

  it("getNonceCount tracks active nonces", async () => {
    const before = await getNonceCount();
    await createNonce("0x1111111111111111111111111111111111111111");
    expect(await getNonceCount()).toBe(before + 1);
    await consumeNonce("0x1111111111111111111111111111111111111111");
    expect(await getNonceCount()).toBe(before);
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
