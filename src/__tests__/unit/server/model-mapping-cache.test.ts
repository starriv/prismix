import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindEnabledByUpstreamId = vi.fn();

vi.mock("@/server/repos", () => ({
  aiUpstreamModelMappingRepo: {
    findEnabledByUpstreamId: (...args: unknown[]) => mockFindEnabledByUpstreamId(...args),
  },
}));

const { resolveModelMapping, invalidateModelMappingCache } =
  await import("@/server/ai/lib/model-mapping-cache");

describe("model mapping cache", () => {
  beforeEach(() => {
    mockFindEnabledByUpstreamId.mockReset();
    invalidateModelMappingCache(11);
    invalidateModelMappingCache(22);
  });

  it("returns mapped model ID when mapping exists", async () => {
    mockFindEnabledByUpstreamId.mockResolvedValue([
      {
        id: 1,
        upstreamId: 11,
        sourceModelId: "claude-opus-4-7",
        mappedModelId: "kiro/opus04.7",
        enabled: true,
      },
    ]);

    const result = await resolveModelMapping(11, "claude-opus-4-7");
    expect(result).toBe("kiro/opus04.7");
    expect(mockFindEnabledByUpstreamId).toHaveBeenCalledWith(11);
  });

  it("returns original model ID when no mapping exists", async () => {
    mockFindEnabledByUpstreamId.mockResolvedValue([]);

    const result = await resolveModelMapping(11, "gpt-4o");
    expect(result).toBe("gpt-4o");
  });

  it("returns original model ID when upstreamId is null", async () => {
    const result = await resolveModelMapping(null, "claude-opus-4-7");
    expect(result).toBe("claude-opus-4-7");
    expect(mockFindEnabledByUpstreamId).not.toHaveBeenCalled();
  });

  it("caches mappings and does not re-query within TTL", async () => {
    mockFindEnabledByUpstreamId.mockResolvedValue([
      {
        id: 1,
        upstreamId: 11,
        sourceModelId: "claude-opus-4-7",
        mappedModelId: "kiro/opus04.7",
        enabled: true,
      },
    ]);

    await resolveModelMapping(11, "claude-opus-4-7");
    await resolveModelMapping(11, "claude-opus-4-7");
    expect(mockFindEnabledByUpstreamId).toHaveBeenCalledTimes(1);
  });

  it("re-queries after cache invalidation", async () => {
    mockFindEnabledByUpstreamId.mockResolvedValue([
      {
        id: 1,
        upstreamId: 11,
        sourceModelId: "claude-opus-4-7",
        mappedModelId: "kiro/opus04.7",
        enabled: true,
      },
    ]);

    await resolveModelMapping(11, "claude-opus-4-7");
    invalidateModelMappingCache(11);

    mockFindEnabledByUpstreamId.mockResolvedValue([
      {
        id: 1,
        upstreamId: 11,
        sourceModelId: "claude-opus-4-7",
        mappedModelId: "kiro/opus05.0",
        enabled: true,
      },
    ]);

    const result = await resolveModelMapping(11, "claude-opus-4-7");
    expect(result).toBe("kiro/opus05.0");
    expect(mockFindEnabledByUpstreamId).toHaveBeenCalledTimes(2);
  });

  it("handles multiple upstreams independently", async () => {
    mockFindEnabledByUpstreamId
      .mockResolvedValueOnce([
        {
          id: 1,
          upstreamId: 11,
          sourceModelId: "claude-opus-4-7",
          mappedModelId: "kiro/opus04.7",
          enabled: true,
        },
      ])
      .mockResolvedValueOnce([]);

    const r1 = await resolveModelMapping(11, "claude-opus-4-7");
    const r2 = await resolveModelMapping(22, "claude-opus-4-7");

    expect(r1).toBe("kiro/opus04.7");
    expect(r2).toBe("claude-opus-4-7");
  });
});
