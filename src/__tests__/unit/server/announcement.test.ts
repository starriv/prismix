// ── Import admin router AFTER mocks ──────────────────────────────────
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnnouncementBody, updateAnnouncementBody } from "@/server/lib/body-schemas";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockFindAll = vi.fn();
const mockFindById = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockMarkSent = vi.fn();
const mockCount = vi.fn();

vi.mock("@/server/repos", () => ({
  announcementRepo: {
    findAll: (...args: unknown[]) => mockFindAll(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
    markSent: (...args: unknown[]) => mockMarkSent(...args),
    count: (...args: unknown[]) => mockCount(...args),
  },
}));

const mockEmit = vi.fn();
vi.mock("@/server/events", () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

vi.mock("@/server/lib/logger", () => ({
  log: {
    admin: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

// Build a minimal test app mounting the admin announcements routes
// We import the router and mount it without auth middleware
const { default: adminAnnouncementsRouter } =
  await import("@/server/admin/routes/admin-announcements");
const app = new Hono();
// Inject a fake admin session for all requests
app.use("/*", async (c, next) => {
  c.set("admin" as never, { adminId: 1, address: "0xadmin" } as never);
  await next();
});
app.route("/api/admin", adminAnnouncementsRouter);

// ── Helpers ──────────────────────────────────────────────────────────

function resetMocks() {
  mockFindAll.mockReset();
  mockFindById.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockMarkSent.mockReset();
  mockCount.mockReset();
  mockEmit.mockReset();
}

function jsonReq(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

const DRAFT_ANNOUNCEMENT = {
  id: "abc123",
  title: "Maintenance window",
  body: "Scheduled maintenance at 2am UTC",
  category: "general",
  severity: "info",
  surfaces: JSON.stringify(["web"]),
  relatedModels: JSON.stringify([]),
  startsAt: null,
  expiresAt: null,
  priority: 0,
  status: "draft",
  createdBy: "0xadmin",
  createdAt: new Date("2025-01-01"),
  sentAt: null,
};

const SENT_ANNOUNCEMENT = {
  ...DRAFT_ANNOUNCEMENT,
  id: "def456",
  status: "sent",
  sentAt: new Date("2025-01-02"),
};

// ─────────────────────────────────────────────────────────────────────
// 1. Body Schema Validation
// ─────────────────────────────────────────────────────────────────────

describe("createAnnouncementBody schema", () => {
  it("accepts valid input", () => {
    const result = createAnnouncementBody.safeParse({
      title: "System Update",
      body: "We are performing a scheduled upgrade.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createAnnouncementBody.safeParse({ title: "", body: "Some body" });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = createAnnouncementBody.safeParse({ body: "Some body" });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 characters", () => {
    const result = createAnnouncementBody.safeParse({
      title: "a".repeat(201),
      body: "Valid body",
    });
    expect(result.success).toBe(false);
  });

  it("accepts title at exactly 200 characters", () => {
    const result = createAnnouncementBody.safeParse({
      title: "a".repeat(200),
      body: "Valid body",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty body", () => {
    const result = createAnnouncementBody.safeParse({ title: "Title", body: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing body", () => {
    const result = createAnnouncementBody.safeParse({ title: "Title" });
    expect(result.success).toBe(false);
  });

  it("rejects body over 5000 characters", () => {
    const result = createAnnouncementBody.safeParse({
      title: "Title",
      body: "x".repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts body at exactly 5000 characters", () => {
    const result = createAnnouncementBody.safeParse({
      title: "Title",
      body: "x".repeat(5000),
    });
    expect(result.success).toBe(true);
  });

  it("rejects completely empty object", () => {
    const result = createAnnouncementBody.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("updateAnnouncementBody schema", () => {
  it("accepts partial update with title only", () => {
    const result = updateAnnouncementBody.safeParse({ title: "New Title" });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with body only", () => {
    const result = updateAnnouncementBody.safeParse({ body: "New body content" });
    expect(result.success).toBe(true);
  });

  it("accepts update with both fields", () => {
    const result = updateAnnouncementBody.safeParse({
      title: "Updated Title",
      body: "Updated body",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (no fields to update)", () => {
    const result = updateAnnouncementBody.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects title over 200 characters", () => {
    const result = updateAnnouncementBody.safeParse({ title: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects empty string title (min 1)", () => {
    const result = updateAnnouncementBody.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects body over 5000 characters", () => {
    const result = updateAnnouncementBody.safeParse({ body: "x".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("rejects empty string body (min 1)", () => {
    const result = updateAnnouncementBody.safeParse({ body: "" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Route Handler — CRUD Operations
// ─────────────────────────────────────────────────────────────────────

describe("announcement route handlers", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── GET /announcements ─────────────────────────────────────────────

  describe("GET /api/admin/announcements", () => {
    it("returns all announcements with default pagination", async () => {
      mockFindAll.mockResolvedValue([DRAFT_ANNOUNCEMENT, SENT_ANNOUNCEMENT]);
      mockCount.mockResolvedValue(2);

      const res = await app.request(jsonReq("GET", "/api/admin/announcements"));
      expect(res.status).toBe(200);

      const json = (await res.json()) as { data: { items: unknown[]; total: number } };
      expect(json.data.items).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(mockFindAll).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });

    it("returns empty array when no announcements exist", async () => {
      mockFindAll.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const res = await app.request(jsonReq("GET", "/api/admin/announcements"));
      expect(res.status).toBe(200);

      const json = (await res.json()) as { data: { items: unknown[]; total: number } };
      expect(json.data.items).toHaveLength(0);
      expect(json.data.total).toBe(0);
    });

    it("passes explicit limit and offset query params to repo", async () => {
      mockFindAll.mockResolvedValue([DRAFT_ANNOUNCEMENT]);
      mockCount.mockResolvedValue(1);

      const res = await app.request(jsonReq("GET", "/api/admin/announcements?limit=10&offset=20"));
      expect(res.status).toBe(200);
      expect(mockFindAll).toHaveBeenCalledWith({ limit: 10, offset: 20 });
    });
  });

  // ── POST /announcements ────────────────────────────────────────────

  describe("POST /api/admin/announcements", () => {
    it("creates a draft announcement", async () => {
      mockCreate.mockResolvedValue(DRAFT_ANNOUNCEMENT);

      const res = await app.request(
        jsonReq("POST", "/api/admin/announcements", {
          title: "Maintenance window",
          body: "Scheduled maintenance at 2am UTC",
        }),
      );
      expect(res.status).toBe(201);

      const json = (await res.json()) as { data: typeof DRAFT_ANNOUNCEMENT };
      expect(json.data.title).toBe("Maintenance window");
      expect(mockCreate).toHaveBeenCalledWith({
        title: "Maintenance window",
        body: "Scheduled maintenance at 2am UTC",
        link: null,
        category: "general",
        severity: "info",
        surfaces: JSON.stringify(["web"]),
        relatedModels: JSON.stringify([]),
        startsAt: null,
        expiresAt: null,
        priority: 0,
        createdBy: "0xadmin",
      });
    });

    it("creates a CLI/model-error announcement with metadata", async () => {
      mockCreate.mockResolvedValue(DRAFT_ANNOUNCEMENT);

      const res = await app.request(
        jsonReq("POST", "/api/admin/announcements", {
          title: "Model retirement",
          body: "gpt-old will be retired.",
          category: "model_retirement",
          severity: "critical",
          surfaces: ["cli", "model_error"],
          relatedModels: ["gpt-old", "gpt-legacy-*"],
          startsAt: "2026-06-24T10:00:00.000Z",
          expiresAt: "2026-07-01T10:00:00.000Z",
          priority: 50,
        }),
      );

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith({
        title: "Model retirement",
        body: "gpt-old will be retired.",
        link: null,
        category: "model_retirement",
        severity: "critical",
        surfaces: JSON.stringify(["cli", "model_error"]),
        relatedModels: JSON.stringify(["gpt-old", "gpt-legacy-*"]),
        startsAt: new Date("2026-06-24T10:00:00.000Z"),
        expiresAt: new Date("2026-07-01T10:00:00.000Z"),
        priority: 50,
        createdBy: "0xadmin",
      });
    });

    it("rejects an announcement window where expiresAt is before startsAt", async () => {
      const res = await app.request(
        jsonReq("POST", "/api/admin/announcements", {
          title: "Bad window",
          body: "Invalid time range",
          startsAt: "2026-07-01T10:00:00.000Z",
          expiresAt: "2026-06-24T10:00:00.000Z",
        }),
      );

      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("rejects invalid body (missing title)", async () => {
      const res = await app.request(
        jsonReq("POST", "/api/admin/announcements", { body: "content" }),
      );
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("rejects invalid body (missing body field)", async () => {
      const res = await app.request(
        jsonReq("POST", "/api/admin/announcements", { title: "Title" }),
      );
      expect(res.status).toBe(400);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── PUT /announcements/:id ─────────────────────────────────────────

  describe("PUT /api/admin/announcements/:id", () => {
    it("updates a draft announcement", async () => {
      const updated = { ...DRAFT_ANNOUNCEMENT, title: "Updated title" };
      mockFindById.mockResolvedValue(DRAFT_ANNOUNCEMENT);
      mockUpdate.mockResolvedValue(updated);

      const res = await app.request(
        jsonReq("PUT", "/api/admin/announcements/abc123", { title: "Updated title" }),
      );
      expect(res.status).toBe(200);

      const json = (await res.json()) as { data: typeof updated };
      expect(json.data.title).toBe("Updated title");
      expect(mockUpdate).toHaveBeenCalledWith("abc123", { title: "Updated title" });
    });

    it("serializes surface and related model updates", async () => {
      const updated = { ...DRAFT_ANNOUNCEMENT, surfaces: JSON.stringify(["cli"]) };
      mockFindById.mockResolvedValue(DRAFT_ANNOUNCEMENT);
      mockUpdate.mockResolvedValue(updated);

      const res = await app.request(
        jsonReq("PUT", "/api/admin/announcements/abc123", {
          surfaces: ["cli"],
          relatedModels: ["gpt-4.1"],
        }),
      );
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledWith("abc123", {
        surfaces: JSON.stringify(["cli"]),
        relatedModels: JSON.stringify(["gpt-4.1"]),
      });
    });

    it("allows updating a sent announcement", async () => {
      const updated = { ...SENT_ANNOUNCEMENT, title: "Updated title" };
      mockFindById.mockResolvedValue(SENT_ANNOUNCEMENT);
      mockUpdate.mockResolvedValue(updated);

      const res = await app.request(
        jsonReq("PUT", "/api/admin/announcements/def456", { title: "Updated title" }),
      );
      expect(res.status).toBe(200);

      const json = (await res.json()) as { data: typeof updated };
      expect(json.data.title).toBe("Updated title");
      expect(mockUpdate).toHaveBeenCalledWith("def456", { title: "Updated title" });
    });

    it("returns 404 for non-existent announcement", async () => {
      mockFindById.mockResolvedValue(undefined);

      const res = await app.request(
        jsonReq("PUT", "/api/admin/announcements/nonexistent", { title: "Nope" }),
      );
      expect(res.status).toBe(404);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  // ── DELETE /announcements ──────────────────────────────────────────

  describe("DELETE /api/admin/announcements", () => {
    it("deletes an existing announcement", async () => {
      mockFindById.mockResolvedValue(DRAFT_ANNOUNCEMENT);
      mockDelete.mockResolvedValue(undefined);

      const res = await app.request(jsonReq("DELETE", "/api/admin/announcements?id=abc123"));
      expect(res.status).toBe(200);

      const json = (await res.json()) as { data: { success: boolean } };
      expect(json.data.success).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith("abc123");
    });

    it("returns 404 for non-existent announcement", async () => {
      mockFindById.mockResolvedValue(undefined);

      const res = await app.request(jsonReq("DELETE", "/api/admin/announcements?id=nonexistent"));
      expect(res.status).toBe(404);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("returns 400 when id query param is missing", async () => {
      const res = await app.request(jsonReq("DELETE", "/api/admin/announcements"));
      expect(res.status).toBe(400);

      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("id");
    });
  });

  // ── POST /announcements/:id/send ───────────────────────────────────

  describe("POST /api/admin/announcements/:id/send", () => {
    it("sends a draft announcement and emits system.announcement event", async () => {
      const sentVersion = { ...DRAFT_ANNOUNCEMENT, status: "sent", sentAt: new Date() };
      mockFindById.mockResolvedValue(DRAFT_ANNOUNCEMENT);
      mockMarkSent.mockResolvedValue(sentVersion);

      const res = await app.request(jsonReq("POST", "/api/admin/announcements/abc123/send"));
      expect(res.status).toBe(200);

      expect(mockMarkSent).toHaveBeenCalledWith("abc123");

      expect(mockEmit).toHaveBeenCalledTimes(1);
      expect(mockEmit).toHaveBeenCalledWith("system.announcement", null, {
        id: DRAFT_ANNOUNCEMENT.id,
        title: DRAFT_ANNOUNCEMENT.title,
        body: DRAFT_ANNOUNCEMENT.body,
      });
    });

    it("allows re-sending a sent announcement", async () => {
      const reSent = { ...SENT_ANNOUNCEMENT, sentAt: new Date() };
      mockFindById.mockResolvedValue(SENT_ANNOUNCEMENT);
      mockMarkSent.mockResolvedValue(reSent);

      const res = await app.request(jsonReq("POST", "/api/admin/announcements/def456/send"));
      expect(res.status).toBe(200);

      expect(mockMarkSent).toHaveBeenCalledWith("def456");
      expect(mockEmit).toHaveBeenCalledWith("system.announcement", null, {
        id: SENT_ANNOUNCEMENT.id,
        title: SENT_ANNOUNCEMENT.title,
        body: SENT_ANNOUNCEMENT.body,
      });
    });

    it("does not emit web broadcast for CLI-only announcements", async () => {
      const cliOnly = { ...DRAFT_ANNOUNCEMENT, surfaces: JSON.stringify(["cli"]) };
      mockFindById.mockResolvedValue(cliOnly);
      mockMarkSent.mockResolvedValue({ ...cliOnly, status: "sent" });

      const res = await app.request(jsonReq("POST", "/api/admin/announcements/abc123/send"));
      expect(res.status).toBe(200);

      expect(mockMarkSent).toHaveBeenCalledWith("abc123");
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("returns 404 for non-existent announcement", async () => {
      mockFindById.mockResolvedValue(undefined);

      const res = await app.request(jsonReq("POST", "/api/admin/announcements/nonexistent/send"));
      expect(res.status).toBe(404);
      expect(mockMarkSent).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("emits event with original title and body (not updated values)", async () => {
      const draft = {
        ...DRAFT_ANNOUNCEMENT,
        title: "Original Title",
        body: "Original Body",
      };
      mockFindById.mockResolvedValue(draft);
      mockMarkSent.mockResolvedValue({ ...draft, status: "sent" });

      await app.request(jsonReq("POST", "/api/admin/announcements/abc123/send"));

      expect(mockEmit).toHaveBeenCalledWith("system.announcement", null, {
        id: "abc123",
        title: "Original Title",
        body: "Original Body",
      });
    });
  });
});
