/**
 * AI provider CRUD + upstream assignment routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
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
import {
  aiKeyRepo,
  aiProviderRepo,
  aiUpstreamAssignmentRepo,
  aiUpstreamRepo,
  aiUsageLogRepo,
} from "@/server/repos";

import { invalidateKeyPool } from "../lib/key-balancer";
import { seedDefaultProviders } from "../lib/seed-providers";
import { invalidateUpstreamCache } from "../lib/upstream-routing";
import { formatKeys, formatProvider, formatUpstream } from "./admin-ai-helpers";

const router = new Hono();

async function findProvidersWithDefaults() {
  let providers = await aiProviderRepo.findAll();

  // Auto-seed default providers on first access (handles resetdb + re-login).
  if (providers.length === 0) {
    await seedDefaultProviders();
    providers = await aiProviderRepo.findAll();
  }

  return providers;
}

// ── Providers CRUD ──────────────────────────────────────────────────────

router.get("/providers/overview", async (c) => {
  getAdminSession(c);
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 24 * 30);

  const providers = await findProvidersWithDefaults();
  const providerIds = providers.map((p) => p.id);

  const keyCounts = await aiKeyRepo.countByProviderIds(providerIds);
  const keyCountMap = new Map(keyCounts.map((row) => [row.providerId, row]));

  const usageRows = await aiUsageLogRepo.providerOverview(hours);
  const usageMap = new Map(usageRows.map((row) => [row.providerId, row]));

  const assignmentCounts = await aiUpstreamAssignmentRepo.countByProviderIds(providerIds);

  const items = providers.map((provider) => {
    const keyStat = keyCountMap.get(provider.id);
    const usage = usageMap.get(provider.providerId);
    const totalErrors = (usage?.clientErrors24h ?? 0) + (usage?.serverErrors24h ?? 0);
    const errorRate24h = usage && usage.requests24h > 0 ? totalErrors / usage.requests24h : 0;

    const recentRequests = usage?.recentRequests ?? 0;
    const recentErrorRate =
      recentRequests > 0 ? (usage?.recentTotalErrors ?? 0) / recentRequests : 0;

    let healthStatus: "unknown" | "healthy" | "degraded" | "down" | "idle" | "no-key" | "disabled";
    if (!provider.enabled) {
      healthStatus = "disabled";
    } else if (provider.autoDisabled || provider.healthStatus === "down") {
      healthStatus = "down";
    } else if ((keyStat?.enabledKeys ?? 0) === 0) {
      healthStatus = "no-key";
    } else if (provider.healthStatus === "healthy" || provider.healthStatus === "degraded") {
      healthStatus = provider.healthStatus;
    } else if (recentRequests === 0) {
      healthStatus = "idle";
    } else if ((usage?.recentServerErrors ?? 0) > 0 || recentErrorRate >= 0.2) {
      healthStatus = "degraded";
    } else {
      healthStatus = "healthy";
    }

    return {
      id: provider.id,
      providerId: provider.providerId,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      authType: provider.authType,
      iconUrl: provider.iconUrl,
      enabled: provider.enabled,
      autoDisabled: provider.autoDisabled,
      upstreamCount: assignmentCounts.get(provider.id) ?? 0,
      totalKeys: keyStat?.totalKeys ?? 0,
      enabledKeys: keyStat?.enabledKeys ?? 0,
      requests24h: usage?.requests24h ?? 0,
      clientErrors24h: usage?.clientErrors24h ?? 0,
      serverErrors24h: usage?.serverErrors24h ?? 0,
      totalTokens24h: usage?.totalTokens24h ?? 0,
      avgLatencyMs24h: usage?.avgLatencyMs24h ?? 0,
      errorRate24h,
      lastSeenAt: usage?.lastSeenAt ?? null,
      healthStatus,
      lastCheckedAt: provider.lastCheckedAt,
      lastError: provider.lastError,
      consecutiveFailures: provider.consecutiveFailures,
      updatedAt: provider.updatedAt,
      createdAt: provider.createdAt,
    };
  });

  return ok(c, {
    totals: {
      totalProviders: items.length,
      enabledProviders: items.filter((i) => i.enabled && !i.autoDisabled).length,
      activeProviders24h: items.filter((i) => i.requests24h > 0).length,
      degradedProviders30m: items.filter(
        (i) => i.healthStatus === "degraded" || i.healthStatus === "down",
      ).length,
    },
    providers: items,
  });
});

router.get("/providers", async (c) => {
  getAdminSession(c);
  const all = await findProvidersWithDefaults();

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
  if (parsed.data.enabled !== undefined) {
    updates.autoDisabled = false;
    updates.consecutiveFailures = 0;
    updates.healthStatus = "unknown";
    updates.lastError = null;
  }

  const updated = await aiProviderRepo.update(id, updates);

  if (
    parsed.data.enabled !== undefined ||
    parsed.data.baseUrl !== undefined ||
    parsed.data.upstreamRoutingStrategy !== undefined ||
    parsed.data.loadBalanceStrategy !== undefined ||
    parsed.data.officialConcurrencyLimit !== undefined ||
    parsed.data.officialQueueTimeoutMs !== undefined
  ) {
    invalidateUpstreamCache(id);
    invalidateKeyPool(id);
    emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId: id });
    emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId: id });
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

router.get("/providers/:id/keys", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const keys = await aiKeyRepo.findByProviderId(id);
  return ok(c, await formatKeys(keys));
});

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
  emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId: id });
  emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId: id });

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
  emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId });
  emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId });

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

  // Delete keys bound to this upstream — they cannot work with any other upstream
  const deletedKeys = await aiKeyRepo.deleteByProviderAndUpstream(providerId, existing.upstreamId);

  await aiUpstreamAssignmentRepo.delete(assignmentId);

  invalidateUpstreamCache(providerId);
  invalidateKeyPool(providerId);
  emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId });
  emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId });

  return ok(c, { success: true, deletedKeys });
});

export default router;
