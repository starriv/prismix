/**
 * Bedrock adapter + SigV4 auth — Phase 3 Feature 1 unit tests.
 */
import { describe, expect, it } from "vitest";

import { buildProviderAuth, signSigV4 } from "@/server/ai/lib/provider-auth";
import { bedrockAdapter } from "@/server/ai/providers/bedrock";

// ── Bedrock Adapter ─────────────────────────────────────────────────────

describe("bedrock adapter", () => {
  describe("buildUrl", () => {
    const base = "https://bedrock-runtime.us-east-1.amazonaws.com";

    it("builds non-streaming invoke URL", () => {
      expect(
        bedrockAdapter.buildUrl(base, {
          model: "anthropic.claude-3-sonnet-20240229-v1:0",
          stream: false,
        }),
      ).toBe(`${base}/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke`);
    });

    it("builds streaming invoke-with-response-stream URL", () => {
      expect(
        bedrockAdapter.buildUrl(base, {
          model: "anthropic.claude-3-sonnet-20240229-v1:0",
          stream: true,
        }),
      ).toBe(`${base}/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke-with-response-stream`);
    });

    it("strips trailing slash", () => {
      expect(bedrockAdapter.buildUrl(`${base}/`, { model: "model-id", stream: false })).toBe(
        `${base}/model/model-id/invoke`,
      );
    });
  });

  it("has format bedrock", () => {
    expect(bedrockAdapter.format).toBe("bedrock");
  });

  it("delegates extractUsage to anthropic adapter", () => {
    const body = { usage: { input_tokens: 10, output_tokens: 20 } };
    expect(bedrockAdapter.extractUsage(body)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("delegates transformRequest to anthropic adapter (system extraction)", () => {
    const result = bedrockAdapter.transformRequest({
      model: "anthropic.claude-3-sonnet",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
      ],
    }) as Record<string, unknown>;

    expect(result.system).toBe("You are helpful.");
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });
});

// ── SigV4 Signing ───────────────────────────────────────────────────────

describe("signSigV4", () => {
  it("produces required AWS headers", () => {
    const headers = signSigV4({
      method: "POST",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude/invoke",
      body: '{"messages":[]}',
      region: "us-east-1",
      service: "bedrock",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });

    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\//);
    expect(headers.Authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date",
    );
    expect(headers.Authorization).toContain("Signature=");
    expect(headers["X-Amz-Date"]).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers["X-Amz-Content-Sha256"]).toHaveLength(64); // SHA-256 hex
  });

  it("content hash matches body SHA-256", () => {
    const body = '{"test":"data"}';
    const crypto = require("crypto");
    const expectedHash = crypto.createHash("sha256").update(body).digest("hex");

    const headers = signSigV4({
      method: "POST",
      url: "https://example.com/api",
      body,
      region: "us-west-2",
      service: "execute-api",
      accessKeyId: "AKIA123",
      secretAccessKey: "secret123",
    });

    expect(headers["X-Amz-Content-Sha256"]).toBe(expectedHash);
  });

  it("different bodies produce different signatures", () => {
    const params = {
      method: "POST",
      url: "https://example.com/api",
      region: "us-east-1",
      service: "bedrock",
      accessKeyId: "AKIA123",
      secretAccessKey: "secret",
    };

    const h1 = signSigV4({ ...params, body: "body1" });
    const h2 = signSigV4({ ...params, body: "body2" });

    expect(h1.Authorization).not.toBe(h2.Authorization);
    expect(h1["X-Amz-Content-Sha256"]).not.toBe(h2["X-Amz-Content-Sha256"]);
  });
});

// ── buildProviderAuth with SigV4 ────────────────────────────────────────

describe("buildProviderAuth sigv4", () => {
  it("produces AWS SigV4 headers for bedrock provider", () => {
    const provider = {
      authType: "sigv4",
      authConfig: JSON.stringify({
        region: "us-east-1",
        service: "bedrock",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      }),
      apiFormat: "bedrock",
    };

    const result = buildProviderAuth(
      provider,
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "https://bedrock-runtime.us-east-1.amazonaws.com/model/test/invoke",
      '{"messages":[]}',
    );

    expect(result.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256/);
    expect(result.headers["X-Amz-Date"]).toBeDefined();
    expect(result.headers["X-Amz-Content-Sha256"]).toBeDefined();
  });
});
