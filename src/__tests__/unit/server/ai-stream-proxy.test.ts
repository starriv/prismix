/**
 * AI Stream Proxy — Phase 1.1 unit tests.
 *
 * Tests: SSE frame parsing, data line extraction, stream integration with adapter.
 */
import { describe, expect, it, vi } from "vitest";

import {
  extractDataLine,
  extractPassthroughUsage,
  extractStreamUsageUniversal,
  splitSSEFrames,
} from "@/server/ai/lib/stream-proxy";
import { openaiAdapter } from "@/server/ai/providers/openai";

// Mock write-queue to avoid transitive DB/Redis initialization
vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: vi.fn(),
  registerWriteHandler: vi.fn(),
}));

// Mock logger to avoid side effects
vi.mock("@/server/lib/logger", () => ({
  log: { gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

// ── SSE Frame Parsing ───────────────────────────────────────────────────

describe("splitSSEFrames", () => {
  it("splits complete frames on double newline", () => {
    const buffer = 'data: {"a":1}\n\ndata: {"b":2}\n\n';
    const result = splitSSEFrames(buffer);
    expect(result.complete).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(result.remainder).toBe("");
  });

  it("keeps incomplete frame as remainder", () => {
    const buffer = 'data: {"a":1}\n\ndata: {"b":2';
    const result = splitSSEFrames(buffer);
    expect(result.complete).toEqual(['data: {"a":1}']);
    expect(result.remainder).toBe('data: {"b":2');
  });

  it("handles empty buffer", () => {
    const result = splitSSEFrames("");
    expect(result.complete).toEqual([]);
    expect(result.remainder).toBe("");
  });

  it("handles buffer with only newlines", () => {
    const result = splitSSEFrames("\n\n");
    expect(result.complete).toEqual([]);
    expect(result.remainder).toBe("");
  });

  it("handles single complete frame", () => {
    const buffer = "data: hello\n\n";
    const result = splitSSEFrames(buffer);
    expect(result.complete).toEqual(["data: hello"]);
    expect(result.remainder).toBe("");
  });

  it("handles frame with event + data fields", () => {
    const buffer = "event: message\ndata: hello\n\n";
    const result = splitSSEFrames(buffer);
    expect(result.complete).toEqual(["event: message\ndata: hello"]);
    expect(result.remainder).toBe("");
  });

  it("handles multiple chunks accumulated", () => {
    // Simulate two chunks arriving
    let buffer = 'data: {"chunk":1}\n\ndata: {"chu';
    const r1 = splitSSEFrames(buffer);
    expect(r1.complete).toEqual(['data: {"chunk":1}']);

    // Second chunk completes the frame
    buffer = r1.remainder + 'nk":2}\n\n';
    const r2 = splitSSEFrames(buffer);
    expect(r2.complete).toEqual(['data: {"chunk":2}']);
    expect(r2.remainder).toBe("");
  });
});

// ── Data Line Extraction ────────────────────────────────────────────────

describe("extractDataLine", () => {
  it("extracts data from a simple data: line", () => {
    expect(extractDataLine('data: {"choices":[]}')).toBe('{"choices":[]}');
  });

  it("extracts data without space after colon", () => {
    expect(extractDataLine("data:[DONE]")).toBe("[DONE]");
  });

  it("returns null for frames without data line", () => {
    expect(extractDataLine("event: ping")).toBeNull();
    expect(extractDataLine(": comment")).toBeNull();
  });

  it("concatenates multi-line data fields", () => {
    const frame = "data: line1\ndata: line2";
    expect(extractDataLine(frame)).toBe("line1\nline2");
  });

  it("handles frame with event + data", () => {
    const frame = "event: message\ndata: hello";
    expect(extractDataLine(frame)).toBe("hello");
  });

  it("handles empty data field", () => {
    expect(extractDataLine("data: ")).toBe("");
  });

  it("returns null for empty frame", () => {
    expect(extractDataLine("")).toBeNull();
  });
});

// ── Passthrough Usage Extraction ───────────────────────────────────────────

describe("extractPassthroughUsage", () => {
  it("extracts OpenAI usage (prompt_tokens / completion_tokens)", () => {
    const body = JSON.stringify({
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    expect(extractPassthroughUsage(body)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("extracts Anthropic usage (input_tokens / output_tokens)", () => {
    const body = JSON.stringify({
      usage: { input_tokens: 9, output_tokens: 4 },
    });
    expect(extractPassthroughUsage(body)).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      totalTokens: 13,
    });
  });

  it("extracts OpenAI Responses API usage (response.usage)", () => {
    const body = JSON.stringify({
      type: "response.completed",
      response: { usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 } },
    });
    expect(extractPassthroughUsage(body)).toEqual({
      inputTokens: 8,
      outputTokens: 5,
      totalTokens: 13,
    });
  });

  it("returns null when no usage field", () => {
    expect(extractPassthroughUsage(JSON.stringify({ choices: [] }))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(extractPassthroughUsage("not json")).toBeNull();
  });

  it("returns null when all token counts are zero", () => {
    const body = JSON.stringify({ usage: { prompt_tokens: 0, completion_tokens: 0 } });
    expect(extractPassthroughUsage(body)).toBeNull();
  });

  it("handles Anthropic response with extra fields", () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 15,
        output_tokens: 8,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
    expect(extractPassthroughUsage(body)).toEqual({
      inputTokens: 15,
      outputTokens: 8,
      totalTokens: 23,
    });
  });

  it("prefers OpenAI fields when both shapes present", () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        input_tokens: 10,
        output_tokens: 5,
      },
    });
    const result = extractPassthroughUsage(body);
    expect(result).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
});

// ── Universal Stream Usage Extraction ──────────────────────────────────────

describe("extractStreamUsageUniversal", () => {
  it("extracts OpenAI usage from final stream chunk", () => {
    const data = JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
    });
    expect(extractStreamUsageUniversal(data)).toEqual({
      inputTokens: 9,
      outputTokens: 5,
      totalTokens: 14,
    });
  });

  it("returns null for OpenAI content chunks without usage", () => {
    const data = JSON.stringify({
      choices: [{ delta: { content: "hi" } }],
    });
    expect(extractStreamUsageUniversal(data)).toBeNull();
  });

  it("extracts Anthropic input_tokens from message_start", () => {
    const data = JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: 12, output_tokens: 0 } },
    });
    expect(extractStreamUsageUniversal(data)).toEqual({
      inputTokens: 12,
      outputTokens: 0,
      totalTokens: 12,
    });
  });

  it("extracts Anthropic output_tokens from message_delta (ignores cumulative input_tokens)", () => {
    const data = JSON.stringify({
      type: "message_delta",
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    // message_delta.usage.input_tokens is cumulative — must be ignored
    expect(extractStreamUsageUniversal(data)).toEqual({
      inputTokens: 0,
      outputTokens: 7,
      totalTokens: 7,
    });
  });

  it("returns null for Anthropic content_block_delta", () => {
    const data = JSON.stringify({
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hi" },
    });
    expect(extractStreamUsageUniversal(data)).toBeNull();
  });

  it("returns null for Anthropic message_stop", () => {
    expect(extractStreamUsageUniversal(JSON.stringify({ type: "message_stop" }))).toBeNull();
  });

  it("returns null for Anthropic ping", () => {
    expect(extractStreamUsageUniversal(JSON.stringify({ type: "ping" }))).toBeNull();
  });

  it("extracts OpenAI Responses API usage from response.completed", () => {
    const data = JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_123",
        status: "completed",
        usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
      },
    });
    expect(extractStreamUsageUniversal(data)).toEqual({
      inputTokens: 8,
      outputTokens: 5,
      totalTokens: 13,
    });
  });

  it("returns null for OpenAI Responses API non-terminal events", () => {
    const data = JSON.stringify({
      type: "response.output_text.delta",
      delta: "hello",
    });
    expect(extractStreamUsageUniversal(data)).toBeNull();
  });

  it("extracts Gemini usageMetadata", () => {
    const data = JSON.stringify({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
    });
    expect(extractStreamUsageUniversal(data)).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
  });

  it("returns null for [DONE] string", () => {
    expect(extractStreamUsageUniversal("[DONE]")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractStreamUsageUniversal("")).toBeNull();
  });

  it("accumulates correctly across Anthropic frames (no double-count)", () => {
    // Simulate real Anthropic SSE: message_delta.usage.input_tokens is cumulative repeat
    const frames = [
      JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 15, output_tokens: 0 } },
      }),
      JSON.stringify({ type: "content_block_delta", delta: { text: "Yes" } }),
      JSON.stringify({
        type: "message_delta",
        usage: { input_tokens: 15, output_tokens: 4 },
      }),
      JSON.stringify({ type: "message_stop" }),
    ];

    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
    for (const frame of frames) {
      const frameUsage = extractStreamUsageUniversal(frame);
      if (frameUsage) {
        usage = usage
          ? {
              inputTokens: usage.inputTokens + frameUsage.inputTokens,
              outputTokens: usage.outputTokens + frameUsage.outputTokens,
              totalTokens: usage.totalTokens + frameUsage.totalTokens,
            }
          : frameUsage;
      }
    }

    // input=15 (from message_start only), output=4 (from message_delta only)
    expect(usage).toEqual({ inputTokens: 15, outputTokens: 4, totalTokens: 19 });
  });
});

// ── OpenAI adapter: stream_options injection ──────────────────────────────

describe("openaiAdapter.transformRequest", () => {
  it("injects stream_options when stream is true", () => {
    const body = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi" }],
      stream: true,
    };
    const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
    expect(result.stream_options).toEqual({ include_usage: true });
    expect(result.model).toBe("gpt-4");
    expect(result.stream).toBe(true);
  });

  it("does not inject stream_options when stream is false/absent", () => {
    const body = { model: "gpt-4", messages: [{ role: "user" as const, content: "hi" }] };
    const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
    expect(result.stream_options).toBeUndefined();
  });

  it("preserves existing body fields when injecting stream_options", () => {
    const body = {
      model: "gpt-4",
      messages: [{ role: "user" as const, content: "hi" }],
      stream: true,
      temperature: 0.7,
      max_tokens: 100,
    };
    const result = openaiAdapter.transformRequest(body) as Record<string, unknown>;
    expect(result.temperature).toBe(0.7);
    expect(result.max_tokens).toBe(100);
    expect(result.stream_options).toEqual({ include_usage: true });
  });
});

// ── End-to-end SSE parsing with OpenAI adapter ──────────────────────────

describe("SSE stream processing with OpenAI adapter", () => {
  it("detects [DONE] from parsed SSE data", () => {
    const rawSSE = "data: [DONE]\n\n";
    const { complete } = splitSSEFrames(rawSSE);
    const data = extractDataLine(complete[0]!);
    expect(data).toBe("[DONE]");
    expect(openaiAdapter.isStreamDone(data!)).toBe(true);
  });

  it("extracts usage from final chunk before [DONE]", () => {
    const sseStream = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}\n\n',
      "data: [DONE]\n\n",
    ].join("");

    const { complete } = splitSSEFrames(sseStream);
    expect(complete).toHaveLength(3);

    // First chunk: content, no usage
    const data1 = extractDataLine(complete[0]!);
    expect(openaiAdapter.extractStreamUsage(data1!)).toBeNull();
    expect(openaiAdapter.isStreamDone(data1!)).toBe(false);

    // Second chunk: usage present
    const data2 = extractDataLine(complete[1]!);
    expect(openaiAdapter.extractStreamUsage(data2!)).toEqual({
      inputTokens: 5,
      outputTokens: 10,
      totalTokens: 15,
    });
    expect(openaiAdapter.isStreamDone(data2!)).toBe(false);

    // Third chunk: [DONE]
    const data3 = extractDataLine(complete[2]!);
    expect(openaiAdapter.isStreamDone(data3!)).toBe(true);
  });

  it("transforms stream events via passthrough adapter", () => {
    const data = '{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}';
    const transformed = openaiAdapter.transformStreamEvent(data);
    expect(transformed).toBe(data); // OpenAI adapter is passthrough
  });

  it("handles partial chunks that split across reads", () => {
    // Simulate a chunk boundary in the middle of a frame
    const chunk1 = 'data: {"id":"chatcmpl-1","choi';
    const chunk2 = 'ces":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n';

    const r1 = splitSSEFrames(chunk1);
    expect(r1.complete).toEqual([]);
    expect(r1.remainder).toBe('data: {"id":"chatcmpl-1","choi');

    const r2 = splitSSEFrames(r1.remainder + chunk2);
    expect(r2.complete).toHaveLength(2);

    const data1 = extractDataLine(r2.complete[0]!);
    expect(data1).toBe('{"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"}}]}');

    const data2 = extractDataLine(r2.complete[1]!);
    expect(openaiAdapter.isStreamDone(data2!)).toBe(true);
  });
});
