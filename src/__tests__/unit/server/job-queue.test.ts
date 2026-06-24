/**
 * JobQueue unit tests — RedisJobQueue (mocked BullMQ).
 *
 * Covers: enqueue→process pipeline, handler dispatch, stats tracking,
 * error handling, close, and BullMQ Worker→handler dispatch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

function flush(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────
// 1. RedisJobQueue — mocked BullMQ with Worker processor verification
// ─────────────────────────────────────────────────────────────────────

// Capture the Worker processor so we can simulate BullMQ calling it
const { mockState } = vi.hoisted(() => {
  let capturedProcessor: ((job: { name: string; data: unknown }) => Promise<void>) | null = null;
  const mockState = {
    queueAdd: vi.fn().mockResolvedValue({ id: "1" }),
    queueClose: vi.fn().mockResolvedValue(undefined),
    workerClose: vi.fn().mockResolvedValue(undefined),
    workerOn: vi.fn(),
    getProcessor: () => capturedProcessor,
    setProcessor: (p: (job: { name: string; data: unknown }) => Promise<void>) => {
      capturedProcessor = p;
    },
  };
  return { mockState };
});

vi.mock("bullmq", () => ({
  Queue: class MockQueue {
    add = mockState.queueAdd;
    close = mockState.queueClose;
    constructor(_name: string, _opts?: unknown) {}
  },
  Worker: class MockWorker {
    close = mockState.workerClose;
    on = mockState.workerOn;
    constructor(
      _name: string,
      processor?: (job: { name: string; data: unknown }) => Promise<void>,
      _opts?: unknown,
    ) {
      if (processor) mockState.setProcessor(processor);
    }
  },
}));

describe("RedisJobQueue — mocked BullMQ", () => {
  beforeEach(() => {
    mockState.queueAdd.mockClear().mockResolvedValue({ id: "1" });
    mockState.queueClose.mockClear().mockResolvedValue(undefined);
    mockState.workerClose.mockClear().mockResolvedValue(undefined);
  });

  async function createRedisQueue() {
    const { RedisJobQueue } = await import("@/server/queue/redis-job-queue");
    return new RedisJobQueue("test-redis", () => 1000, { url: "redis://localhost:6379" });
  }

  // ── Enqueue ──

  it("enqueue() calls BullMQ Queue.add with correct name and data", async () => {
    const queue = await createRedisQueue();

    queue.enqueue("gateway-log", { resourceId: 42, path: "/api/test" });

    expect(mockState.queueAdd).toHaveBeenCalledTimes(1);
    expect(mockState.queueAdd).toHaveBeenCalledWith("gateway-log", {
      resourceId: 42,
      path: "/api/test",
    });
    await queue.close();
  });

  it("enqueue() passes delay options to BullMQ", async () => {
    const queue = await createRedisQueue();

    queue.enqueue("notification-deliver", { logId: 42 }, { delayMs: 5000 });

    expect(mockState.queueAdd).toHaveBeenCalledWith(
      "notification-deliver",
      { logId: 42 },
      { delay: 5000 },
    );
    await queue.close();
  });

  it("enqueue() tracks totalEnqueued counter", async () => {
    const queue = await createRedisQueue();

    queue.enqueue("job-1", {});
    queue.enqueue("job-2", {});
    queue.enqueue("job-3", {});

    expect(queue.stats().totalEnqueued).toBe(3);
    await queue.close();
  });

  // ── Worker processor → handler dispatch ──

  it("Worker processor dispatches to registered handler", async () => {
    const queue = await createRedisQueue();
    const handler = vi.fn().mockResolvedValue(undefined);
    queue.register("my-job", handler);

    // Simulate BullMQ calling the Worker processor (as if dequeuing a job from Redis)
    const processor = mockState.getProcessor();
    expect(processor).toBeDefined();

    await processor!({ name: "my-job", data: { payload: "test-data" } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ payload: "test-data" });
    expect(queue.stats().totalProcessed).toBe(1);

    await queue.close();
  });

  it("Worker processor throws for unregistered job name", async () => {
    const queue = await createRedisQueue();

    const processor = mockState.getProcessor()!;
    await expect(processor({ name: "unregistered", data: {} })).rejects.toThrow(
      'No handler registered for job "unregistered"',
    );

    await queue.close();
  });

  it("Worker processor handles multiple job types correctly", async () => {
    const queue = await createRedisQueue();
    const logHandler = vi.fn().mockResolvedValue(undefined);
    const notifHandler = vi.fn().mockResolvedValue(undefined);
    queue.register("gateway-log", logHandler);
    queue.register("notification-deliver", notifHandler);

    const processor = mockState.getProcessor()!;

    await processor({ name: "gateway-log", data: { resourceId: 1 } });
    await processor({ name: "notification-deliver", data: { channel: "webhook" } });
    await processor({ name: "gateway-log", data: { resourceId: 2 } });

    expect(logHandler).toHaveBeenCalledTimes(2);
    expect(notifHandler).toHaveBeenCalledTimes(1);
    expect(notifHandler).toHaveBeenCalledWith({ channel: "webhook" });
    expect(queue.stats().totalProcessed).toBe(3);

    await queue.close();
  });

  // ── Error handling ──

  it("enqueue failure (Redis down) is caught, increments totalFailed", async () => {
    const queue = await createRedisQueue();
    mockState.queueAdd.mockRejectedValueOnce(new Error("Redis down"));

    queue.enqueue("failing-job", {});
    await flush();

    expect(queue.stats().totalFailed).toBe(1);
    await queue.close();
  });

  it("registers failed event handler on Worker", async () => {
    await createRedisQueue();
    expect(mockState.workerOn).toHaveBeenCalledWith("failed", expect.any(Function));
    expect(mockState.workerOn).toHaveBeenCalledWith("error", expect.any(Function));
  });

  // ── Close ──

  it("close() calls worker.close() and queue.close()", async () => {
    const queue = await createRedisQueue();

    await queue.close();

    expect(mockState.workerClose).toHaveBeenCalledTimes(1);
    expect(mockState.queueClose).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Factory selection
// ─────────────────────────────────────────────────────────────────────

describe("createJobQueue factory", () => {
  it("throws when no REDIS_URL", async () => {
    delete process.env.REDIS_URL;
    const { createJobQueue } = await import("@/server/queue");
    await expect(createJobQueue("factory-test", () => 100)).rejects.toThrow(
      "REDIS_URL is required",
    );
  });
});
