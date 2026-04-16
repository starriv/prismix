import { Hono } from "hono";

import { emit } from "@/server/events";
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

// ── Announcements ────────────────────────────────────────────────

router.get("/announcements", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const all = await announcementRepo.findAll({ limit, offset });
  return ok(c, all);
});

router.post("/announcements", async (c) => {
  const parsed = await parseBody(c, createAnnouncementBody);
  if (!parsed.ok) return parsed.response;

  const session = c.get("admin" as never) as { adminId: number; address?: string } | undefined;
  const createdBy = session?.address ?? "admin";

  const created = await announcementRepo.create({
    title: parsed.data.title,
    body: parsed.data.body,
    link: parsed.data.link || null,
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

  const updated = await announcementRepo.update(id, parsed.data);
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
  emit("system.announcement", null, {
    id: existing.id,
    title: existing.title,
    body: existing.body,
  });
  log.admin.info({ announcementId: id }, "Announcement sent");
  return ok(c, updated);
});

// ── Legacy Broadcast (backward compat) ──────────────────────────

router.post("/broadcast", async (c) => {
  try {
    const parsed = await parseBody(c, broadcastBody);
    if (!parsed.ok) return parsed.response;
    emit("system.announcement", null, { title: parsed.data.title, body: parsed.data.body });
    return ok(c, { success: true });
  } catch (e) {
    log.admin.error({ err: e }, "Failed to send broadcast");
    return c.json({ error: "Failed to send broadcast" }, 500);
  }
});

export default router;
