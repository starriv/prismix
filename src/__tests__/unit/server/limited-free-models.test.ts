import { beforeEach, describe, expect, it, vi } from "vitest";

import { isLimitedFreeActive, serializeLimitedFreeUntil } from "@/server/ai/lib/limited-free";

const { mockDisableExpiredLimitedFreeModels } = vi.hoisted(() => ({
  mockDisableExpiredLimitedFreeModels: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  aiModelRepo: {
    disableExpiredLimitedFreeModels: (...args: unknown[]) =>
      mockDisableExpiredLimitedFreeModels(...args),
  },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe("limited-free model helpers", () => {
  const now = new Date("2026-06-23T12:00:00.000Z");

  it("marks future expiry as active", () => {
    expect(isLimitedFreeActive("2026-06-23T12:01:00.000Z", now)).toBe(true);
  });

  it("marks equal or past expiry as inactive", () => {
    expect(isLimitedFreeActive("2026-06-23T12:00:00.000Z", now)).toBe(false);
    expect(isLimitedFreeActive("2026-06-23T11:59:59.999Z", now)).toBe(false);
  });

  it("serializes valid values and drops invalid values", () => {
    expect(serializeLimitedFreeUntil(new Date("2026-06-23T12:01:00.000Z"))).toBe(
      "2026-06-23T12:01:00.000Z",
    );
    expect(serializeLimitedFreeUntil("not-a-date")).toBeNull();
  });
});

describe("limited-free model expiry job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears expired model tags through the repo", async () => {
    mockDisableExpiredLimitedFreeModels.mockResolvedValueOnce(2);
    const { expireLimitedFreeModels } = await import("@/server/jobs/expire-limited-free-models");
    const now = new Date("2026-06-23T12:00:00.000Z");

    await expect(expireLimitedFreeModels(now)).resolves.toBe(2);
    expect(mockDisableExpiredLimitedFreeModels).toHaveBeenCalledWith(now);
  });
});
