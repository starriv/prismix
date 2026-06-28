import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiEndpoint } from "@/server/db";

const mockFindEnabledByEndpointId = vi.fn();
const mockFindByUpstreamId = vi.fn();

vi.mock("@/server/repos", () => ({
  aiUpstreamAssignmentRepo: {
    findEnabledByEndpointId: (...args: unknown[]) => mockFindEnabledByEndpointId(...args),
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
    mockFindEnabledByEndpointId.mockReset();
    mockFindByUpstreamId.mockReset();
  });

  it("builds the official upstream target from endpoint concurrency config", async () => {
    mockFindEnabledByEndpointId.mockResolvedValue([]);

    const endpoint = {
      id: 7,
      endpointId: "glm",
      name: "GLM",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      officialConcurrencyLimit: 2,
      officialQueueTimeoutMs: 45_000,
      upstreamRoutingStrategy: "priority",
    } as unknown as AiEndpoint;

    const targets = await resolveUpstreamCandidates(endpoint);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      id: null,
      upstreamId: "official",
      concurrencyScopeKey: "endpoint:7:official",
      name: "GLM Official",
      concurrencyLimit: 2,
      queueTimeoutMs: 45_000,
      kind: "official",
      isLegacy: true,
    });
  });
});
