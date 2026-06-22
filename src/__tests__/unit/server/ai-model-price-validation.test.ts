import { describe, expect, it } from "vitest";

import {
  batchCreateAiModelsBody,
  createAiModelBody,
  updateAiModelBody,
} from "@/server/lib/body-schemas/ai";

describe("AI model price validation", () => {
  describe("createAiModelBody", () => {
    it("accepts zero prices", () => {
      const result = createAiModelBody.safeParse({
        modelId: "glm-5.2",
        name: "GLM",
        inputPrice: "0",
        outputPrice: "0",
      });
      expect(result.success).toBe(true);
    });

    it("accepts positive decimal prices", () => {
      const result = createAiModelBody.safeParse({
        modelId: "claude-opus",
        name: "Claude",
        inputPrice: "3.5",
        outputPrice: "15",
      });
      expect(result.success).toBe(true);
    });

    it("rejects negative prices", () => {
      const result = createAiModelBody.safeParse({
        modelId: "evil-model",
        name: "Evil",
        inputPrice: "-1",
        outputPrice: "0",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-numeric prices", () => {
      const result = createAiModelBody.safeParse({
        modelId: "broken-model",
        name: "Broken",
        inputPrice: "abc",
        outputPrice: "0",
      });
      expect(result.success).toBe(false);
    });

    it("rejects prices with scientific notation", () => {
      const result = createAiModelBody.safeParse({
        modelId: "sci-model",
        name: "Sci",
        inputPrice: "1e-5",
        outputPrice: "0",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateAiModelBody", () => {
    it("rejects negative inputPrice", () => {
      const result = updateAiModelBody.safeParse({ inputPrice: "-0.5" });
      expect(result.success).toBe(false);
    });

    it("rejects non-numeric outputPrice", () => {
      const result = updateAiModelBody.safeParse({ outputPrice: "free" });
      expect(result.success).toBe(false);
    });

    it("accepts valid positive price", () => {
      const result = updateAiModelBody.safeParse({ inputPrice: "5.5" });
      expect(result.success).toBe(true);
    });
  });

  describe("batchCreateAiModelsBody", () => {
    it("rejects negative prices in batch items", () => {
      const result = batchCreateAiModelsBody.safeParse({
        models: [
          {
            modelId: "bad-model",
            name: "Bad",
            inputPrice: "-1",
            outputPrice: "0",
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid prices in batch items", () => {
      const result = batchCreateAiModelsBody.safeParse({
        models: [
          {
            modelId: "good-model",
            name: "Good",
            inputPrice: "0",
            outputPrice: "0.5",
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });
});
