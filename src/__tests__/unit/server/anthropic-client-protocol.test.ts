import { describe, expect, it } from "vitest";

import { anthropicClientProtocolAdapter } from "@/server/ai/client-protocols/anthropic";

describe("anthropic client protocol adapter", () => {
  it("accepts OpenAI-style roles and null assistant content", () => {
    const result = anthropicClientProtocolAdapter.transformRequest({
      model: "GLM-5.2",
      messages: [
        { role: "system", content: "System in messages." },
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "result" },
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ],
      max_tokens: 512,
    });

    expect(result).toMatchObject({
      ok: true,
      body: {
        model: "GLM-5.2",
        max_tokens: 512,
        messages: [
          { role: "system", content: "System in messages." },
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookup", arguments: "{}" },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "result" },
          { role: "user", content: "continue" },
        ],
      },
    });
  });

  it("returns a specific validation error for unsupported content", () => {
    const result = anthropicClientProtocolAdapter.transformRequest({
      model: "GLM-5.2",
      messages: [{ role: "user", content: 42 }],
    });

    expect(result).toEqual({
      ok: false,
      statusCode: 400,
      error:
        "Invalid Anthropic Messages request body: messages[0].content must be a string, array, null, or omitted",
    });
  });
});

// ── Stream Transformer ────────────────────────────────────────────────────
//
// createStreamTransformer converts an OpenAI-format SSE stream into Anthropic
// SSE events for clients using /v1/messages. OpenAI only emits usage in the
// FINAL chunk (via stream_options.include_usage), so message_start always
// carries input_tokens: 0 — the real count must be emitted in message_delta.

interface StreamOutputEvent {
  event?: string;
  data: string;
}

function collectEvents(
  transformer: ReturnType<typeof anthropicClientProtocolAdapter.createStreamTransformer>,
  chunks: unknown[],
): StreamOutputEvent[] {
  const events: StreamOutputEvent[] = [];
  for (const chunk of chunks) {
    events.push(...transformer.transformEvent(JSON.stringify(chunk)));
  }
  events.push(...transformer.transformDone());
  return events;
}

function findEvent(events: StreamOutputEvent[], type: string): Record<string, unknown> | null {
  for (const e of events) {
    try {
      const parsed = JSON.parse(e.data) as Record<string, unknown>;
      if (parsed.type === type) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

describe("anthropicClientProtocolAdapter.createStreamTransformer", () => {
  it("emits message_delta with input_tokens from final chunk's prompt_tokens", () => {
    const transformer = anthropicClientProtocolAdapter.createStreamTransformer("gpt-4");
    const events = collectEvents(transformer, [
      {
        id: "chatcmpl-1",
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-1",
        model: "gpt-4",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      {
        id: "chatcmpl-1",
        model: "gpt-4",
        choices: [],
        usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
      },
    ]);

    const start = findEvent(events, "message_start");
    const delta = findEvent(events, "message_delta");

    // message_start emitted before usage chunk arrived — input_tokens must be 0
    expect(start?.message).toMatchObject({
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    // message_delta must carry the real input_tokens from the final chunk
    expect(delta?.usage).toEqual({ input_tokens: 42, output_tokens: 7 });
  });

  it("emits message_delta with input_tokens when upstream uses input_tokens field", () => {
    // Some OpenAI-compatible providers (DeepSeek, Moonshot, OpenRouter, ...) report
    // usage with input_tokens/output_tokens instead of prompt_tokens/completion_tokens.
    const transformer = anthropicClientProtocolAdapter.createStreamTransformer("deepseek-chat");
    const events = collectEvents(transformer, [
      {
        id: "chatcmpl-2",
        model: "deepseek-chat",
        choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }],
      },
      {
        id: "chatcmpl-2",
        model: "deepseek-chat",
        choices: [],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      },
    ]);

    const delta = findEvent(events, "message_delta");
    expect(delta?.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
  });

  it("emits message_delta with zero input_tokens when no usage chunk arrives", () => {
    const transformer = anthropicClientProtocolAdapter.createStreamTransformer("gpt-4");
    const events = collectEvents(transformer, [
      {
        id: "chatcmpl-3",
        model: "gpt-4",
        choices: [{ index: 0, delta: { content: "partial" }, finish_reason: null }],
      },
    ]);

    const delta = findEvent(events, "message_delta");
    expect(delta?.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
