/**
 * Anthropic adapter — Phase 1.2 unit tests.
 *
 * Tests: request/response conversion, streaming event transformation,
 * stop_reason mapping, usage extraction.
 */
import { describe, expect, it } from "vitest";

import { anthropicAdapter } from "@/server/ai/providers/anthropic";

// ── buildUrl ────────────────────────────────────────────────────────────

describe("anthropic adapter", () => {
  describe("buildUrl", () => {
    it("appends /messages to base URL", () => {
      expect(
        anthropicAdapter.buildUrl("https://api.anthropic.com/v1", {
          model: "claude-sonnet-4-20250514",
          stream: false,
        }),
      ).toBe("https://api.anthropic.com/v1/messages");
    });

    it("strips trailing slash", () => {
      expect(
        anthropicAdapter.buildUrl("https://api.anthropic.com/v1/", {
          model: "claude-sonnet-4-20250514",
          stream: false,
        }),
      ).toBe("https://api.anthropic.com/v1/messages");
    });
  });

  // ── transformRequest ────────────────────────────────────────────────

  describe("transformRequest", () => {
    it("extracts system message to top-level field", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ],
      }) as Record<string, unknown>;

      expect(result.system).toBe("You are helpful.");
      expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("concatenates multiple system messages", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "system", content: "Be concise." },
          { role: "user", content: "Hi" },
        ],
      }) as Record<string, unknown>;

      expect(result.system).toBe("Be helpful.\n\nBe concise.");
    });

    it("treats developer messages as system instructions", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "developer", content: "Follow product policy." },
          { role: "user", content: "Hello" },
        ],
      }) as Record<string, unknown>;

      expect(result.system).toBe("Follow product policy.");
      expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("omits system field when no system messages", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      }) as Record<string, unknown>;

      expect(result.system).toBeUndefined();
    });

    it("defaults max_tokens to 4096 when not specified", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      }) as Record<string, unknown>;

      expect(result.max_tokens).toBe(4096);
    });

    it("preserves explicit max_tokens", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1000,
      }) as Record<string, unknown>;

      expect(result.max_tokens).toBe(1000);
    });

    it("passes through extra fields (temperature, tools, stream)", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
        stream: true,
        tools: [{ type: "function", function: { name: "test" } }],
      }) as Record<string, unknown>;

      expect(result.temperature).toBe(0.7);
      expect(result.stream).toBe(true);
      expect(result.tools).toBeDefined();
    });

    it("preserves model field", () => {
      const result = anthropicAdapter.transformRequest({
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Hello" }],
      }) as Record<string, unknown>;

      expect(result.model).toBe("claude-sonnet-4-20250514");
    });
  });

  // ── transformResponse ───────────────────────────────────────────────

  describe("transformResponse", () => {
    const anthropicResponse = {
      id: "msg_01XFDUDYJgAACzvnptvVoYEL",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello! How can I help?" }],
      model: "claude-sonnet-4-20250514",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    };

    it("maps to OpenAI response format", () => {
      const result = anthropicAdapter.transformResponse(anthropicResponse);

      expect(result.id).toBe("msg_01XFDUDYJgAACzvnptvVoYEL");
      expect(result.object).toBe("chat.completion");
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].index).toBe(0);
      expect(result.choices[0].message.role).toBe("assistant");
      expect(result.choices[0].message.content).toBe("Hello! How can I help?");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("maps usage fields correctly", () => {
      const result = anthropicAdapter.transformResponse(anthropicResponse);

      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it("includes cache tokens in prompt_tokens", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation_input_tokens: 2000,
          cache_read_input_tokens: 500,
        },
      });

      expect(result.usage).toEqual({
        prompt_tokens: 2510, // 10 + 2000 + 500
        completion_tokens: 20,
        total_tokens: 2530,
      });
    });

    it("maps stop_reason: max_tokens → length", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        stop_reason: "max_tokens",
      });
      expect(result.choices[0].finish_reason).toBe("length");
    });

    it("maps stop_reason: tool_use → tool_calls", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        stop_reason: "tool_use",
      });
      expect(result.choices[0].finish_reason).toBe("tool_calls");
    });

    it("handles null stop_reason", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        stop_reason: null,
      });
      expect(result.choices[0].finish_reason).toBeNull();
    });

    it("concatenates multiple text content blocks", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world!" },
        ],
      });
      expect(result.choices[0].message.content).toBe("Hello world!");
    });

    it("handles tool_use content blocks", () => {
      const result = anthropicAdapter.transformResponse({
        ...anthropicResponse,
        content: [
          { type: "tool_use", id: "toolu_123", name: "get_weather", input: { city: "NYC" } },
        ],
        stop_reason: "tool_use",
      });

      const msg = result.choices[0].message;
      expect(msg.content).toBeNull(); // no text blocks
      expect(msg.tool_calls).toBeDefined();
      const toolCalls = msg.tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls[0]).toMatchObject({
        id: "toolu_123",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"NYC"}' },
      });
    });
  });

  // ── extractUsage ────────────────────────────────────────────────────

  describe("extractUsage", () => {
    it("extracts usage from Anthropic response", () => {
      const body = {
        usage: { input_tokens: 15, output_tokens: 25 },
      };
      expect(anthropicAdapter.extractUsage(body)).toMatchObject({
        inputTokens: 15,
        outputTokens: 25,
        totalTokens: 40,
      });
    });

    it("includes cache tokens in inputTokens", () => {
      const body = {
        usage: {
          input_tokens: 12,
          output_tokens: 50,
          cache_creation_input_tokens: 2520,
          cache_read_input_tokens: 800,
        },
      };
      const result = anthropicAdapter.extractUsage(body)!;
      expect(result.inputTokens).toBe(3332); // 12 + 2520 + 800
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(3382);
      expect(result.cacheCreationInputTokens).toBe(2520);
      expect(result.cacheReadInputTokens).toBe(800);
    });

    it("returns null when no usage", () => {
      expect(anthropicAdapter.extractUsage({})).toBeNull();
    });

    it("returns null for null body", () => {
      expect(anthropicAdapter.extractUsage(null)).toBeNull();
    });
  });

  // ── isStreamDone ────────────────────────────────────────────────────

  describe("isStreamDone", () => {
    it("returns true for message_stop event", () => {
      expect(anthropicAdapter.isStreamDone('{"type":"message_stop"}')).toBe(true);
    });

    it("returns false for content_block_delta", () => {
      expect(
        anthropicAdapter.isStreamDone('{"type":"content_block_delta","delta":{"text":"hi"}}'),
      ).toBe(false);
    });

    it("returns false for non-JSON data", () => {
      expect(anthropicAdapter.isStreamDone("[DONE]")).toBe(false);
    });

    it("returns false for message_start", () => {
      expect(anthropicAdapter.isStreamDone('{"type":"message_start"}')).toBe(false);
    });
  });

  // ── extractStreamUsage ──────────────────────────────────────────────

  describe("extractStreamUsage", () => {
    it("extracts input_tokens from message_start event", () => {
      const event = JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 42, output_tokens: 0 } },
      });
      expect(anthropicAdapter.extractStreamUsage(event)).toMatchObject({
        inputTokens: 42,
        outputTokens: 0,
        totalTokens: 42,
      });
    });

    it("includes cache tokens in message_start input count", () => {
      const event = JSON.stringify({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 12,
            cache_creation_input_tokens: 2520,
            cache_read_input_tokens: 0,
          },
        },
      });
      const result = anthropicAdapter.extractStreamUsage(event)!;
      expect(result.inputTokens).toBe(2532); // 12 + 2520
      expect(result.cacheCreationInputTokens).toBe(2520);
    });

    it("extracts output_tokens from message_delta event", () => {
      const event = JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 55 },
      });
      expect(anthropicAdapter.extractStreamUsage(event)).toEqual({
        inputTokens: 0,
        outputTokens: 55,
        totalTokens: 55,
      });
    });

    it("returns null for content_block_delta events", () => {
      const event = JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      });
      expect(anthropicAdapter.extractStreamUsage(event)).toBeNull();
    });

    it("returns null for non-JSON data", () => {
      expect(anthropicAdapter.extractStreamUsage("not json")).toBeNull();
    });

    it("returns null for ping events", () => {
      expect(anthropicAdapter.extractStreamUsage('{"type":"ping"}')).toBeNull();
    });
  });

  // ── transformStreamEvent ────────────────────────────────────────────

  describe("transformStreamEvent", () => {
    it("converts content_block_delta text to OpenAI delta format", () => {
      const event = JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      });
      const result = anthropicAdapter.transformStreamEvent(event);
      expect(result).not.toBeNull();

      const parsed = JSON.parse(result!);
      expect(parsed.choices[0].delta.content).toBe("Hello");
      expect(parsed.choices[0].finish_reason).toBeNull();
    });

    it("converts message_delta with stop_reason to finish_reason", () => {
      const event = JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 10 },
      });
      const result = anthropicAdapter.transformStreamEvent(event);
      expect(result).not.toBeNull();

      const parsed = JSON.parse(result!);
      expect(parsed.choices[0].finish_reason).toBe("stop");
    });

    it("skips message_start events", () => {
      const event = JSON.stringify({
        type: "message_start",
        message: { id: "msg_123", role: "assistant" },
      });
      expect(anthropicAdapter.transformStreamEvent(event)).toBeNull();
    });

    it("skips content_block_start events", () => {
      const event = JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });
      expect(anthropicAdapter.transformStreamEvent(event)).toBeNull();
    });

    it("skips content_block_stop events", () => {
      expect(
        anthropicAdapter.transformStreamEvent('{"type":"content_block_stop","index":0}'),
      ).toBeNull();
    });

    it("skips ping events", () => {
      expect(anthropicAdapter.transformStreamEvent('{"type":"ping"}')).toBeNull();
    });

    it("skips message_stop events", () => {
      expect(anthropicAdapter.transformStreamEvent('{"type":"message_stop"}')).toBeNull();
    });

    it("returns null for non-JSON data", () => {
      expect(anthropicAdapter.transformStreamEvent("not json")).toBeNull();
    });

    it("handles input_json_delta for tool streaming", () => {
      const event = JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"city":' },
      });
      const result = anthropicAdapter.transformStreamEvent(event);
      expect(result).not.toBeNull();

      const parsed = JSON.parse(result!);
      expect(parsed.choices[0].delta.tool_calls[0].function.arguments).toBe('{"city":');
    });
  });
});
