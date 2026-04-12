/**
 * AI provider CRUD routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import { createAiProviderBody, updateAiProviderBody } from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { aiProviderRepo } from "@/server/repos";

import { seedDefaultProviders } from "../lib/seed-providers";
import { formatProvider } from "./admin-ai-helpers";

const router = new Hono();

// ── Providers CRUD ──────────────────────────────────────────────────────

router.get("/providers", async (c) => {
  getAdminSession(c);
  let all = await aiProviderRepo.findAll();

  // Auto-seed default providers on first access (handles resetdb + re-login)
  if (all.length === 0) {
    await seedDefaultProviders();
    all = await aiProviderRepo.findAll();
  }

  return ok(c, all.map(formatProvider));
});

router.post("/providers", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiProviderBody);
  if (!parsed.ok) return parsed.response;
  const { authConfig, ...rest } = parsed.data;

  const existing = await aiProviderRepo.findByProviderId(rest.providerId);
  if (existing) return c.json({ error: "Provider ID already exists" }, 409);

  const created = await aiProviderRepo.create({
    ...rest,
    authConfig: JSON.stringify(authConfig ?? {}),
  });

  log.auth.info({ providerId: created.providerId }, "AI provider created");
  return ok(c, formatProvider(created), 201);
});

router.put("/providers/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiProviderRepo.findById(id);
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  const parsed = await parseBody(c, updateAiProviderBody);
  if (!parsed.ok) return parsed.response;
  const { authConfig, ...rest } = parsed.data;

  const updates: Record<string, unknown> = { ...rest };
  if (authConfig !== undefined) updates.authConfig = JSON.stringify(authConfig);

  const updated = await aiProviderRepo.update(id, updates);
  return ok(c, formatProvider(updated!));
});

router.delete("/providers/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiProviderRepo.findById(id);
  if (!existing) return c.json({ error: "Provider not found" }, 404);

  await aiProviderRepo.delete(id);
  log.auth.info({ providerId: existing.providerId }, "AI provider deleted");
  return ok(c, { success: true });
});

export default router;
