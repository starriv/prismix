import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState } = vi.hoisted(() => ({
  mockState: {
    queueConstructed: vi.fn(),
    workerConstructed: vi.fn(),
    queueClose: vi.fn().mockResolvedValue(undefined),
    workerClose: vi.fn().mockResolvedValue(undefined),
    workerOn: vi.fn(),
  },
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = vi.fn();
    close = mockState.queueClose;
    constructor(name: string) {
      mockState.queueConstructed(name);
    }
  },
  Worker: class {
    on = mockState.workerOn;
    close = mockState.workerClose;
    constructor(name: string) {
      mockState.workerConstructed(name);
    }
  },
}));

// Heavy domain deps are only touched by processScan (not by queue init) — stub them.
vi.mock("@/blockchain/config", () => ({
  chunkedGetLogs: vi.fn(),
  getPublicClient: vi.fn(),
  getUsdcAddress: vi.fn(),
}));
vi.mock("@/server/events", () => ({ emit: vi.fn() }));
vi.mock("@/server/events/registry", () => ({ DOMAIN_EVENT_TYPES: {} }));
vi.mock("@/server/repos", () => ({
  payAgentRepo: {},
  payAgentTransactionRepo: {},
  topupOrderRepo: {},
}));

describe("initDepositScanQueue — producer/consumer split", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.REDIS_URL = "redis://localhost:6379";
    mockState.queueConstructed.mockClear();
    mockState.workerConstructed.mockClear();
    mockState.queueClose.mockClear().mockResolvedValue(undefined);
    mockState.workerClose.mockClear().mockResolvedValue(undefined);
    mockState.workerOn.mockClear();
  });

  it("producer-only mode creates the queue but no Worker", async () => {
    const { initDepositScanQueue, closeDepositScanQueue } =
      await import("@/server/jobs/scan-topup-deposit");

    await initDepositScanQueue({ startWorker: false });

    expect(mockState.queueConstructed).toHaveBeenCalledWith("deposit-scan");
    expect(mockState.workerConstructed).not.toHaveBeenCalled();

    await closeDepositScanQueue();
    expect(mockState.workerClose).not.toHaveBeenCalled();
    expect(mockState.queueClose).toHaveBeenCalledTimes(1);
  });

  it("default (worker) mode creates both queue and Worker", async () => {
    const { initDepositScanQueue, closeDepositScanQueue } =
      await import("@/server/jobs/scan-topup-deposit");

    await initDepositScanQueue();

    expect(mockState.queueConstructed).toHaveBeenCalledWith("deposit-scan");
    expect(mockState.workerConstructed).toHaveBeenCalledWith("deposit-scan");

    await closeDepositScanQueue();
    expect(mockState.workerClose).toHaveBeenCalledTimes(1);
    expect(mockState.queueClose).toHaveBeenCalledTimes(1);
  });

  it("disabled when REDIS_URL is unset — no queue or Worker", async () => {
    delete process.env.REDIS_URL;
    const { initDepositScanQueue } = await import("@/server/jobs/scan-topup-deposit");

    await initDepositScanQueue();

    expect(mockState.queueConstructed).not.toHaveBeenCalled();
    expect(mockState.workerConstructed).not.toHaveBeenCalled();
  });
});
