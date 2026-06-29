import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canConsumerAccessModel,
  filterModelsForConsumer,
  filterModelsForUserCatalog,
  isGrayModelVisibleToUser,
  isModelAllowedByConsumerKey,
  modelIdMatchesPattern,
} from "@/server/ai/lib/model-access";

const { mockIsUserAllowedForModel, mockFindUserModelIds } = vi.hoisted(() => ({
  mockIsUserAllowedForModel: vi.fn(),
  mockFindUserModelIds: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiModelGrayUserRepo: {
    isUserAllowedForModel: (...args: unknown[]) => mockIsUserAllowedForModel(...args),
    findUserModelIds: (...args: unknown[]) => mockFindUserModelIds(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("model access helpers", () => {
  it("matches exact and wildcard model patterns", () => {
    expect(modelIdMatchesPattern("gpt-4o", "gpt-4o")).toBe(true);
    expect(modelIdMatchesPattern("gpt-4o-mini", "gpt-*")).toBe(true);
    expect(modelIdMatchesPattern("claude-sonnet", "gpt-*")).toBe(false);
  });

  it("treats empty consumer key ACL as open access", () => {
    expect(isModelAllowedByConsumerKey("gpt-4o", [])).toBe(true);
  });

  it("enforces consumer key ACL patterns", () => {
    expect(isModelAllowedByConsumerKey("gpt-4o-mini", ["gpt-*"])).toBe(true);
    expect(isModelAllowedByConsumerKey("claude-sonnet", ["gpt-*"])).toBe(false);
  });

  it("keeps public models visible regardless of gray whitelist", () => {
    expect(
      isGrayModelVisibleToUser({ id: 1, grayReleaseEnabled: false }, null, new Set<number>()),
    ).toBe(true);
  });

  it("requires a whitelisted user for gray models", () => {
    const model = { id: 2, grayReleaseEnabled: true };

    expect(isGrayModelVisibleToUser(model, null, new Set([2]))).toBe(false);
    expect(isGrayModelVisibleToUser(model, 10, new Set([3]))).toBe(false);
    expect(isGrayModelVisibleToUser(model, 10, new Set([2]))).toBe(true);
  });

  it("denies before DB lookup when key ACL does not allow the model", async () => {
    const decision = await canConsumerAccessModel(
      { allowedModels: ["claude-*"], userId: 10 },
      { id: 1, modelId: "gpt-4o", grayReleaseEnabled: true },
    );

    expect(decision).toEqual({ allowed: false, reason: "key_acl" });
    expect(mockIsUserAllowedForModel).not.toHaveBeenCalled();
  });

  it("allows public models without gray lookup", async () => {
    const decision = await canConsumerAccessModel(
      { allowedModels: [], userId: null },
      { id: 1, modelId: "gpt-4o", grayReleaseEnabled: false },
    );

    expect(decision).toEqual({ allowed: true });
    expect(mockIsUserAllowedForModel).not.toHaveBeenCalled();
  });

  it("denies gray models for orphan consumer keys", async () => {
    const decision = await canConsumerAccessModel(
      { allowedModels: [], userId: null },
      { id: 1, modelId: "gpt-4o", grayReleaseEnabled: true },
    );

    expect(decision).toEqual({ allowed: false, reason: "gray_release" });
    expect(mockIsUserAllowedForModel).not.toHaveBeenCalled();
  });

  it("checks gray whitelist for user-owned consumer keys", async () => {
    mockIsUserAllowedForModel.mockResolvedValueOnce(true);

    const decision = await canConsumerAccessModel(
      { allowedModels: ["gpt-*"], userId: 10 },
      { id: 1, modelId: "gpt-4o", grayReleaseEnabled: true },
    );

    expect(decision).toEqual({ allowed: true });
    expect(mockIsUserAllowedForModel).toHaveBeenCalledWith(1, 10);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

type PartialRow = { model: { id: number; modelId: string; grayReleaseEnabled: boolean } };

function row(id: number, modelId: string, gray = false): PartialRow {
  return { model: { id, modelId, grayReleaseEnabled: gray } };
}

describe("filterModelsForConsumer", () => {
  it("returns all public models when consumer has no ACL", async () => {
    const rows = [row(1, "gpt-4o"), row(2, "claude-sonnet")];
    const result = await filterModelsForConsumer(
      rows as Parameters<typeof filterModelsForConsumer>[0],
      { allowedModels: [], userId: null },
    );
    expect(result).toHaveLength(2);
    expect(mockFindUserModelIds).not.toHaveBeenCalled();
  });

  it("filters models not matching ACL patterns", async () => {
    const rows = [row(1, "gpt-4o"), row(2, "claude-sonnet")];
    const result = await filterModelsForConsumer(
      rows as Parameters<typeof filterModelsForConsumer>[0],
      { allowedModels: ["gpt-*"], userId: null },
    );
    expect(result).toHaveLength(1);
    expect(result[0].model.modelId).toBe("gpt-4o");
  });

  it("excludes gray models for anonymous consumers (no userId)", async () => {
    const rows = [row(1, "gpt-4o"), row(2, "nova", true)];
    const result = await filterModelsForConsumer(
      rows as Parameters<typeof filterModelsForConsumer>[0],
      { allowedModels: [], userId: null },
    );
    expect(result).toHaveLength(1);
    expect(result[0].model.id).toBe(1);
    expect(mockFindUserModelIds).not.toHaveBeenCalled();
  });

  it("excludes gray models when user is not in the whitelist", async () => {
    mockFindUserModelIds.mockResolvedValueOnce(new Set<number>());
    const rows = [row(1, "gpt-4o"), row(2, "nova", true)];
    const result = await filterModelsForConsumer(
      rows as Parameters<typeof filterModelsForConsumer>[0],
      { allowedModels: [], userId: 10 },
    );
    expect(result).toHaveLength(1);
    expect(mockFindUserModelIds).toHaveBeenCalledWith(10, [2]);
  });

  it("includes gray models when user is whitelisted", async () => {
    mockFindUserModelIds.mockResolvedValueOnce(new Set([2]));
    const rows = [row(1, "gpt-4o"), row(2, "nova", true)];
    const result = await filterModelsForConsumer(
      rows as Parameters<typeof filterModelsForConsumer>[0],
      { allowedModels: [], userId: 10 },
    );
    expect(result).toHaveLength(2);
  });

  it("does not query DB when there are no gray models in the list", async () => {
    const rows = [row(1, "gpt-4o"), row(2, "claude-sonnet")];
    await filterModelsForConsumer(rows as Parameters<typeof filterModelsForConsumer>[0], {
      allowedModels: [],
      userId: 5,
    });
    expect(mockFindUserModelIds).not.toHaveBeenCalled();
  });
});

describe("filterModelsForUserCatalog", () => {
  it("excludes gray models even when they are limited-free", () => {
    const rows = [
      {
        model: {
          id: 1,
          modelId: "gpt-4o",
          grayReleaseEnabled: false,
          limitedFreeUntil: null,
        },
      },
      {
        model: {
          id: 2,
          modelId: "glm-5.2",
          grayReleaseEnabled: true,
          limitedFreeUntil: new Date("2026-07-01T00:00:00Z"),
        },
      },
    ];

    const result = filterModelsForUserCatalog(rows);

    expect(result).toHaveLength(1);
    expect(result[0].model.modelId).toBe("gpt-4o");
  });
});
