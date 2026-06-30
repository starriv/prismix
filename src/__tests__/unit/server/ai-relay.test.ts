/**
 * AI Relay — Phase 1.0 unit tests.
 *
 * Tests: OpenAI adapter, endpoint auth builder, relay body schema.
 */
import { describe, expect, it } from "vitest";

import { buildEndpointAuth } from "@/server/ai/lib/endpoint-auth";
import { extractPassthroughHeaders } from "@/server/ai/lib/request-helpers";
import { openaiAdapter } from "@/server/ai/protocol-adapters/openai";
import { isUnsupportedStreamingCandidate } from "@/server/ai/routes/relay";
import { aiRelayChatBody } from "@/server/lib/body-schemas";

// ── OpenAI Adapter ──────────────────────────────────────────────────────

describe("openai adapter", () => {
  describe("buildUrl", () => {
    it("appends /chat/completions to base URL", () => {
      expect(
        openaiAdapter.buildUrl("https://api.openai.com/v1", { model: "gpt-4o", stream: false }),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("strips trailing slash before appending", () => {
      expect(
        openaiAdapter.buildUrl("https://api.openai.com/v1/", { model: "gpt-4o", stream: false }),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("adds /v1 when base URL omits it", () => {
      expect(
        openaiAdapter.buildUrl("https://class-1-violations.ixg.be", {
          model: "glm-5.2",
          stream: false,
        }),
      ).toBe("https://class-1-violations.ixg.be/v1/chat/completions");
    });

    it("does not add /v1 when base URL already contains a version path", () => {
      expect(
        openaiAdapter.buildUrl("https://open.bigmodel.cn/api/paas/v4", {
          model: "glm-5.2",
          stream: false,
        }),
      ).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    });
  });

  describe("transformRequest", () => {
    it("passes through non-streaming body without max_tokens unchanged", () => {
      const body = {
        model: "gpt-4o",
        messages: [{ role: "user" as const, content: "hello" }],
        temperature: 0.7,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.model).toBe("gpt-4o");
      expect(result.temperature).toBe(0.7);
      expect(result.max_tokens).toBeUndefined();
      expect(result.max_completion_tokens).toBeUndefined();
    });

    it("preserves max_tokens for generic OpenAI-compatible models", () => {
      const body = {
        model: "deepseek-v4-pro",
        messages: [{ role: "user" as const, content: "hello" }],
        max_tokens: 1024,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.max_tokens).toBe(1024);
      expect(result.max_completion_tokens).toBeUndefined();
    });

    it("renames max_tokens to max_completion_tokens for newer OpenAI models", () => {
      const body = {
        model: "gpt-5.4",
        messages: [{ role: "user" as const, content: "hello" }],
        max_tokens: 1024,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.max_completion_tokens).toBe(1024);
      expect(result.max_tokens).toBeUndefined();
    });

    it("injects stream_options for streaming requests", () => {
      const body = {
        model: "gpt-4o",
        messages: [{ role: "user" as const, content: "hello" }],
        stream: true,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.stream_options).toEqual({ include_usage: true });
      expect(result.model).toBe("gpt-4o");
    });

    it("preserves max_tokens and injects stream_options together for generic models", () => {
      const body = {
        model: "deepseek-v4-pro",
        messages: [{ role: "user" as const, content: "hello" }],
        stream: true,
        max_tokens: 2048,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.max_tokens).toBe(2048);
      expect(result.max_completion_tokens).toBeUndefined();
      expect(result.stream_options).toEqual({ include_usage: true });
    });

    it("renames max_tokens and injects stream_options together for newer OpenAI models", () => {
      const body = {
        model: "gpt-5.4",
        messages: [{ role: "user" as const, content: "hello" }],
        stream: true,
        max_tokens: 2048,
      };
      const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
      expect(result.max_completion_tokens).toBe(2048);
      expect(result.max_tokens).toBeUndefined();
      expect(result.stream_options).toEqual({ include_usage: true });
    });
  });

  describe("transformResponse", () => {
    it("passes through response unchanged", () => {
      const response = { id: "chatcmpl-123", choices: [], model: "gpt-4o" };
      expect(openaiAdapter.transformResponse(response)).toBe(response);
    });
  });

  describe("extractUsage", () => {
    it("extracts usage from response with standard fields", () => {
      const body = {
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
      expect(openaiAdapter.extractUsage(body)).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
    });

    it("returns null when no usage field", () => {
      expect(openaiAdapter.extractUsage({ choices: [] })).toBeNull();
    });

    it("returns null for null body", () => {
      expect(openaiAdapter.extractUsage(null)).toBeNull();
    });

    it("handles missing token fields as 0", () => {
      const body = { usage: {} };
      expect(openaiAdapter.extractUsage(body)).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
    });
  });

  describe("isStreamDone", () => {
    it("returns true for [DONE]", () => {
      expect(openaiAdapter.isStreamDone("[DONE]")).toBe(true);
    });

    it("returns true for [DONE] with whitespace", () => {
      expect(openaiAdapter.isStreamDone("  [DONE]  ")).toBe(true);
    });

    it("returns false for data chunks", () => {
      expect(openaiAdapter.isStreamDone('{"choices":[]}')).toBe(false);
    });
  });

  describe("extractStreamUsage", () => {
    it("extracts usage from final stream chunk JSON", () => {
      const data = JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
      });
      expect(openaiAdapter.extractStreamUsage(data)).toEqual({
        inputTokens: 5,
        outputTokens: 15,
        totalTokens: 20,
      });
    });

    it("returns null for chunks without usage", () => {
      const data = JSON.stringify({
        choices: [{ delta: { content: "hi" } }],
      });
      expect(openaiAdapter.extractStreamUsage(data)).toBeNull();
    });

    it("returns null for non-JSON data", () => {
      expect(openaiAdapter.extractStreamUsage("[DONE]")).toBeNull();
    });
  });

  describe("transformStreamEvent", () => {
    it("passes through event data unchanged", () => {
      const data = '{"choices":[{"delta":{"content":"hi"}}]}';
      expect(openaiAdapter.transformStreamEvent(data)).toBe(data);
    });
  });
});

// ── Endpoint Auth ───────────────────────────────────────────────────────

describe("buildEndpointAuth", () => {
  const baseUrl = "https://api.example.com/v1/chat/completions";
  const plainKey = "sk-test-key-123";

  it("builds bearer auth headers", () => {
    const endpoint = { authType: "bearer", authConfig: "{}", apiFormat: "openai" };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers.Authorization).toBe(`Bearer ${plainKey}`);
    expect(result.url).toBe(baseUrl);
  });

  it("builds api-key auth with default header name", () => {
    const endpoint = { authType: "api-key", authConfig: "{}", apiFormat: "openai" };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers["x-api-key"]).toBe(plainKey);
    expect(result.headers.Authorization).toBeUndefined();
    expect(result.url).toBe(baseUrl);
  });

  it("builds api-key auth with custom header name", () => {
    const endpoint = {
      authType: "api-key",
      authConfig: JSON.stringify({ headerName: "X-Custom-Key" }),
      apiFormat: "openai",
    };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers["X-Custom-Key"]).toBe(plainKey);
  });

  it("inherits supplier auth config when authMode is inherit", () => {
    const endpoint = {
      authMode: "inherit",
      authType: "bearer",
      authConfig: "{}",
      apiFormat: "openai",
      supplier: {
        authType: "api-key",
        authConfig: JSON.stringify({ headerName: "X-Supplier-Key" }),
        officialConcurrencyLimit: null,
        officialQueueTimeoutMs: 30_000,
      },
    };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers["X-Supplier-Key"]).toBe(plainKey);
    expect(result.headers.Authorization).toBeUndefined();
  });

  it("builds Cloudflare Access service-token headers", () => {
    const endpoint = {
      authType: "cloudflare",
      authConfig: JSON.stringify({ clientId: "service-token.access" }),
      apiFormat: "openai",
    };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers["CF-Access-Client-Id"]).toBe("service-token.access");
    expect(result.headers["CF-Access-Client-Secret"]).toBe(plainKey);
    expect(result.headers.Authorization).toBeUndefined();
    expect(result.url).toBe(baseUrl);
  });

  it("adds anthropic-version header for anthropic format", () => {
    const endpoint = {
      authType: "api-key",
      authConfig: JSON.stringify({ headerName: "x-api-key" }),
      apiFormat: "anthropic",
    };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers["x-api-key"]).toBe(plainKey);
    expect(result.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("builds gemini auth with query param", () => {
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    const endpoint = { authType: "bearer", authConfig: "{}", apiFormat: "gemini" };
    const result = buildEndpointAuth(endpoint, plainKey, url);

    expect(result.headers.Authorization).toBeUndefined();
    expect(result.url).toContain(`?key=${plainKey}`);
  });

  it("appends query param with & when URL already has params", () => {
    const url = "https://example.com/api?foo=bar";
    const endpoint = { authType: "bearer", authConfig: "{}", apiFormat: "gemini" };
    const result = buildEndpointAuth(endpoint, plainKey, url);

    expect(result.url).toBe(`https://example.com/api?foo=bar&key=${plainKey}`);
  });

  it("handles unknown auth type gracefully", () => {
    const endpoint = { authType: "unknown", authConfig: "{}", apiFormat: "openai" };
    const result = buildEndpointAuth(endpoint, plainKey, baseUrl);

    expect(result.headers.Authorization).toBeUndefined();
    expect(result.url).toBe(baseUrl);
  });
});

describe("extractPassthroughHeaders", () => {
  it("forwards Anthropic beta/version headers for adapter routes", async () => {
    const { Hono } = await import("hono");
    const app = new Hono();

    app.get("/test", (c) => c.json(extractPassthroughHeaders(c)));

    const res = await app.request("/test", {
      headers: {
        "anthropic-beta": "extended-thinking-2025-05-14",
        "anthropic-version": "2023-06-01",
        authorization: "Bearer should-not-pass",
        "x-custom-header": "ignore-me",
      },
    });

    expect(await res.json()).toEqual({
      "anthropic-beta": "extended-thinking-2025-05-14",
      "anthropic-version": "2023-06-01",
    });
  });
});

describe("isUnsupportedStreamingCandidate", () => {
  it("rejects Bedrock candidates for streaming requests", () => {
    expect(isUnsupportedStreamingCandidate(true, "bedrock")).toBe(true);
  });

  it("allows Bedrock for non-streaming requests", () => {
    expect(isUnsupportedStreamingCandidate(false, "bedrock")).toBe(false);
  });

  it("allows non-Bedrock streaming candidates", () => {
    expect(isUnsupportedStreamingCandidate(true, "anthropic")).toBe(false);
  });
});

// ── Relay Body Schema ───────────────────────────────────────────────────

describe("aiRelayChatBody", () => {
  const validBody = {
    model: "gpt-4o",
    messages: [{ role: "user", content: "hello" }],
  };

  it("accepts minimal valid body", () => {
    const result = aiRelayChatBody.safeParse(validBody);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe("gpt-4o");
      expect(result.data.stream).toBe(false); // default
    }
  });

  it("accepts body with all optional fields", () => {
    const result = aiRelayChatBody.safeParse({
      ...validBody,
      stream: true,
      max_tokens: 1000,
      temperature: 0.7,
      top_p: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("passes through extra fields (tools, response_format, etc.)", () => {
    const result = aiRelayChatBody.safeParse({
      ...validBody,
      tools: [{ type: "function", function: { name: "test" } }],
      response_format: { type: "json_object" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data as Record<string, unknown>;
      expect(parsed.tools).toBeDefined();
      expect(parsed.response_format).toBeDefined();
    }
  });

  it("accepts developer role messages", () => {
    const result = aiRelayChatBody.safeParse({
      model: "gpt-5.4",
      messages: [
        { role: "developer", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing model", () => {
    const result = aiRelayChatBody.safeParse({ messages: [{ role: "user", content: "hi" }] });
    expect(result.success).toBe(false);
  });

  it("rejects empty messages array", () => {
    const result = aiRelayChatBody.safeParse({ model: "gpt-4o", messages: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = aiRelayChatBody.safeParse({
      model: "gpt-4o",
      messages: [{ role: "invalid", content: "hi" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts null content (assistant messages with tool_calls)", () => {
    const result = aiRelayChatBody.safeParse({
      model: "gpt-4o",
      messages: [{ role: "assistant", content: null, tool_calls: [] }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts array content (vision messages)", () => {
    const result = aiRelayChatBody.safeParse({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects temperature > 2", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, temperature: 3 });
    expect(result.success).toBe(false);
  });

  it("rejects negative max_tokens", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_tokens: -1 });
    expect(result.success).toBe(false);
  });

  // ── max_tokens coercion ────────────────────────────────────────────

  it("coerces string max_tokens to number", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_tokens: "1024" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_tokens).toBe(1024);
  });

  it("coerces float max_tokens to integer", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_tokens: 1024.7 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_tokens).toBe(1024);
  });

  it("treats null max_tokens as undefined", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_tokens: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_tokens).toBeUndefined();
  });

  it("rejects non-numeric string max_tokens", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_tokens: "abc" });
    expect(result.success).toBe(false);
  });

  // ── max_completion_tokens normalization ─────────────────────────────

  it("normalizes max_completion_tokens to max_tokens", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_completion_tokens: 2048 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_tokens).toBe(2048);
      const parsed = result.data as Record<string, unknown>;
      expect(parsed.max_completion_tokens).toBeUndefined();
    }
  });

  it("prefers max_tokens over max_completion_tokens when both present", () => {
    const result = aiRelayChatBody.safeParse({
      ...validBody,
      max_tokens: 1000,
      max_completion_tokens: 2000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_tokens).toBe(1000);
  });

  it("coerces string max_completion_tokens", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, max_completion_tokens: "512" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.max_tokens).toBe(512);
  });

  // ── temperature / top_p coercion ───────────────────────────────────

  it("coerces string temperature to number", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, temperature: "0.7" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.temperature).toBe(0.7);
  });

  it("coerces string top_p to number", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, top_p: "0.9" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.top_p).toBe(0.9);
  });

  it("treats null temperature as undefined", () => {
    const result = aiRelayChatBody.safeParse({ ...validBody, temperature: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.temperature).toBeUndefined();
  });
});
