import { verifyMessage } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifySiweSignature } from "@/server/lib/auth-flows";
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

vi.mock("viem", () => ({
  verifyMessage: vi.fn(),
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
  const ORIGINAL_ENV = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    DOMAIN: process.env.DOMAIN,
    NODE_ENV: process.env.NODE_ENV,
    VITE_DEV_PORT: process.env.VITE_DEV_PORT,
  };

  beforeEach(() => {
    delete process.env.CORS_ORIGIN;
    delete process.env.DOMAIN;
    delete process.env.VITE_DEV_PORT;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    restoreEnv("CORS_ORIGIN", ORIGINAL_ENV.CORS_ORIGIN);
    restoreEnv("DOMAIN", ORIGINAL_ENV.DOMAIN);
    restoreEnv("NODE_ENV", ORIGINAL_ENV.NODE_ENV);
    restoreEnv("VITE_DEV_PORT", ORIGINAL_ENV.VITE_DEV_PORT);
  });

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
    expect(msg).toContain("app.example.com:8443 wants you to sign in");
    expect(msg).toContain("URI: https://app.example.com:8443");
  });

  it("uses full local HTTP origin in development", () => {
    const msg = buildSiweMessage("0xABC", "n1", "http://localhost:5189");
    expect(msg).toContain("http://localhost:5189 wants you to sign in");
    expect(msg).toContain("URI: http://localhost:5189");
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

  it("uses local CORS_ORIGIN as full origin in development", () => {
    process.env.CORS_ORIGIN = "http://localhost:5189";
    try {
      const msg = buildSiweMessage("0xABC", "n1");
      expect(msg).toContain("http://localhost:5189 wants you to sign in");
      expect(msg).toContain("URI: http://localhost:5189");
    } finally {
      delete process.env.CORS_ORIGIN;
    }
  });

  it("falls back to VITE_DEV_PORT in development", () => {
    process.env.VITE_DEV_PORT = "5189";
    try {
      const msg = buildSiweMessage("0xABC", "n1");
      expect(msg).toContain("http://localhost:5189 wants you to sign in");
      expect(msg).toContain("URI: http://localhost:5189");
    } finally {
      delete process.env.VITE_DEV_PORT;
    }
  });

  it("prefers VITE_DEV_PORT over DOMAIN in development", () => {
    process.env.DOMAIN = "localhost";
    process.env.VITE_DEV_PORT = "5189";
    try {
      const msg = buildSiweMessage("0xABC", "n1");
      expect(msg).toContain("http://localhost:5189 wants you to sign in");
      expect(msg).toContain("URI: http://localhost:5189");
    } finally {
      delete process.env.DOMAIN;
      delete process.env.VITE_DEV_PORT;
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

describe("verifySiweSignature", () => {
  const ADDR = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
  const ORIGIN = "https://app.example.com";
  const ORIGINAL_ENV = {
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    DOMAIN: process.env.DOMAIN,
    NODE_ENV: process.env.NODE_ENV,
    VITE_DEV_PORT: process.env.VITE_DEV_PORT,
  };

  beforeEach(() => {
    redisMock.store.clear();
    delete process.env.CORS_ORIGIN;
    delete process.env.DOMAIN;
    delete process.env.VITE_DEV_PORT;
    process.env.NODE_ENV = "test";
    vi.mocked(verifyMessage).mockResolvedValue(true);
  });

  afterEach(() => {
    restoreEnv("CORS_ORIGIN", ORIGINAL_ENV.CORS_ORIGIN);
    restoreEnv("DOMAIN", ORIGINAL_ENV.DOMAIN);
    restoreEnv("NODE_ENV", ORIGINAL_ENV.NODE_ENV);
    restoreEnv("VITE_DEV_PORT", ORIGINAL_ENV.VITE_DEV_PORT);
    vi.mocked(verifyMessage).mockRestore();
  });

  async function signAndVerify(address: string, origin: string, scope: "user" | "admin" = "user") {
    const nonce = await createNonce(address, scope);
    const message = buildSiweMessage(address, nonce, origin);
    return verifySiweSignature(address, "0xfake", message, scope, origin);
  }

  it("succeeds when nonce, message, and signature are valid", async () => {
    const result = await signAndVerify(ADDR, ORIGIN);
    expect(result).toEqual({ ok: true });
  });

  it("fails when nonce was already consumed (single-use)", async () => {
    const nonce = await createNonce(ADDR);
    const message = buildSiweMessage(ADDR, nonce, ORIGIN);
    await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    const second = await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    expect(second).toEqual({ ok: false, reason: "Invalid or expired nonce" });
  });

  it("fails when nonce does not match the message", async () => {
    await createNonce(ADDR);
    const message = buildSiweMessage(ADDR, "wrong-nonce", ORIGIN);
    const result = await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    expect(result).toEqual({ ok: false, reason: "Nonce mismatch" });
  });

  it("fails when address in message does not match", async () => {
    const nonce = await createNonce(ADDR);
    const message = buildSiweMessage("0x0000000000000000000000000000000000000001", nonce, ORIGIN);
    const result = await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toContain("Address mismatch");
  });

  it("fails when domain in message does not match expected origin", async () => {
    const nonce = await createNonce(ADDR);
    const message = buildSiweMessage(ADDR, nonce, "https://evil.com");
    const result = await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toContain("Domain mismatch");
  });

  it("fails when URI in message does not match expected origin", async () => {
    const nonce = await createNonce(ADDR);
    let message = buildSiweMessage(ADDR, nonce, ORIGIN);
    message = message.replace("URI: https://app.example.com", "URI: https://evil.com");
    const result = await verifySiweSignature(ADDR, "0xfake", message, "user", ORIGIN);
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toContain("URI mismatch");
  });

  it("fails when signature verification returns false", async () => {
    vi.mocked(verifyMessage).mockResolvedValue(false);
    const result = await signAndVerify(ADDR, ORIGIN);
    expect(result).toEqual({ ok: false, reason: "Signature verification failed" });
  });

  it("fails when origin is malformed", async () => {
    const nonce = await createNonce(ADDR);
    const message = buildSiweMessage(ADDR, nonce, ORIGIN);
    const result = await verifySiweSignature(ADDR, "0xfake", message, "user", "not-a-url");
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toContain("Invalid origin");
  });

  it("succeeds with localhost dev origin including scheme", async () => {
    const result = await signAndVerify(ADDR, "http://localhost:5189");
    expect(result).toEqual({ ok: true });
  });

  it("isolates user and admin scopes during verification", async () => {
    const userNonce = await createNonce(ADDR, "user");
    const message = buildSiweMessage(ADDR, userNonce, ORIGIN);
    const result = await verifySiweSignature(ADDR, "0xfake", message, "admin", ORIGIN);
    expect(result).toEqual({ ok: false, reason: "Invalid or expired nonce" });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
