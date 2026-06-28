/**
 * Azure OpenAI adapter — Phase 2 Wave 1b unit tests.
 *
 * Only buildUrl has custom logic; all transform methods delegate to openaiAdapter.
 */
import { describe, expect, it } from "vitest";

import { azureOpenaiAdapter } from "@/server/ai/protocol-adapters/azure-openai";

describe("azure-openai adapter", () => {
  describe("buildUrl", () => {
    const base = "https://my-resource.openai.azure.com";

    it("builds deployment URL with model and api-version", () => {
      expect(azureOpenaiAdapter.buildUrl(base, { model: "gpt-4o", stream: false })).toBe(
        `${base}/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01`,
      );
    });

    it("uses same URL for streaming (SSE is transparent)", () => {
      expect(azureOpenaiAdapter.buildUrl(base, { model: "gpt-4o", stream: true })).toBe(
        `${base}/openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01`,
      );
    });

    it("strips trailing slash", () => {
      expect(azureOpenaiAdapter.buildUrl(`${base}/`, { model: "gpt-4", stream: false })).toBe(
        `${base}/openai/deployments/gpt-4/chat/completions?api-version=2024-02-01`,
      );
    });

    it("handles deployment names with dots", () => {
      expect(azureOpenaiAdapter.buildUrl(base, { model: "gpt-4o-2024-05-13", stream: false })).toBe(
        `${base}/openai/deployments/gpt-4o-2024-05-13/chat/completions?api-version=2024-02-01`,
      );
    });
  });

  it("has format azure-openai", () => {
    expect(azureOpenaiAdapter.format).toBe("azure-openai");
  });

  it("delegates extractUsage to openai adapter", () => {
    const body = { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } };
    expect(azureOpenaiAdapter.extractUsage(body)).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("delegates isStreamDone to openai adapter", () => {
    expect(azureOpenaiAdapter.isStreamDone("[DONE]")).toBe(true);
    expect(azureOpenaiAdapter.isStreamDone('{"choices":[]}')).toBe(false);
  });
});
