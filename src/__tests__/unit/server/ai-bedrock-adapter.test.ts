/**
 * Bedrock adapter + SigV4 auth — unit tests.
 *
 * Covers: URL construction, multi-vendor dispatch, SigV4 signing,
 * buildProviderAuth integration, and anthropic-version header injection.
 */
import { describe, expect, it } from "vitest";

import { buildProviderAuth, signSigV4 } from "@/server/ai/lib/provider-auth";
import {
  BEDROCK_STREAMING_SUPPORTED,
  bedrockAdapter,
  ensureInferenceProfile,
  getVendorPrefix,
} from "@/server/ai/providers/bedrock";

// ── Bedrock Adapter ─────────────────────────────────────────────────────

describe("bedrock adapter", () => {
  describe("buildUrl", () => {
    const base = "https://bedrock-runtime.us-east-1.amazonaws.com";

    it("auto-prefixes model ID with region geography", () => {
      expect(
        bedrockAdapter.buildUrl(base, {
          model: "anthropic.claude-3-sonnet-20240229-v1:0",
          stream: false,
        }),
      ).toBe(`${base}/model/us.anthropic.claude-3-sonnet-20240229-v1:0/invoke`);
    });

    it("preserves existing geography prefix", () => {
      expect(
        bedrockAdapter.buildUrl(base, {
          model: "us.anthropic.claude-sonnet-4-6",
          stream: false,
        }),
      ).toBe(`${base}/model/us.anthropic.claude-sonnet-4-6/invoke`);
    });

    it("builds streaming URL with auto-prefix", () => {
      expect(
        bedrockAdapter.buildUrl(base, {
          model: "anthropic.claude-3-sonnet-20240229-v1:0",
          stream: true,
        }),
      ).toBe(
        `${base}/model/us.anthropic.claude-3-sonnet-20240229-v1:0/invoke-with-response-stream`,
      );
    });

    it("strips trailing slash", () => {
      expect(
        bedrockAdapter.buildUrl(`${base}/`, {
          model: "us.anthropic.claude-sonnet-4-6",
          stream: false,
        }),
      ).toBe(`${base}/model/us.anthropic.claude-sonnet-4-6/invoke`);
    });

    it("always uses us prefix regardless of endpoint region", () => {
      const euBase = "https://bedrock-runtime.eu-central-1.amazonaws.com";
      expect(
        bedrockAdapter.buildUrl(euBase, { model: "anthropic.claude-sonnet-4-6", stream: false }),
      ).toBe(`${euBase}/model/us.anthropic.claude-sonnet-4-6/invoke`);

      const apBase = "https://bedrock-runtime.ap-northeast-1.amazonaws.com";
      expect(
        bedrockAdapter.buildUrl(apBase, { model: "minimax.minimax-m2.1", stream: false }),
      ).toBe(`${apBase}/model/us.minimax.minimax-m2.1/invoke`);
    });
  });

  it("has format bedrock", () => {
    expect(bedrockAdapter.format).toBe("bedrock");
  });

  it("explicitly marks native streaming as unsupported", () => {
    expect(BEDROCK_STREAMING_SUPPORTED).toBe(false);
  });

  it("delegates extractUsage to anthropic adapter for Anthropic response", () => {
    const body = { type: "message", usage: { input_tokens: 10, output_tokens: 20 } };
    expect(bedrockAdapter.extractUsage(body)).toMatchObject({
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

// ── Inference profile auto-prefix ────────────────────────────────────────

describe("ensureInferenceProfile", () => {
  const usBase = "https://bedrock-runtime.us-east-1.amazonaws.com";
  const euBase = "https://bedrock-runtime.eu-central-1.amazonaws.com";
  const apBase = "https://bedrock-runtime.ap-northeast-1.amazonaws.com";

  it("adds us prefix regardless of endpoint region", () => {
    expect(ensureInferenceProfile("anthropic.claude-sonnet-4-6", usBase)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
    expect(ensureInferenceProfile("anthropic.claude-sonnet-4-6", euBase)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
    expect(ensureInferenceProfile("minimax.minimax-m2.1", apBase)).toBe("us.minimax.minimax-m2.1");
  });

  it("preserves existing geography prefix", () => {
    expect(ensureInferenceProfile("us.anthropic.claude-sonnet-4-6", usBase)).toBe(
      "us.anthropic.claude-sonnet-4-6",
    );
    expect(ensureInferenceProfile("eu.meta.llama3-2-1b-instruct-v1:0", euBase)).toBe(
      "eu.meta.llama3-2-1b-instruct-v1:0",
    );
  });

  it("returns model as-is when baseUrl has no region", () => {
    expect(
      ensureInferenceProfile("anthropic.claude-sonnet-4-6", "https://custom.endpoint.com"),
    ).toBe("anthropic.claude-sonnet-4-6");
  });
});

// ── Multi-vendor dispatch ────────────────────────────────────────────────

describe("bedrock adapter — multi-vendor dispatch", () => {
  describe("getVendorPrefix", () => {
    it("extracts vendor from standard model ID", () => {
      expect(getVendorPrefix("anthropic.claude-opus-4-6-v1")).toBe("anthropic");
      expect(getVendorPrefix("minimax.minimax-m2.1")).toBe("minimax");
      expect(getVendorPrefix("moonshot.kimi-k2.5")).toBe("moonshot");
      expect(getVendorPrefix("openai.gpt-oss-120b")).toBe("openai");
    });

    it("skips cross-region prefix", () => {
      expect(getVendorPrefix("us.anthropic.claude-sonnet-4-6")).toBe("anthropic");
      expect(getVendorPrefix("eu.meta.llama3-2-1b-instruct-v1:0")).toBe("meta");
      expect(getVendorPrefix("ap.minimax.minimax-m2.1")).toBe("minimax");
      expect(getVendorPrefix("global.anthropic.claude-opus-4-6-v1")).toBe("anthropic");
    });

    it("returns full string for single-segment model ID", () => {
      expect(getVendorPrefix("some-model")).toBe("some-model");
    });
  });

  describe("transformRequest", () => {
    it("uses Anthropic format for anthropic.* models", () => {
      const result = bedrockAdapter.transformRequest({
        model: "anthropic.claude-opus-4-6-v1",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "Hi" },
        ],
      }) as Record<string, unknown>;

      // Anthropic adapter extracts system messages
      expect(result.system).toBe("Be helpful.");
      expect((result.messages as unknown[]).length).toBe(1);
      expect(result.max_tokens).toBeDefined();
    });

    it("uses Anthropic format for cross-region anthropic models", () => {
      const result = bedrockAdapter.transformRequest({
        model: "us.anthropic.claude-sonnet-4-6",
        messages: [
          { role: "system", content: "System prompt." },
          { role: "user", content: "Hello" },
        ],
      }) as Record<string, unknown>;

      expect(result.system).toBe("System prompt.");
    });

    it("uses OpenAI format for minimax.* models", () => {
      const result = bedrockAdapter.transformRequest({
        model: "minimax.minimax-m2.1",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "Hi" },
        ],
      }) as Record<string, unknown>;

      // OpenAI passthrough: system messages stay in messages array
      const messages = result.messages as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(result.system).toBeUndefined();
    });

    it("uses OpenAI format for moonshot.* models", () => {
      const result = bedrockAdapter.transformRequest({
        model: "moonshot.kimi-k2.5",
        messages: [{ role: "user", content: "Hi" }],
      }) as Record<string, unknown>;

      const messages = result.messages as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(1);
      expect(result.system).toBeUndefined();
    });
  });

  describe("transformResponse", () => {
    it("handles Anthropic response shape (type=message)", () => {
      const anthropicBody = {
        id: "msg_123",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello!" }],
        model: "claude-opus-4-6",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      };

      const result = bedrockAdapter.transformResponse(anthropicBody);
      expect(result.object).toBe("chat.completion");
      expect(result.choices[0].message.content).toBe("Hello!");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("handles OpenAI response shape (choices array)", () => {
      const openaiBody = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1700000000,
        model: "minimax-m2.1",
        choices: [
          { index: 0, message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      };

      const result = bedrockAdapter.transformResponse(openaiBody);
      expect(result.choices[0].message.content).toBe("Hi!");
    });
  });

  describe("extractUsage", () => {
    it("extracts from Anthropic format (input_tokens/output_tokens)", () => {
      const body = { type: "message", usage: { input_tokens: 100, output_tokens: 50 } };
      expect(bedrockAdapter.extractUsage(body)).toMatchObject({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });

    it("extracts from OpenAI format (prompt_tokens/completion_tokens)", () => {
      const body = { usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
      expect(bedrockAdapter.extractUsage(body)).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });

  describe("isStreamDone", () => {
    it("detects OpenAI [DONE] signal", () => {
      expect(bedrockAdapter.isStreamDone("[DONE]")).toBe(true);
    });

    it("detects Anthropic message_stop signal", () => {
      expect(bedrockAdapter.isStreamDone('{"type":"message_stop"}')).toBe(true);
    });

    it("returns false for regular events", () => {
      expect(bedrockAdapter.isStreamDone('{"type":"content_block_delta"}')).toBe(false);
    });
  });
});

// ── anthropic-version header injection ──────────────────────────────────

describe("buildProviderAuth anthropic-version for bedrock", () => {
  it("injects anthropic-version header for bedrock apiFormat", () => {
    const provider = {
      authType: "bearer",
      authConfig: "{}",
      apiFormat: "bedrock",
    };

    const result = buildProviderAuth(provider, "test-key", "https://example.com/invoke");
    expect(result.headers["anthropic-version"]).toBe("2023-06-01");
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
