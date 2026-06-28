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
      authMode: "override",
      authType: "bearer",
      authConfig: "{}",
      concurrencyMode: "override",
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

  it("uses supplier official concurrency when endpoint concurrencyMode is inherit", async () => {
    mockFindEnabledByEndpointId.mockResolvedValue([]);

    const endpoint = {
      id: 8,
      endpointId: "aliyun-beijing",
      name: "Aliyun Beijing",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      authMode: "inherit",
      authType: "bearer",
      authConfig: "{}",
      concurrencyMode: "inherit",
      officialConcurrencyLimit: 2,
      officialQueueTimeoutMs: 10_000,
      upstreamRoutingStrategy: "priority",
      supplier: {
        authType: "api-key",
        authConfig: JSON.stringify({ headerName: "Authorization" }),
        officialConcurrencyLimit: 12,
        officialQueueTimeoutMs: 60_000,
      },
    } as unknown as AiEndpoint;

    const targets = await resolveUpstreamCandidates(endpoint);

    expect(targets[0]).toMatchObject({
      upstreamId: "official",
      concurrencyLimit: 12,
      queueTimeoutMs: 60_000,
    });
  });
});
