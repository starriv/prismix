import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRepos = vi.hoisted(() => ({
  findBalancerConfig: vi.fn(),
  findEnabledByEndpoint: vi.fn(),
  findEnabledByUpstream: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiEndpointRepo: {
    findBalancerConfig: mockRepos.findBalancerConfig,
  },
  aiEndpointCredentialRepo: {
    findEnabledByEndpoint: mockRepos.findEnabledByEndpoint,
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

describe("credential balancer health weighting", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRepos.findBalancerConfig.mockReset();
    mockRepos.findEnabledByEndpoint.mockReset();
    mockRepos.findEnabledByUpstream.mockReset();
    mockRepos.findBalancerConfig.mockResolvedValue({ loadBalanceStrategy: "round-robin" });
    mockRepos.findEnabledByEndpoint.mockResolvedValue([
      { id: 1, credentialId: 101, credentialName: "credential-1", weight: 4 },
      { id: 2, credentialId: 102, credentialName: "credential-2", weight: 4 },
    ]);
    mockRepos.findEnabledByUpstream.mockResolvedValue([
      { id: 3, credentialId: 103, credentialName: "upstream-credential", weight: 1 },
    ]);
  });

  it("soft-degrades a repeatedly failing credential instead of removing it", async () => {
    const {
      clearAllPools,
      getCredentialHealthSnapshot,
      markCredentialFailure,
      pickEndpointCredential,
    } = await import("@/server/ai/lib/credential-balancer");

    clearAllPools();

    const first = await pickEndpointCredential(10);
    expect(first?.id).toBe(1);

    markCredentialFailure(1);
    markCredentialFailure(1);

    const second = await pickEndpointCredential(10);
    expect(second?.id).toBe(2);

    const health = getCredentialHealthSnapshot(1);
    expect(health?.consecutiveFailures).toBe(2);
    expect((health?.penaltyUntil ?? 0) > Date.now()).toBe(true);
  });

  it("clears penalty state after a success", async () => {
    const {
      clearAllPools,
      getCredentialHealthSnapshot,
      markCredentialFailure,
      markCredentialSuccess,
    } = await import("@/server/ai/lib/credential-balancer");

    clearAllPools();
    markCredentialFailure(1);
    markCredentialFailure(1);
    expect(getCredentialHealthSnapshot(1)?.consecutiveFailures).toBe(2);

    markCredentialSuccess(1);
    const health = getCredentialHealthSnapshot(1);
    expect(health?.consecutiveFailures).toBe(0);
    expect(health?.penaltyUntil).toBe(0);
    expect(health?.totalSuccesses).toBe(1);
  });

  it("exposes penalized credentials in pool info", async () => {
    const { clearAllPools, getPoolInfo, markCredentialFailure } =
      await import("@/server/ai/lib/credential-balancer");

    clearAllPools();
    markCredentialFailure(2);

    const info = await getPoolInfo(10);
    expect(info.endpointCredentialIds).toEqual([1, 2]);
    expect(info.penalizedEndpointCredentialIds).toContain(2);
  });

  it("reloads an empty cached pool so direct DB repairs become visible", async () => {
    vi.useFakeTimers();
    mockRepos.findEnabledByEndpoint
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 3, credentialId: 103, credentialName: "restored-credential", weight: 1 },
      ]);

    const { clearAllPools, pickEndpointCredential } =
      await import("@/server/ai/lib/credential-balancer");

    clearAllPools();

    try {
      expect(await pickEndpointCredential(10)).toBeUndefined();
      await vi.advanceTimersByTimeAsync(30_000);
      expect((await pickEndpointCredential(10))?.id).toBe(3);
      expect(mockRepos.findEnabledByEndpoint).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces concurrent loads for the same endpoint pool", async () => {
    let resolveRows: (
      rows: Array<{ id: number; credentialId: number; credentialName: string; weight: number }>,
    ) => void = () => {};
    const rowsPromise = new Promise<
      Array<{ id: number; credentialId: number; credentialName: string; weight: number }>
    >((resolve) => {
      resolveRows = resolve;
    });
    mockRepos.findEnabledByEndpoint.mockReturnValue(rowsPromise);

    const { clearAllPools, pickEndpointCredential } =
      await import("@/server/ai/lib/credential-balancer");

    clearAllPools();
    const first = pickEndpointCredential(10);
    const second = pickEndpointCredential(10);

    resolveRows([
      { id: 4, credentialId: 104, credentialName: "shared-load-credential", weight: 1 },
    ]);

    await expect(first).resolves.toMatchObject({ id: 4 });
    await expect(second).resolves.toMatchObject({ id: 4 });
    expect(mockRepos.findBalancerConfig).toHaveBeenCalledTimes(1);
    expect(mockRepos.findEnabledByEndpoint).toHaveBeenCalledTimes(1);
  });

  it("penalizes a shared credential across endpoints when it fails on one", async () => {
    mockRepos.findEnabledByEndpoint.mockImplementation(async (endpointId: number) => {
      if (endpointId === 10) {
        return [{ id: 1, credentialId: 101, credentialName: "shared-key", weight: 4 }];
      }
      if (endpointId === 20) {
        return [{ id: 5, credentialId: 101, credentialName: "shared-key", weight: 4 }];
      }
      return [];
    });

    const { clearAllPools, getPoolInfo, markCredentialFailure, pickEndpointCredential } =
      await import("@/server/ai/lib/credential-balancer");

    clearAllPools();

    await pickEndpointCredential(10);
    await pickEndpointCredential(20);

    markCredentialFailure(1);

    const info10 = await getPoolInfo(10);
    expect(info10.penalizedEndpointCredentialIds).toContain(1);

    const info20 = await getPoolInfo(20);
    expect(info20.penalizedEndpointCredentialIds).toContain(5);
  });
});
