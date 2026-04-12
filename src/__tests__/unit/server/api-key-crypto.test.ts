/**
 * Admin API Key crypto helper unit tests — covers generateAdminApiKey()
 * and hashApiKey() from crypto.ts.
 *
 * These are pure functions (no external deps) — no mocks needed.
 */
import { describe, expect, it } from "vitest";

import { generateAdminApiKey, hashApiKey } from "@/server/lib/crypto";

// ── generateAdminApiKey ──────────────────────────────────────────

describe("generateAdminApiKey", () => {
  it("returns correct format — skm_ prefix, expected field lengths", () => {
    const result = generateAdminApiKey();

    // clientId: "skm_id_" + 12 hex chars = 19 chars total
    expect(result.clientId).toMatch(/^skm_id_[0-9a-f]{12}$/);

    // secret: "skm_" + 32 hex chars = 36 chars total
    expect(result.secret).toMatch(/^skm_[0-9a-f]{32}$/);

    // secretHash: SHA-256 hex = 64 chars
    expect(result.secretHash).toMatch(/^[0-9a-f]{64}$/);

    // secretPrefix: first 12 chars of secret
    expect(result.secretPrefix).toBe(result.secret.slice(0, 12));
    expect(result.secretPrefix).toHaveLength(12);
  });

  it("returns unique values on each call", () => {
    const a = generateAdminApiKey();
    const b = generateAdminApiKey();

    expect(a.clientId).not.toBe(b.clientId);
    expect(a.secret).not.toBe(b.secret);
    expect(a.secretHash).not.toBe(b.secretHash);
  });

  it("secretHash matches hashApiKey(secret) — roundtrip", () => {
    const result = generateAdminApiKey();
    const recomputed = hashApiKey(result.secret);
    expect(result.secretHash).toBe(recomputed);
  });

  it("generates many keys without collisions", () => {
    const secrets = new Set<string>();
    const hashes = new Set<string>();
    const clientIds = new Set<string>();

    for (let i = 0; i < 100; i++) {
      const key = generateAdminApiKey();
      secrets.add(key.secret);
      hashes.add(key.secretHash);
      clientIds.add(key.clientId);
    }

    expect(secrets.size).toBe(100);
    expect(hashes.size).toBe(100);
    expect(clientIds.size).toBe(100);
  });
});

// ── hashApiKey ──────────────────────────────────────────────────────

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hash for the same input", () => {
    const input = "skm_aabbccdd11223344aabbccdd11223344";
    const hash1 = hashApiKey(input);
    const hash2 = hashApiKey(input);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different inputs produce different hashes", () => {
    const hash1 = hashApiKey("skm_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const hash2 = hashApiKey("skm_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    expect(hash1).not.toBe(hash2);
  });

  it("handles arbitrary string input", () => {
    const hash = hashApiKey("any-string-value");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty string", () => {
    const hash = hashApiKey("");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // SHA-256 of empty string is a known constant
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is case-sensitive (different case → different hash)", () => {
    const lower = hashApiKey("skm_abcdef");
    const upper = hashApiKey("CGK_ABCDEF");

    expect(lower).not.toBe(upper);
  });
});
