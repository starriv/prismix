/**
 * AI provider CRUD + upstream assignment routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import { emit } from "@/server/events";
import {
  createAiProviderBody,
  createAiUpstreamAssignmentBody,
  updateAiProviderBody,
  updateAiUpstreamAssignmentBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { aiProviderRepo, aiUpstreamAssignmentRepo, aiUpstreamRepo } from "@/server/repos";

import { invalidateKeyPool } from "../lib/key-balancer";
import { seedDefaultProviders } from "../lib/seed-providers";
import { invalidateUpstreamCache } from "../lib/upstream-routing";
import { formatProvider, formatUpstream } from "./admin-ai-helpers";

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

  const counts = await aiUpstreamAssignmentRepo.countByProviderIds(
    all.map((provider) => provider.id),
  );

  return ok(
    c,
    all.map((provider) => ({
      ...formatProvider(provider),
      upstreamCount: counts.get(provider.id) ?? 0,
    })),
  );
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

  if (
    parsed.data.baseUrl !== undefined ||
    parsed.data.upstreamRoutingStrategy !== undefined ||
    parsed.data.loadBalanceStrategy !== undefined
  ) {
    invalidateUpstreamCache(id);
    invalidateKeyPool(id);
    emit("ai.upstream-cache-invalidated", null, { providerId: id });
    emit("ai.key-pool-invalidated", null, { providerId: id });
  }

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

// ── Provider ↔ Upstream Assignments ──────────────────────────────────

router.get("/providers/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const assignments = await aiUpstreamAssignmentRepo.findByProviderId(id);
  return ok(
    c,
    assignments.map((a) => ({
      id: a.id,
      providerId: a.providerId,
      upstream: formatUpstream(a.upstream),
      priority: a.priority,
      weight: a.weight,
      enabled: a.enabled,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  );
});

router.post("/providers/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const parsed = await parseBody(c, createAiUpstreamAssignmentBody);
  if (!parsed.ok) return parsed.response;

  const upstream = await aiUpstreamRepo.findById(parsed.data.upstreamId);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const existing = await aiUpstreamAssignmentRepo.findByProviderAndUpstreamId(
    id,
    parsed.data.upstreamId,
  );
  if (existing) return c.json({ error: "Upstream already assigned to this provider" }, 409);

  const created = await aiUpstreamAssignmentRepo.create({
    providerId: id,
    upstreamId: parsed.data.upstreamId,
    priority: parsed.data.priority ?? 100,
    weight: parsed.data.weight ?? 1,
    enabled: parsed.data.enabled ?? true,
  });

  invalidateUpstreamCache(id);
  invalidateKeyPool(id);
  emit("ai.upstream-cache-invalidated", null, { providerId: id });
  emit("ai.key-pool-invalidated", null, { providerId: id });

  log.auth.info(
    { providerId: provider.providerId, upstreamId: upstream.upstreamId },
    "Upstream assigned to provider",
  );
  return ok(c, created, 201);
});

router.put("/providers/:providerId/upstreams/:assignmentId", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("providerId"));
  const assignmentId = Number(c.req.param("assignmentId"));
  if (Number.isNaN(providerId) || Number.isNaN(assignmentId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const existing = await aiUpstreamAssignmentRepo.findById(assignmentId);
  if (!existing || existing.providerId !== providerId) {
    return c.json({ error: "Assignment not found" }, 404);
  }

  const parsed = await parseBody(c, updateAiUpstreamAssignmentBody);
  if (!parsed.ok) return parsed.response;

  const updated = await aiUpstreamAssignmentRepo.update(assignmentId, parsed.data);

  invalidateUpstreamCache(providerId);
  invalidateKeyPool(providerId);
  emit("ai.upstream-cache-invalidated", null, { providerId });
  emit("ai.key-pool-invalidated", null, { providerId });

  return ok(c, updated);
});

router.delete("/providers/:providerId/upstreams/:assignmentId", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("providerId"));
  const assignmentId = Number(c.req.param("assignmentId"));
  if (Number.isNaN(providerId) || Number.isNaN(assignmentId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const existing = await aiUpstreamAssignmentRepo.findById(assignmentId);
  if (!existing || existing.providerId !== providerId) {
    return c.json({ error: "Assignment not found" }, 404);
  }

  // Null out keys bound to this upstream for this provider
  const affectedKeys = await aiUpstreamAssignmentRepo.nullKeysForAssignment(
    providerId,
    existing.upstreamId,
  );

  await aiUpstreamAssignmentRepo.delete(assignmentId);

  invalidateUpstreamCache(providerId);
  invalidateKeyPool(providerId);
  emit("ai.upstream-cache-invalidated", null, { providerId });
  emit("ai.key-pool-invalidated", null, { providerId });

  return ok(c, { success: true, affectedKeys });
});

export default router;
