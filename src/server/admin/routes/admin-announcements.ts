import { Hono } from "hono";

import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import {
  broadcastBody,
  createAnnouncementBody,
  updateAnnouncementBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { announcementRepo } from "@/server/repos";

const router = new Hono();

function validateAnnouncementWindow(
  startsAt?: Date | null,
  expiresAt?: Date | null,
): string | null {
  if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
    return "expiresAt must be after startsAt";
  }
  return null;
}

function announcementHasWebSurface(surfaces: string): boolean {
  try {
    const parsed: unknown = JSON.parse(surfaces);
    return Array.isArray(parsed) && parsed.includes("web");
  } catch {
    return false;
  }
}

// ── Announcements ────────────────────────────────────────────────

router.get("/announcements", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const [items, total] = await Promise.all([
    announcementRepo.findAll({ limit, offset }),
    announcementRepo.count(),
  ]);
  return ok(c, { items, total });
});

router.post("/announcements", async (c) => {
  const parsed = await parseBody(c, createAnnouncementBody);
  if (!parsed.ok) return parsed.response;
  const windowError = validateAnnouncementWindow(parsed.data.startsAt, parsed.data.expiresAt);
  if (windowError) return c.json({ error: windowError }, 400);

  const session = c.get("admin" as never) as { adminId: number; address?: string } | undefined;
  const createdBy = session?.address ?? "admin";

  const created = await announcementRepo.create({
    title: parsed.data.title,
    body: parsed.data.body,
    link: parsed.data.link || null,
    category: parsed.data.category,
    severity: parsed.data.severity,
    surfaces: JSON.stringify(parsed.data.surfaces),
    relatedModels: JSON.stringify(parsed.data.relatedModels),
    startsAt: parsed.data.startsAt ?? null,
    expiresAt: parsed.data.expiresAt ?? null,
    priority: parsed.data.priority,
    createdBy,
  });
  log.admin.info({ announcementId: created.id }, "Announcement draft created");
  return ok(c, created, 201);
});

router.put("/announcements/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const existing = await announcementRepo.findById(id);
  if (!existing) return c.json({ error: "Announcement not found" }, 404);

  const parsed = await parseBody(c, updateAnnouncementBody);
  if (!parsed.ok) return parsed.response;
  const startsAt = parsed.data.startsAt === undefined ? existing.startsAt : parsed.data.startsAt;
  const expiresAt =
    parsed.data.expiresAt === undefined ? existing.expiresAt : parsed.data.expiresAt;
  const windowError = validateAnnouncementWindow(startsAt, expiresAt);
  if (windowError) return c.json({ error: windowError }, 400);

  const { surfaces, relatedModels, ...updates } = parsed.data;
  const updated = await announcementRepo.update(id, {
    ...updates,
    ...(surfaces !== undefined ? { surfaces: JSON.stringify(surfaces) } : {}),
    ...(relatedModels !== undefined ? { relatedModels: JSON.stringify(relatedModels) } : {}),
  });
  return ok(c, updated);
});

router.delete("/announcements", async (c) => {
  const id = c.req.query("id");
  if (!id) return c.json({ error: "Missing id" }, 400);

  const existing = await announcementRepo.findById(id);
  if (!existing) return c.json({ error: "Announcement not found" }, 404);

  await announcementRepo.delete(id);
  log.admin.info({ announcementId: id }, "Announcement deleted");
  return ok(c, { success: true });
});

router.post("/announcements/:id/send", async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const existing = await announcementRepo.findById(id);
  if (!existing) return c.json({ error: "Announcement not found" }, 404);

  const updated = await announcementRepo.markSent(id);
  if (announcementHasWebSurface(existing.surfaces)) {
    emit(DOMAIN_EVENT_TYPES.SYSTEM_ANNOUNCEMENT, null, {
      id: existing.id,
      title: existing.title,
      body: existing.body,
    });
  }
  log.admin.info({ announcementId: id }, "Announcement sent");
  return ok(c, updated);
});

// ── Legacy Broadcast (backward compat) ──────────────────────────

router.post("/broadcast", async (c) => {
  try {
    const parsed = await parseBody(c, broadcastBody);
    if (!parsed.ok) return parsed.response;
    emit(DOMAIN_EVENT_TYPES.SYSTEM_ANNOUNCEMENT, null, {
      title: parsed.data.title,
      body: parsed.data.body,
    });
    return ok(c, { success: true });
  } catch (e) {
    log.admin.error({ err: e }, "Failed to send broadcast");
    return c.json({ error: "Failed to send broadcast" }, 500);
  }
});

export default router;
