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
