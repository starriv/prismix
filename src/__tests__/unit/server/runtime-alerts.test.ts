import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEmit = vi.hoisted(() => vi.fn());
const mockWarn = vi.hoisted(() => vi.fn());

vi.mock("@/server/events", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: {
      warn: (...args: unknown[]) => mockWarn(...args),
    },
  },
}));

process.env.RESOURCE_DOWN_ALERT_COOLDOWN_MS = "300000";

const { notifyResourceDown, resetRuntimeAlertDedupeForTests } =
  await import("@/server/ai/lib/runtime-alerts");

describe("runtime resource-down alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeAlertDedupeForTests();
  });

  it("emits alert.resource-down with readable notification content", () => {
    notifyResourceDown({
      route: "consumer-chat",
      requestId: "req_123",
      providerId: "openai",
      modelId: "gpt-4o",
      upstreamId: 10,
      upstreamName: "Proxy A",
      upstreamBaseUrl: "https://proxy-a.example.com",
      status: 503,
      detail: '{"error":{"message":"No available decode workers"}}',
    });

    expect(mockEmit).toHaveBeenCalledWith(
      "alert.resource-down",
      null,
      expect.objectContaining({
        title: "AI 上游不可用: Proxy A",
        body: expect.stringContaining("All upstream candidates failed"),
        route: "consumer-chat",
        requestId: "req_123",
        providerId: "openai",
        modelId: "gpt-4o",
        upstreamId: 10,
        upstreamName: "Proxy A",
        status: 503,
      }),
    );
  });

  it("deduplicates repeated alerts for the same route/provider/upstream/model", () => {
    const alert = {
      route: "admin-passthrough" as const,
      requestId: "req_123",
      providerId: "openai",
      modelId: "gpt-4o",
      upstreamId: 10,
      upstreamName: "Proxy A",
      detail: "HTTP 503",
    };

    notifyResourceDown(alert);
    notifyResourceDown({ ...alert, requestId: "req_456" });

    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});
