/**
 * User Announcements — unit tests for GET /api/user/announcements.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockFindRecentSent = vi.fn();

vi.mock("@/server/repos", () => ({
  announcementRepo: {
    findRecentSent: (...args: unknown[]) => mockFindRecentSent(...args),
  },
  // Stubs required by other user route imports
  aiModelRepo: { findAllEnabled: vi.fn().mockResolvedValue([]) },
  aiUsageLogRepo: {
    summary: vi.fn().mockResolvedValue({}),
    dailySummary: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  payAgentRepo: { findById: vi.fn() },
  relayConsumerKeyRepo: {
    findByUserId: vi.fn().mockResolvedValue([]),
    findByIdAndUser: vi.fn(),
    create: vi.fn(),
  },
  settingsRepo: { getGlobal: vi.fn() },
  userRepo: { findById: vi.fn(), update: vi.fn() },
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    auth: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    gateway: { info: vi.fn() },
  },
}));

vi.mock("@/server/lib/response", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/lib/response")>();
  return { ...original };
});

vi.mock("@/server/middleware/auth", () => ({
  getUserSession: () => ({ userId: 42, address: "0xuser", role: "user" }),
}));

vi.mock("@/server/lib/crypto", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted"),
  decrypt: vi.fn().mockReturnValue("decrypted"),
  generateConsumerApiKey: vi.fn().mockReturnValue({
    raw: "key",
    hash: "hash",
    prefix: "prefix",
  }),
}));

vi.mock("@/server/lib/wallet", () => ({
  ensureUserAgent: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/server/ai/middleware/consumer-key-auth", () => ({
  getGlobalDefaultMarkup: vi.fn().mockResolvedValue(20),
}));

vi.mock("@/server/ai/lib/safe-json", () => ({
  safeParseJsonArray: vi.fn().mockReturnValue([]),
}));

// ── Build test app ───────────────────────────────────────────────────

const { default: userRouter } = await import("@/server/user/routes/user");
const app = new Hono();
app.route("/api/user", userRouter);

// ── Test data ────────────────────────────────────────────────────────

const SENT_ANNOUNCEMENT_1 = {
  id: "ann-001",
  title: "Platform maintenance",
  body: "Scheduled maintenance at 2am UTC",
  link: "https://status.example.com",
  status: "sent",
  createdBy: "0xadmin",
  sentAt: new Date("2025-06-01T02:00:00Z"),
  updatedAt: new Date("2025-06-01T02:00:00Z"),
  createdAt: new Date("2025-06-01T00:00:00Z"),
};

const SENT_ANNOUNCEMENT_2 = {
  id: "ann-002",
  title: "New feature release",
  body: "We just launched model catalog v2!",
  link: null,
  status: "sent",
  createdBy: "0xadmin",
  sentAt: new Date("2025-06-02T10:00:00Z"),
  updatedAt: new Date("2025-06-02T10:00:00Z"),
  createdAt: new Date("2025-06-02T08:00:00Z"),
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("GET /api/user/announcements", () => {
  beforeEach(() => {
    mockFindRecentSent.mockReset();
  });

  it("returns recent sent announcements", async () => {
    mockFindRecentSent.mockResolvedValue([SENT_ANNOUNCEMENT_2, SENT_ANNOUNCEMENT_1]);

    const res = await app.request(
      new Request("http://localhost/api/user/announcements", { method: "GET" }),
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(2);
    expect(mockFindRecentSent).toHaveBeenCalledWith(10);
  });

  it("returns empty array when no sent announcements exist", async () => {
    mockFindRecentSent.mockResolvedValue([]);

    const res = await app.request(
      new Request("http://localhost/api/user/announcements", { method: "GET" }),
    );
    expect(res.status).toBe(200);

    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toHaveLength(0);
  });

  it("calls findRecentSent with limit 10", async () => {
    mockFindRecentSent.mockResolvedValue([SENT_ANNOUNCEMENT_1]);

    await app.request(new Request("http://localhost/api/user/announcements", { method: "GET" }));

    expect(mockFindRecentSent).toHaveBeenCalledTimes(1);
    expect(mockFindRecentSent).toHaveBeenCalledWith(10);
  });

  it("includes all announcement fields in response", async () => {
    mockFindRecentSent.mockResolvedValue([SENT_ANNOUNCEMENT_1]);

    const res = await app.request(
      new Request("http://localhost/api/user/announcements", { method: "GET" }),
    );
    const json = (await res.json()) as { data: (typeof SENT_ANNOUNCEMENT_1)[] };
    const ann = json.data[0] as Record<string, unknown>;

    expect(ann).toHaveProperty("id", "ann-001");
    expect(ann).toHaveProperty("title", "Platform maintenance");
    expect(ann).toHaveProperty("body", "Scheduled maintenance at 2am UTC");
    expect(ann).toHaveProperty("link", "https://status.example.com");
    expect(ann).toHaveProperty("status", "sent");
  });
});
