import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepos = vi.hoisted(() => ({
  findBalancerConfig: vi.fn(),
  findEnabledByProvider: vi.fn(),
  findEnabledByUpstream: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiProviderRepo: {
    findBalancerConfig: mockRepos.findBalancerConfig,
  },
  aiKeyRepo: {
    findEnabledByProvider: mockRepos.findEnabledByProvider,
    findEnabledByUpstream: mockRepos.findEnabledByUpstream,
  },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    pricing: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

describe("key balancer health weighting", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRepos.findBalancerConfig.mockReset();
    mockRepos.findEnabledByProvider.mockReset();
    mockRepos.findEnabledByUpstream.mockReset();
    mockRepos.findBalancerConfig.mockResolvedValue({ loadBalanceStrategy: "round-robin" });
    mockRepos.findEnabledByProvider.mockResolvedValue([
      { id: 1, name: "key-1", weight: 4 },
      { id: 2, name: "key-2", weight: 4 },
    ]);
    mockRepos.findEnabledByUpstream.mockResolvedValue([{ id: 3, name: "upstream-key", weight: 1 }]);
  });

  it("soft-degrades a repeatedly failing key instead of removing it", async () => {
    const { clearAllPools, getKeyHealthSnapshot, markKeyFailure, pickKey } =
      await import("@/server/ai/lib/key-balancer");

    clearAllPools();

    const first = await pickKey(10);
    expect(first?.id).toBe(1);

    markKeyFailure(1);
    markKeyFailure(1);

    const second = await pickKey(10);
    expect(second?.id).toBe(2);

    const health = getKeyHealthSnapshot(1);
    expect(health?.consecutiveFailures).toBe(2);
    expect((health?.penaltyUntil ?? 0) > Date.now()).toBe(true);
  });

  it("clears penalty state after a success", async () => {
    const { clearAllPools, getKeyHealthSnapshot, markKeyFailure, markKeySuccess } =
      await import("@/server/ai/lib/key-balancer");

    clearAllPools();
    markKeyFailure(1);
    markKeyFailure(1);
    expect(getKeyHealthSnapshot(1)?.consecutiveFailures).toBe(2);

    markKeySuccess(1);
    const health = getKeyHealthSnapshot(1);
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.penaltyUntil).toBe(0);
    expect(health?.totalSuccesses).toBe(1);
  });

  it("exposes penalized keys in pool info", async () => {
    const { clearAllPools, getPoolInfo, markKeyFailure } =
      await import("@/server/ai/lib/key-balancer");

    clearAllPools();
    markKeyFailure(2);

    const info = await getPoolInfo(10);
    expect(info.keyIds).toEqual([1, 2]);
    expect(info.penalizedKeyIds).toContain(2);
  });

  it("reloads an empty cached pool so direct DB repairs become visible", async () => {
    vi.useFakeTimers();
    mockRepos.findEnabledByProvider
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 3, name: "restored-key", weight: 1 }]);

    const { clearAllPools, pickKey } = await import("@/server/ai/lib/key-balancer");

    clearAllPools();

    try {
      expect(await pickKey(10)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pickKey(10))?.id).toBe(3);
      expect(mockRepos.findEnabledByProvider).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent loads for the same provider pool", async () => {
    let resolveRows: (rows: Array<{ id: number; name: string; weight: number }>) => void = () => {};
    const rowsPromise = new Promise<Array<{ id: number; name: string; weight: number }>>(
      (resolve) => {
        resolveRows = resolve;
      },
    );
    mockRepos.findEnabledByProvider.mockReturnValue(rowsPromise);

    const { clearAllPools, pickKey } = await import("@/server/ai/lib/key-balancer");

    clearAllPools();
    const first = pickKey(10);
    const second = pickKey(10);

    resolveRows([{ id: 4, name: "shared-load-key", weight: 1 }]);

    await expect(first).resolves.toMatchObject({ id: 4 });
    await expect(second).resolves.toMatchObject({ id: 4 });
    expect(mockRepos.findBalancerConfig).toHaveBeenCalledTimes(1);
    expect(mockRepos.findEnabledByProvider).toHaveBeenCalledTimes(1);
  });
});
