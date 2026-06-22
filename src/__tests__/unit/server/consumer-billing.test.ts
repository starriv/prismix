import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDebitBalance,
  mockUpdateAgent,
  mockSumSpendingToday,
  mockSumSpendingThisMonth,
  mockEnqueueJob,
  mockEmit,
} = vi.hoisted(() => ({
  mockDebitBalance: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockSumSpendingToday: vi.fn(),
  mockSumSpendingThisMonth: vi.fn(),
  mockEnqueueJob: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock("@/server/repos", () => ({
  payAgentRepo: {
    debitBalance: (...args: unknown[]) => mockDebitBalance(...args),
    update: (...args: unknown[]) => mockUpdateAgent(...args),
  },
  payAgentTransactionRepo: {
    sumSpendingToday: (...args: unknown[]) => mockSumSpendingToday(...args),
    sumSpendingThisMonth: (...args: unknown[]) => mockSumSpendingThisMonth(...args),
  },
}));

vi.mock("@/server/lib/write-queue", () => ({
  enqueueJob: (...args: unknown[]) => mockEnqueueJob(...args),
}));

vi.mock("@/server/events", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    gateway: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  },
}));

const { billConsumer, checkConsumerSpendingLimits } = await import("@/server/ai/lib/billing");

const consumer = {
  agentId: 100,
  userId: 10,
  consumerId: 1,
  markupPercent: 0,
  perPayLimit: null,
  dailyLimit: "1",
  monthlyLimit: null,
};

const baseBill = {
  usage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 },
  latencyMs: 123,
  consumer,
  keyId: 7,
  providerId: "openai",
  modelId: "gpt-4o",
  inputPrice: "1000",
  outputPrice: "1000",
  requestId: "req-1",
  statusCode: 200,
};

describe("consumer billing limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSumSpendingToday.mockResolvedValue("0");
    mockSumSpendingThisMonth.mockResolvedValue("0");
    mockDebitBalance.mockResolvedValue({ balance: "8" });
  });

  it("preflight rejects agents that already exceeded daily limit", async () => {
    mockSumSpendingToday.mockResolvedValueOnce("1.5");

    const result = await checkConsumerSpendingLimits(consumer);

    expect(result).toEqual({
      statusCode: 429,
      body: { error: "Daily spending limit exceeded", limit: "1", spent: "1.5" },
    });
  });

  it("rejectOnLimit returns 429 before debit or usage logging", async () => {
    const result = await billConsumer({ ...baseBill, rejectOnLimit: true });

    expect(result).toMatchObject({
      ok: false,
      statusCode: 429,
      body: {
        error: "Request would exceed daily spending limit",
        limit: "1",
        spent: "0",
        cost: "2",
      },
    });
    expect(mockDebitBalance).not.toHaveBeenCalled();
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("streaming-style billing suspends on limit but still debits and logs usage", async () => {
    const result = await billConsumer({ ...baseBill, rejectOnLimit: false });

    expect(result).toMatchObject({ ok: true, costStr: "2" });
    expect(mockUpdateAgent).toHaveBeenCalledWith(100, { status: "suspended" });
    expect(mockEmit).toHaveBeenCalledWith("agent.suspended", null, { agentId: 100 });
    expect(mockDebitBalance).toHaveBeenCalledWith(100, "2");
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "agent-ai-txn",
      expect.objectContaining({ agentId: 100, amount: "2", requestId: "req-1" }),
    );
    expect(mockEnqueueJob).toHaveBeenCalledWith(
      "ai-usage-log",
      expect.objectContaining({ consumerKeyId: 1, estimatedCost: "2" }),
    );
  });
});
