import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepos = vi.hoisted(() => ({
  findBalancerConfig: vi.fn(),
  findEnabledByProvider: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiProviderRepo: {
    findBalancerConfig: mockRepos.findBalancerConfig,
  },
  aiKeyRepo: {
    findEnabledByProvider: mockRepos.findEnabledByProvider,
  },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    pricing: {
      debug: vi.fn(),
    },
  },
}));

describe("key balancer health weighting", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRepos.findBalancerConfig.mockResolvedValue({ loadBalanceStrategy: "round-robin" });
    mockRepos.findEnabledByProvider.mockResolvedValue([
      { id: 1, name: "key-1", weight: 4 },
      { id: 2, name: "key-2", weight: 4 },
    ]);
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
});
