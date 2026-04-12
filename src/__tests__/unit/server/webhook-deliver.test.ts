import { describe, expect, it } from "vitest";

import {
  calculateNextRetry,
  generateEventId,
  generateSecret,
  signPayload,
  validateWebhookUrl,
} from "@/server/messaging/webhooks/deliver";
import { matchEventPattern } from "@/server/repos/webhook-endpoint-repo";

describe("webhook delivery engine", () => {
  describe("generateSecret", () => {
    it("produces whsec_ prefix", () => {
      const secret = generateSecret();
      expect(secret).toMatch(/^whsec_/);
    });

    it("produces unique secrets", () => {
      const a = generateSecret();
      const b = generateSecret();
      expect(a).not.toBe(b);
    });

    it("has sufficient length", () => {
      const secret = generateSecret();
      // whsec_ (6) + 32 bytes base64url (~43 chars)
      expect(secret.length).toBeGreaterThan(40);
    });
  });

  describe("generateEventId", () => {
    it("produces evt_ prefix", () => {
      const id = generateEventId();
      expect(id).toMatch(/^evt_/);
    });

    it("produces unique IDs", () => {
      const a = generateEventId();
      const b = generateEventId();
      expect(a).not.toBe(b);
    });

    it("contains a valid UUID after prefix", () => {
      const id = generateEventId();
      const uuid = id.slice(4);
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe("signPayload", () => {
    it("produces v1= prefix", () => {
      const sig = signPayload("evt_123", 1711468800, '{"test":true}', "secret");
      expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    });

    it("produces deterministic signatures", () => {
      const a = signPayload("evt_123", 1711468800, '{"test":true}', "secret");
      const b = signPayload("evt_123", 1711468800, '{"test":true}', "secret");
      expect(a).toBe(b);
    });

    it("different secrets produce different signatures", () => {
      const a = signPayload("evt_123", 1711468800, '{"test":true}', "secret1");
      const b = signPayload("evt_123", 1711468800, '{"test":true}', "secret2");
      expect(a).not.toBe(b);
    });

    it("different event IDs produce different signatures", () => {
      const a = signPayload("evt_aaa", 1711468800, '{"test":true}', "secret");
      const b = signPayload("evt_bbb", 1711468800, '{"test":true}', "secret");
      expect(a).not.toBe(b);
    });

    it("different timestamps produce different signatures", () => {
      const a = signPayload("evt_123", 1711468800, '{"test":true}', "secret");
      const b = signPayload("evt_123", 1711468801, '{"test":true}', "secret");
      expect(a).not.toBe(b);
    });
  });

  describe("validateWebhookUrl", () => {
    it("accepts valid HTTPS URLs", () => {
      expect(validateWebhookUrl("https://api.example.com/webhook")).toBeNull();
    });

    it("accepts valid HTTP URLs", () => {
      expect(validateWebhookUrl("http://api.example.com/webhook")).toBeNull();
    });

    it("rejects localhost", () => {
      expect(validateWebhookUrl("http://localhost:3000/webhook")).not.toBeNull();
    });

    it("rejects 127.0.0.1", () => {
      expect(validateWebhookUrl("http://127.0.0.1/webhook")).not.toBeNull();
    });

    it("rejects 10.x.x.x", () => {
      expect(validateWebhookUrl("http://10.0.0.1/webhook")).not.toBeNull();
    });

    it("rejects 172.16-31.x.x", () => {
      expect(validateWebhookUrl("http://172.16.0.1/webhook")).not.toBeNull();
    });

    it("rejects 192.168.x.x", () => {
      expect(validateWebhookUrl("http://192.168.1.1/webhook")).not.toBeNull();
    });

    it("rejects 0.0.0.0", () => {
      expect(validateWebhookUrl("http://0.0.0.0/webhook")).not.toBeNull();
    });

    it("rejects non-http protocols", () => {
      expect(validateWebhookUrl("ftp://example.com/webhook")).not.toBeNull();
    });

    it("rejects invalid URLs", () => {
      expect(validateWebhookUrl("not-a-url")).not.toBeNull();
    });
  });

  describe("calculateNextRetry", () => {
    it("returns 5s for first retry (attempts=0)", () => {
      expect(calculateNextRetry(0)).toBe(5_000);
    });

    it("returns 30s for second retry (attempts=1)", () => {
      expect(calculateNextRetry(1)).toBe(30_000);
    });

    it("returns 2min for third retry (attempts=2)", () => {
      expect(calculateNextRetry(2)).toBe(120_000);
    });

    it("returns 15min for fourth retry (attempts=3)", () => {
      expect(calculateNextRetry(3)).toBe(900_000);
    });

    it("returns 1h for fifth retry (attempts=4)", () => {
      expect(calculateNextRetry(4)).toBe(3_600_000);
    });

    it("returns null when max retries exceeded (attempts=5)", () => {
      expect(calculateNextRetry(5)).toBeNull();
    });

    it("returns null for higher attempts", () => {
      expect(calculateNextRetry(10)).toBeNull();
    });
  });

  describe("matchEventPattern", () => {
    it("matches exact event type", () => {
      expect(matchEventPattern("tx.settled", "tx.settled")).toBe(true);
    });

    it("does not match different event type", () => {
      expect(matchEventPattern("tx.settled", "tx.failed")).toBe(false);
    });

    it("matches wildcard *", () => {
      expect(matchEventPattern("*", "tx.settled")).toBe(true);
      expect(matchEventPattern("*", "anything")).toBe(true);
    });

    it("matches prefix wildcard tx.*", () => {
      expect(matchEventPattern("tx.*", "tx.settled")).toBe(true);
      expect(matchEventPattern("tx.*", "tx.failed")).toBe(true);
    });

    it("prefix wildcard does not match other domains", () => {
      expect(matchEventPattern("tx.*", "gateway.error")).toBe(false);
    });

    it("matches gateway.* prefix", () => {
      expect(matchEventPattern("gateway.*", "gateway.upstream-timeout")).toBe(true);
    });

    it("matches resource.* prefix", () => {
      expect(matchEventPattern("resource.*", "resource.created")).toBe(true);
      expect(matchEventPattern("resource.*", "resource.updated")).toBe(true);
    });
  });
});
