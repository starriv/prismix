import { describe, expect, it } from "vitest";

import { _parseAndIndex, _resolveEntry, _toPerMTok } from "@/server/ai/lib/litellm-pricing";

describe("litellm-pricing", () => {
  // ── toPerMTok ──────────────────────────────────────────────────────

  describe("toPerMTok", () => {
    it("converts per-token cost to per-MTok string", () => {
      expect(_toPerMTok(2.5e-6)).toBe("2.5"); // GPT-4o input: $2.50/MTok
      expect(_toPerMTok(1e-5)).toBe("10"); // GPT-4o output: $10/MTok
      expect(_toPerMTok(1.5e-7)).toBe("0.15"); // GPT-4o-mini input: $0.15/MTok
    });

    it("returns '0' for null/undefined/zero", () => {
      expect(_toPerMTok(null)).toBe("0");
      expect(_toPerMTok(undefined)).toBe("0");
      expect(_toPerMTok(0)).toBe("0");
    });

    it("handles very small costs (DeepSeek)", () => {
      expect(_toPerMTok(2.8e-7)).toBe("0.28"); // DeepSeek input: $0.28/MTok
      expect(_toPerMTok(4.2e-7)).toBe("0.42"); // DeepSeek output: $0.42/MTok
    });
  });

  // ── resolveEntry ───────────────────────────────────────────────────

  describe("resolveEntry", () => {
    it("resolves unprefixed OpenAI model", () => {
      const result = _resolveEntry("gpt-4o", {
        litellm_provider: "openai",
        mode: "chat",
        input_cost_per_token: 2.5e-6,
      });
      expect(result).toEqual({ modelId: "gpt-4o", provider: "openai" });
    });

    it("resolves unprefixed Anthropic model", () => {
      const result = _resolveEntry("claude-sonnet-4-6", {
        litellm_provider: "anthropic",
        mode: "chat",
        input_cost_per_token: 3e-6,
      });
      expect(result).toEqual({ modelId: "claude-sonnet-4-6", provider: "anthropic" });
    });

    it("resolves prefixed Groq model", () => {
      const result = _resolveEntry("groq/llama-3.3-70b-versatile", {
        litellm_provider: "groq",
        mode: "chat",
        input_cost_per_token: 5.9e-7,
      });
      expect(result).toEqual({ modelId: "llama-3.3-70b-versatile", provider: "groq" });
    });

    it("resolves prefixed Gemini model to google", () => {
      const result = _resolveEntry("gemini/gemini-2.5-pro", {
        litellm_provider: "gemini",
        mode: "chat",
        input_cost_per_token: 1.25e-6,
      });
      expect(result).toEqual({ modelId: "gemini-2.5-pro", provider: "google" });
    });

    it("resolves prefixed DeepSeek model", () => {
      const result = _resolveEntry("deepseek/deepseek-chat", {
        litellm_provider: "deepseek",
        mode: "chat",
        input_cost_per_token: 2.8e-7,
      });
      expect(result).toEqual({ modelId: "deepseek-chat", provider: "deepseek" });
    });

    it("returns null for non-chat mode", () => {
      const result = _resolveEntry("dall-e-3", {
        litellm_provider: "openai",
        mode: "image_generation",
        input_cost_per_token: 0,
      });
      expect(result).toBeNull();
    });

    it("returns null for unsupported provider", () => {
      const result = _resolveEntry("azure/gpt-4o", {
        litellm_provider: "azure",
        mode: "chat",
        input_cost_per_token: 2.5e-6,
      });
      expect(result).toBeNull();
    });

    it("returns null for entries without pricing", () => {
      const result = _resolveEntry("gpt-4o", {
        litellm_provider: "openai",
        mode: "chat",
      });
      expect(result).toBeNull();
    });
  });

  // ── parseAndIndex ──────────────────────────────────────────────────

  describe("parseAndIndex", () => {
    const sampleData = {
      sample_spec: {} as Record<string, unknown>,
      "gpt-4o": {
        input_cost_per_token: 2.5e-6,
        output_cost_per_token: 1e-5,
        max_input_tokens: 128000,
        max_output_tokens: 16384,
        litellm_provider: "openai",
        mode: "chat",
        supports_vision: true,
        supports_function_calling: true,
      },
      "gpt-4o-mini": {
        input_cost_per_token: 1.5e-7,
        output_cost_per_token: 6e-7,
        max_input_tokens: 128000,
        max_output_tokens: 16384,
        litellm_provider: "openai",
        mode: "chat",
        supports_function_calling: true,
      },
      "claude-sonnet-4-6": {
        input_cost_per_token: 3e-6,
        output_cost_per_token: 1.5e-5,
        max_input_tokens: 1000000,
        max_output_tokens: 64000,
        litellm_provider: "anthropic",
        mode: "chat",
        supports_vision: true,
        supports_function_calling: true,
        supports_reasoning: true,
      },
      "gemini/gemini-2.5-flash": {
        input_cost_per_token: 3e-7,
        output_cost_per_token: 2.5e-6,
        max_input_tokens: 1048576,
        max_output_tokens: 65535,
        litellm_provider: "gemini",
        mode: "chat",
        supports_vision: true,
      },
      "deepseek/deepseek-chat": {
        input_cost_per_token: 2.8e-7,
        output_cost_per_token: 4.2e-7,
        max_input_tokens: 131072,
        max_output_tokens: 8192,
        litellm_provider: "deepseek",
        mode: "chat",
      },
      "dall-e-3": {
        input_cost_per_token: 0,
        litellm_provider: "openai",
        mode: "image_generation",
      },
      "azure/gpt-4o": {
        input_cost_per_token: 2.75e-6,
        output_cost_per_token: 1.1e-5,
        litellm_provider: "azure",
        mode: "chat",
      },
    };

    it("indexes chat models and skips non-chat / unsupported providers", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap, providerMap, count } = _parseAndIndex(sampleData as any);

      // 5 chat models from supported providers (gpt-4o, gpt-4o-mini, claude, gemini, deepseek)
      // dall-e-3 skipped (image_generation), azure/gpt-4o skipped (unsupported prefix)
      expect(count).toBe(5);
      expect(modelMap.size).toBe(5);
      expect(providerMap.size).toBe(4); // openai, anthropic, google, deepseek
    });

    it("correctly maps OpenAI model pricing", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap } = _parseAndIndex(sampleData as any);

      const gpt4o = modelMap.get("openai:gpt-4o");
      expect(gpt4o).toBeDefined();
      expect(gpt4o!.inputPricePerMTok).toBe("2.5");
      expect(gpt4o!.outputPricePerMTok).toBe("10");
      expect(gpt4o!.contextWindow).toBe(128000);
      expect(gpt4o!.capabilities).toContain("chat");
      expect(gpt4o!.capabilities).toContain("vision");
      expect(gpt4o!.capabilities).toContain("tools");
      expect(gpt4o!.capabilities).toContain("streaming");
    });

    it("correctly maps Anthropic model with reasoning", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap } = _parseAndIndex(sampleData as any);

      const claude = modelMap.get("anthropic:claude-sonnet-4-6");
      expect(claude).toBeDefined();
      expect(claude!.inputPricePerMTok).toBe("3");
      expect(claude!.outputPricePerMTok).toBe("15");
      expect(claude!.contextWindow).toBe(1000000);
      expect(claude!.capabilities).toContain("reasoning");
    });

    it("correctly strips prefix for Gemini", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap } = _parseAndIndex(sampleData as any);

      const gemini = modelMap.get("google:gemini-2.5-flash");
      expect(gemini).toBeDefined();
      expect(gemini!.modelId).toBe("gemini-2.5-flash");
      expect(gemini!.provider).toBe("google");
      expect(gemini!.inputPricePerMTok).toBe("0.3");
      expect(gemini!.outputPricePerMTok).toBe("2.5");
    });

    it("correctly strips prefix for DeepSeek", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap } = _parseAndIndex(sampleData as any);

      const ds = modelMap.get("deepseek:deepseek-chat");
      expect(ds).toBeDefined();
      expect(ds!.modelId).toBe("deepseek-chat");
      expect(ds!.inputPricePerMTok).toBe("0.28");
      expect(ds!.outputPricePerMTok).toBe("0.42");
      expect(ds!.contextWindow).toBe(131072);
    });

    it("groups models by provider correctly", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { providerMap } = _parseAndIndex(sampleData as any);

      expect(providerMap.get("openai")?.length).toBe(2); // gpt-4o + gpt-4o-mini
      expect(providerMap.get("anthropic")?.length).toBe(1);
      expect(providerMap.get("google")?.length).toBe(1);
      expect(providerMap.get("deepseek")?.length).toBe(1);
      expect(providerMap.get("groq")).toBeUndefined(); // no groq in sample
    });

    it("skips sample_spec entry", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { modelMap } = _parseAndIndex(sampleData as any);
      for (const [key] of modelMap) {
        expect(key).not.toContain("sample_spec");
      }
    });

    it("first entry wins for duplicate provider:model keys", () => {
      const dupeData = {
        "gpt-4o": {
          input_cost_per_token: 2.5e-6,
          output_cost_per_token: 1e-5,
          max_input_tokens: 128000,
          litellm_provider: "openai",
          mode: "chat",
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = _parseAndIndex(dupeData as any);
      expect(count).toBe(1);
    });
  });
});
