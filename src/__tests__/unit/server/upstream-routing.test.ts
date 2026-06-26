import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiProvider } from "@/server/db";

const mockFindEnabledByProviderId = vi.fn();
const mockFindByUpstreamId = vi.fn();

vi.mock("@/server/repos", () => ({
  aiUpstreamAssignmentRepo: {
    findEnabledByProviderId: (...args: unknown[]) => mockFindEnabledByProviderId(...args),
    findByUpstreamId: (...args: unknown[]) => mockFindByUpstreamId(...args),
  },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: {
      warn: vi.fn(),
    },
  },
}));

const { clearUpstreamCache, resolveUpstreamCandidates } =
  await import("@/server/ai/lib/upstream-routing");

describe("upstream routing", () => {
  beforeEach(() => {
    clearUpstreamCache();
    mockFindEnabledByProviderId.mockReset();
    mockFindByUpstreamId.mockReset();
  });

  it("builds the official upstream target from provider concurrency config", async () => {
    mockFindEnabledByProviderId.mockResolvedValue([]);

    const provider = {
      id: 7,
      providerId: "glm",
      name: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      officialConcurrencyLimit: 2,
      officialQueueTimeoutMs: 45_000,
      upstreamRoutingStrategy: "priority",
    } as unknown as AiProvider;

    const targets = await resolveUpstreamCandidates(provider);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: null,
      upstreamId: "legacy",
      concurrencyScopeKey: "provider:7:official",
      concurrencyLimit: 2,
      queueTimeoutMs: 45_000,
      kind: "official",
      isLegacy: true,
    });
  });
});
