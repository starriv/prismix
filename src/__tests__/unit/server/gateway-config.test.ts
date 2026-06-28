import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gatewayWarn: vi.fn(),
}));

vi.mock("@/server/events", () => ({
  emit: vi.fn(),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: { warn: mocks.gatewayWarn },
  },
}));

vi.mock("@/server/repos", () => ({
  settingsRepo: {
    getGlobal: vi.fn(),
    setGlobal: vi.fn(),
  },
}));

const { resolveTimeoutConfig, resolveUpstreamFetchTimeoutMs } =
  await import("@/server/lib/gateway-config");

describe("gateway timeout config", () => {
  beforeEach(() => {
    mocks.gatewayWarn.mockReset();
  });

  it("adds a long DeepSeek upstream fetch timeout by default", () => {
    const config = resolveTimeoutConfig();

    expect(resolveUpstreamFetchTimeoutMs(config, { endpointId: "deepseek" })).toBe(600_000);
    expect(resolveUpstreamFetchTimeoutMs(config, { endpointId: "openai" })).toBe(120_000);
  });

  it("uses the most specific upstream fetch timeout override", () => {
    const config = resolveTimeoutConfig({
      upstreamFetchMs: 100_000,
      upstreamFetchOverrides: [
        { endpointId: "deepseek", upstreamFetchMs: 600_000 },
        { endpointId: "deepseek", modelId: "deepseek-v4-pro", upstreamFetchMs: 900_000 },
      ],
    });

    expect(
      resolveUpstreamFetchTimeoutMs(config, {
        endpointId: "deepseek",
        modelId: "deepseek-v4-pro",
      }),
    ).toBe(900_000);
    expect(
      resolveUpstreamFetchTimeoutMs(config, {
        endpointId: "deepseek",
        modelId: "deepseek-chat",
      }),
    ).toBe(600_000);
  });

  it("matches model-only overrides across providers", () => {
    const config = resolveTimeoutConfig({
      upstreamFetchMs: 100_000,
      upstreamFetchOverrides: [{ modelId: "deepseek-v4-pro", upstreamFetchMs: 900_000 }],
    });

    expect(
      resolveUpstreamFetchTimeoutMs(config, {
        endpointId: "deepseek",
        modelId: "deepseek-v4-pro",
      }),
    ).toBe(900_000);
    expect(
      resolveUpstreamFetchTimeoutMs(config, {
        endpointId: "openai-compatible-proxy",
        modelId: "deepseek-v4-pro",
      }),
    ).toBe(900_000);
  });

  it("falls back to the base timeout when no override key matches", () => {
    const config = resolveTimeoutConfig({
      upstreamFetchMs: 100_000,
      upstreamFetchOverrides: [{ endpointId: "deepseek", upstreamFetchMs: 600_000 }],
    });

    expect(resolveUpstreamFetchTimeoutMs(config, {})).toBe(100_000);
    expect(resolveUpstreamFetchTimeoutMs(config, { endpointId: "openai" })).toBe(100_000);
  });

  it("keeps an explicitly empty override list", () => {
    const config = resolveTimeoutConfig({ upstreamFetchOverrides: [] });

    expect(config.upstreamFetchOverrides).toEqual([]);
    expect(resolveUpstreamFetchTimeoutMs(config, { endpointId: "deepseek" })).toBe(120_000);
  });

  it("drops invalid overrides and logs a warning", () => {
    const config = resolveTimeoutConfig({
      upstreamFetchMs: 100_000,
      upstreamFetchOverrides: [
        { endpointId: "deepseek", upstreamFetchMs: 600_000 },
        { endpointId: "  ", modelId: "", upstreamFetchMs: 600_000 },
        { endpointId: "deepseek", upstreamFetchMs: 0 },
        { modelId: "deepseek-v4-pro", upstreamFetchMs: Number.NaN },
      ] as unknown as ReturnType<typeof resolveTimeoutConfig>["upstreamFetchOverrides"],
    });

    expect(config.upstreamFetchOverrides).toEqual([
      { endpointId: "deepseek", modelId: undefined, upstreamFetchMs: 600_000 },
    ]);
    expect(mocks.gatewayWarn).toHaveBeenCalledWith(
      { dropped: 3, total: 4 },
      "Dropped invalid gateway upstream fetch timeout overrides",
    );
  });
});
