/**
 * Gemini adapter — Phase 2 Wave 1a unit tests.
 *
 * Tests: URL construction (model-dependent + stream), request/response conversion,
 * streaming event transformation, usage extraction, finish reason mapping.
 */
import { describe, expect, it } from "vitest";

import { geminiAdapter } from "@/server/ai/protocol-adapters/gemini";

// ── buildUrl ────────────────────────────────────────────────────────────

describe("gemini adapter", () => {
  describe("buildUrl", () => {
    const base = "https://generativelanguage.googleapis.com/v1beta";

    it("builds non-streaming URL with model", () => {
      expect(geminiAdapter.buildUrl(base, { model: "gemini-2.5-flash", stream: false })).toBe(
        `${base}/models/gemini-2.5-flash:generateContent`,
      );
    });

    it("builds streaming URL with model and alt=sse", () => {
      expect(geminiAdapter.buildUrl(base, { model: "gemini-2.5-pro", stream: true })).toBe(
        `${base}/models/gemini-2.5-pro:streamGenerateContent?alt=sse`,
      );
    });

    it("strips trailing slash", () => {
      expect(geminiAdapter.buildUrl(`${base}/`, { model: "gemini-2.5-flash", stream: false })).toBe(
        `${base}/models/gemini-2.5-flash:generateContent`,
      );
    });
  });

  // ── transformRequest ────────────────────────────────────────────────

  describe("transformRequest", () => {
    it("converts messages to Gemini contents format", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there" },
          { role: "user", content: "How are you?" },
        ],
      }) as Record<string, unknown>;

      const contents = result.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(3);
      expect(contents[0]).toEqual({ role: "user", parts: [{ text: "Hello" }] });
      expect(contents[1]).toEqual({ role: "model", parts: [{ text: "Hi there" }] });
      expect(contents[2]).toEqual({ role: "user", parts: [{ text: "How are you?" }] });
    });

    it("extracts system message to systemInstruction", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hi" },
        ],
      }) as Record<string, unknown>;

      expect(result.systemInstruction).toEqual({ parts: [{ text: "You are helpful." }] });
      const contents = result.contents as Array<Record<string, unknown>>;
      expect(contents).toHaveLength(1);
      expect(contents[0]).toEqual({ role: "user", parts: [{ text: "Hi" }] });
    });

    it("treats developer messages as systemInstruction", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [
          { role: "developer", content: "Follow product policy." },
          { role: "user", content: "Hi" },
        ],
      }) as Record<string, unknown>;

      expect(result.systemInstruction).toEqual({ parts: [{ text: "Follow product policy." }] });
      const contents = result.contents as Array<Record<string, unknown>>;
      expect(contents).toEqual([{ role: "user", parts: [{ text: "Hi" }] }]);
    });

    it("omits systemInstruction when no system messages", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
      }) as Record<string, unknown>;

      expect(result.systemInstruction).toBeUndefined();
    });

    it("maps max_tokens to generationConfig.maxOutputTokens", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1000,
        temperature: 0.7,
        top_p: 0.9,
      }) as Record<string, unknown>;

      expect(result.generationConfig).toEqual({
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
      });
    });

    it("omits generationConfig when no params", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
      }) as Record<string, unknown>;

      expect(result.generationConfig).toBeUndefined();
    });

    it("does not include model or stream in output", () => {
      const result = geminiAdapter.transformRequest({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hi" }],
        stream: true,
      }) as Record<string, unknown>;

      expect(result.model).toBeUndefined();
      expect(result.stream).toBeUndefined();
    });
  });

  // ── transformResponse ───────────────────────────────────────────────

  describe("transformResponse", () => {
    const geminiResponse = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "Hello! How can I help?" }] },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      modelVersion: "gemini-2.5-flash-001",
    };

    it("maps to OpenAI response format", () => {
      const result = geminiAdapter.transformResponse(geminiResponse);

      expect(result.object).toBe("chat.completion");
      expect(result.model).toBe("gemini-2.5-flash-001");
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].index).toBe(0);
      expect(result.choices[0].message.role).toBe("assistant");
      expect(result.choices[0].message.content).toBe("Hello! How can I help?");
      expect(result.choices[0].finish_reason).toBe("stop");
    });

    it("maps usage correctly", () => {
      const result = geminiAdapter.transformResponse(geminiResponse);
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it("maps MAX_TOKENS to length", () => {
      const result = geminiAdapter.transformResponse({
        ...geminiResponse,
        candidates: [{ ...geminiResponse.candidates[0], finishReason: "MAX_TOKENS" }],
      });
      expect(result.choices[0].finish_reason).toBe("length");
    });

    it("maps SAFETY to content_filter", () => {
      const result = geminiAdapter.transformResponse({
        ...geminiResponse,
        candidates: [{ ...geminiResponse.candidates[0], finishReason: "SAFETY" }],
      });
      expect(result.choices[0].finish_reason).toBe("content_filter");
    });

    it("handles empty candidates", () => {
      const result = geminiAdapter.transformResponse({ candidates: [] });
      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].finish_reason).toBeNull();
    });
  });

  // ── extractUsage ────────────────────────────────────────────────────

  describe("extractUsage", () => {
    it("extracts from usageMetadata", () => {
      expect(
        geminiAdapter.extractUsage({
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
        }),
      ).toEqual({ inputTokens: 15, outputTokens: 25, totalTokens: 40 });
    });

    it("returns null when no usageMetadata", () => {
      expect(geminiAdapter.extractUsage({})).toBeNull();
    });

    it("returns null for null body", () => {
      expect(geminiAdapter.extractUsage(null)).toBeNull();
    });
  });

  // ── isStreamDone ────────────────────────────────────────────────────

  describe("isStreamDone", () => {
    it("always returns false (Gemini has no DONE signal)", () => {
      expect(geminiAdapter.isStreamDone("[DONE]")).toBe(false);
      expect(geminiAdapter.isStreamDone('{"candidates":[]}')).toBe(false);
      expect(geminiAdapter.isStreamDone("")).toBe(false);
    });
  });

  // ── extractStreamUsage ──────────────────────────────────────────────

  describe("extractStreamUsage", () => {
    it("extracts from chunk with usageMetadata", () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [{ text: "done" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 50, totalTokenCount: 60 },
      });
      expect(geminiAdapter.extractStreamUsage(data)).toEqual({
        inputTokens: 10,
        outputTokens: 50,
        totalTokens: 60,
      });
    });

    it("returns null for chunks without usageMetadata", () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [{ text: "hi" }] } }],
      });
      expect(geminiAdapter.extractStreamUsage(data)).toBeNull();
    });

    it("returns null for non-JSON", () => {
      expect(geminiAdapter.extractStreamUsage("not json")).toBeNull();
    });
  });

  // ── transformStreamEvent ────────────────────────────────────────────

  describe("transformStreamEvent", () => {
    it("converts text delta to OpenAI delta format", () => {
      const data = JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] } }],
      });
      const result = geminiAdapter.transformStreamEvent(data);
      expect(result).not.toBeNull();

      const parsed = JSON.parse(result!);
      expect(parsed.choices[0].delta.content).toBe("Hello");
      expect(parsed.choices[0].finish_reason).toBeNull();
    });

    it("includes finish_reason when present", () => {
      const data = JSON.stringify({
        candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }],
      });
      const result = geminiAdapter.transformStreamEvent(data);
      expect(result).not.toBeNull();

      const parsed = JSON.parse(result!);
      expect(parsed.choices[0].finish_reason).toBe("stop");
    });

    it("returns null for empty candidates", () => {
      expect(geminiAdapter.transformStreamEvent(JSON.stringify({ candidates: [] }))).toBeNull();
    });

    it("returns null for non-JSON", () => {
      expect(geminiAdapter.transformStreamEvent("not json")).toBeNull();
    });

    it("returns null when no parts in candidate", () => {
      const data = JSON.stringify({ candidates: [{ content: {} }] });
      expect(geminiAdapter.transformStreamEvent(data)).toBeNull();
    });
  });
});
