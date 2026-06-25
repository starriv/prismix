import { beforeEach, describe, expect, it, vi } from "vitest";

type QueueMock = {
  label: string;
  handlers: Map<string, (data: Record<string, unknown>) => Promise<void>>;
  enqueue: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  depth: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const { mockQueueState } = vi.hoisted(() => {
  function makeQueue(label: string): QueueMock {
    const handlers = new Map<string, (data: Record<string, unknown>) => Promise<void>>();
    return {
      label,
      handlers,
      enqueue: vi.fn(),
      register: vi.fn((name: string, handler: (data: Record<string, unknown>) => Promise<void>) => {
        handlers.set(name, handler);
      }),
      depth: vi.fn(() => 0),
      stats: vi.fn(() => ({
        depth: 0,
        dropped: 0,
        totalEnqueued: 0,
        totalProcessed: 0,
        totalFailed: 0,
      })),
      flush: vi.fn(async () => 0),
      close: vi.fn(async () => undefined),
    };
  }

  const queues = new Map<string, QueueMock>();
  const createJobQueue = vi.fn(async (label: string) => {
    const queue = makeQueue(label);
    queues.set(label, queue);
    return queue;
  });

  return { mockQueueState: { queues, createJobQueue } };
});

vi.mock("@/server/queue", () => ({
  createJobQueue: mockQueueState.createJobQueue,
}));

vi.mock("@/server/lib/gateway-config", () => ({
  getGatewayConfigCached: vi.fn(() => ({
    queue: { maxWriteQueueDepth: 1000 },
  })),
}));

describe("write queue", () => {
  beforeEach(() => {
    vi.resetModules();
    mockQueueState.queues.clear();
    mockQueueState.createJobQueue.mockClear();
  });

  it("passes producer-only options to both the main and batch queues", async () => {
    const { initWriteQueue, closeWriteQueue } = await import("@/server/lib/write-queue");

    await initWriteQueue({ startWorker: false });

    expect(mockQueueState.createJobQueue).toHaveBeenCalledWith(
      "write-queue",
      expect.any(Function),
      { startWorker: false, concurrency: 20 },
    );
    // Batch queue is dedicated and runs at high concurrency so a full batch can assemble.
    expect(mockQueueState.createJobQueue).toHaveBeenCalledWith(
      "write-queue-batch",
      expect.any(Function),
      { startWorker: false, concurrency: 100 },
    );

    await closeWriteQueue();
  });

  it("routes known batch job names to the dedicated batch queue (producer side)", async () => {
    const { initWriteQueue, closeWriteQueue, enqueueJob } =
      await import("@/server/lib/write-queue");

    // Producer-only: no batch handler registered in this process.
    await initWriteQueue({ startWorker: false });

    const main = mockQueueState.queues.get("write-queue")!;
    const batch = mockQueueState.queues.get("write-queue-batch")!;

    enqueueJob("ai-usage-log", { requestId: "x" });
    expect(batch.enqueue).toHaveBeenCalledWith("ai-usage-log", { requestId: "x" }, undefined);
    expect(main.enqueue).not.toHaveBeenCalled();

    enqueueJob("ai-key-touch", { keyId: 1 });
    expect(main.enqueue).toHaveBeenCalledWith("ai-key-touch", { keyId: 1 }, undefined);

    await closeWriteQueue();
  });

  it("registers batch handlers on the batch queue and resolves after flush", async () => {
    const { closeWriteQueue, initWriteQueue, registerBatchHandler } =
      await import("@/server/lib/write-queue");
    const batchHandler = vi.fn(async () => undefined);

    await initWriteQueue();
    registerBatchHandler("ai-usage-log", batchHandler, {
      maxSize: 2,
      flushIntervalMs: 60_000,
    });

    const batch = mockQueueState.queues.get("write-queue-batch")!;
    const queuedHandler = batch.handlers.get("ai-usage-log");
    expect(queuedHandler).toBeDefined();

    let firstResolved = false;
    const first = queuedHandler!({ requestId: "a" }).then(() => {
      firstResolved = true;
    });
    await Promise.resolve();
    expect(firstResolved).toBe(false);

    const second = queuedHandler!({ requestId: "b" });
    await Promise.all([first, second]);

    expect(batchHandler).toHaveBeenCalledWith([{ requestId: "a" }, { requestId: "b" }]);

    await closeWriteQueue();
  });
});
