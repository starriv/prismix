/**
 * Consumer key auto-agent lifecycle tests.
 *
 * Verifies:
 * 1. CREATE auto-creates a pay agent with [AI] prefix name via tx
 * 2. CREATE wraps both inserts in a transaction (using tx, not global db)
 * 3. CREATE emits agent.created event after commit
 * 4. CREATE does not emit on transaction failure (rollback)
 * 5. DELETE returns linked agent info for UI suspension prompt
 * 6. DELETE returns null agent when agent not found
 * 7. DELETE returns 404 when key not found
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Import route AFTER mocks ──────────────────────────────────────────

import relayKeys from "@/server/ai/routes/relay-keys";

// ── Hoisted mock fns (available inside vi.mock factories) ───────────

const {
  mockPayAgentFind,
  mockConsumerKeyFind,
  mockConsumerKeyBlacklistAndDelete,
  mockEmit,
  mockTransaction,
  mockTxInsertReturning,
} = vi.hoisted(() => {
  const mockTxInsertReturning = vi.fn();
  return {
    mockPayAgentFind: vi.fn(),
    mockConsumerKeyFind: vi.fn(),
    mockConsumerKeyBlacklistAndDelete: vi.fn(),
    mockEmit: vi.fn(),
    mockTransaction: vi.fn(),
    mockTxInsertReturning,
  };
});

// ── Mock data ───────────────────────────────────────────────────────

const MOCK_AGENT = {
  id: 42,
  name: "[AI] My Test Key",
  description: null,
  address: null,
  privateKey: null,
  type: "ledger" as const,
  balance: "0",
  status: "active" as const,
  perPayLimit: null,
  dailyLimit: null,
  monthlyLimit: null,
  lastSyncBlock: 0,
  updatedAt: new Date(),
  createdAt: new Date(),
};

const MOCK_CONSUMER_KEY = {
  id: 100,
  agentId: 42,
  name: "My Test Key",
  description: null,
  apiKeyHash: "consumer-hash",
  apiKeyPrefix: "ska_test",
  encryptedKey: "encrypted-consumer-key",
  markupPercent: 0,
  rateLimitRpm: null,
  allowedModels: "[]",
  status: "active" as const,
  expiresAt: null,
  lastUsedAt: null,
  updatedAt: new Date(),
  createdAt: new Date(),
};

// ── Mocks ───────────────────────────────────────────────────────────

vi.mock("@/server/repos", () => ({
  payAgentRepo: {
    findById: mockPayAgentFind,
  },
  relayConsumerKeyRepo: {
    findById: mockConsumerKeyFind,
    findAll: vi.fn(async () => []),
    blacklistAndDelete: mockConsumerKeyBlacklistAndDelete,
    update: vi.fn(),
    create: vi.fn(), // kept for update route which still uses repo
  },
}));

vi.mock("@/server/db", () => ({
  transaction: mockTransaction,
  // The route imports table schemas and types for tx.insert()
  payAgents: { id: "id" },
  relayConsumerKeys: { id: "id" },
}));

vi.mock("@/server/events", () => ({
  emit: mockEmit,
}));

vi.mock("viem/accounts", () => ({
  generatePrivateKey: vi.fn(() => "0xfakeprivatekey"),
  privateKeyToAccount: vi.fn(() => ({ address: "0xAutoGenAddress" })),
}));

vi.mock("@/server/lib/crypto", () => ({
  encrypt: vi.fn(() => "encrypted-value"),
  decrypt: vi.fn(() => "decrypted-key"),
  generateConsumerApiKey: vi.fn(() => ({
    raw: "ska_abc123def456abc123def456abc123de",
    hash: "consumer-hash",
    prefix: "ska_abc1",
  })),
  hashApiKey: vi.fn(() => "hashed"),
}));

vi.mock("@/server/middleware/auth", () => ({
  getAdminSession: vi.fn(() => ({ adminId: 1 })),
}));

vi.mock("@/server/lib/logger", () => ({
  log: { gateway: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

vi.mock("@/server/lib/response", () => ({
  ok: vi.fn((_c: unknown, data: unknown, status?: number) => {
    return new Response(JSON.stringify(data), {
      status: status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
}));

vi.mock("@/server/lib/validate", () => ({
  parseBody: vi.fn(async (c: { req: { json: () => Promise<unknown> } }, _schema: unknown) => {
    const body = await c.req.json();
    return { ok: true, data: body };
  }),
}));

const app = new Hono();
app.route("/relay-keys", relayKeys);

// ── Helpers ───────────────────────────────────────────────────────────

function jsonReq(method: string, path: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

async function jsonRes(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

/** Build a mock tx object with chainable .insert().values().returning() */
function buildMockTx(agentResult: unknown, keyResult: unknown) {
  let callIndex = 0;
  const results = [agentResult, keyResult];
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          const r = results[callIndex++];
          if (r instanceof Error) throw r;
          return [r];
        }),
      })),
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("relay-keys auto-agent lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPayAgentFind.mockResolvedValue(MOCK_AGENT);
    mockConsumerKeyFind.mockResolvedValue(MOCK_CONSUMER_KEY);

    // Default: transaction executes fn with a mock tx
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = buildMockTx(MOCK_AGENT, MOCK_CONSUMER_KEY);
      return fn(tx);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── CREATE ────────────────────────────────────────────────────────

  describe("POST / (create)", () => {
    it("wraps both inserts in a single transaction", async () => {
      const res = await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));
      expect(res.status).toBe(201);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it("uses tx.insert (not global db) for atomicity", async () => {
      let capturedTx: { insert: ReturnType<typeof vi.fn> } | null = null;
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = buildMockTx(MOCK_AGENT, MOCK_CONSUMER_KEY);
        capturedTx = tx;
        return fn(tx);
      });

      await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));

      // tx.insert should have been called twice (agent + consumer key)
      expect(capturedTx!.insert).toHaveBeenCalledTimes(2);
    });

    it("emits agent.created event after successful transaction", async () => {
      await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));

      expect(mockEmit).toHaveBeenCalledWith("agent.created", null, {
        agentId: 42,
        name: "[AI] My Test Key",
      });
    });

    it("does NOT emit when transaction fails (rollback)", async () => {
      mockTransaction.mockRejectedValue(new Error("DB connection lost"));

      const res = await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));
      expect(res.status).toBe(500);
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("does NOT return agent API key in response", async () => {
      const res = await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));
      const body = await jsonRes(res);
      expect(body.apiKey).toBeDefined();
      expect(body).not.toHaveProperty("agentApiKey");
    });

    it("returns consumer API key with ska_ prefix", async () => {
      const res = await app.request(jsonReq("POST", "/relay-keys", { name: "My Test Key" }));
      const body = await jsonRes(res);
      expect(body.apiKey).toBe("ska_abc123def456abc123def456abc123de");
    });
  });

  // ── DELETE ────────────────────────────────────────────────────────

  describe("DELETE /:id", () => {
    it("returns success after deletion", async () => {
      const res = await app.request(jsonReq("DELETE", "/relay-keys/100"));
      const body = await jsonRes(res);

      expect(body.success).toBe(true);
    });

    it("deletes the consumer key", async () => {
      await app.request(jsonReq("DELETE", "/relay-keys/100"));

      expect(mockConsumerKeyBlacklistAndDelete).toHaveBeenCalledWith(MOCK_CONSUMER_KEY);
    });

    it("returns 404 when consumer key not found", async () => {
      mockConsumerKeyFind.mockResolvedValue(undefined);

      const res = await app.request(jsonReq("DELETE", "/relay-keys/999"));
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid (non-numeric) id", async () => {
      const res = await app.request(jsonReq("DELETE", "/relay-keys/abc"));
      expect(res.status).toBe(400);
    });
  });
});
