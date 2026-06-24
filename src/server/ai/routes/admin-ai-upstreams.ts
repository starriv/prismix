/**
 * Global AI upstream CRUD + health overview.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import {
  createAiUpstreamBody,
  createAiUpstreamModelMappingBody,
  updateAiUpstreamBody,
  updateAiUpstreamModelMappingBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  aiKeyRepo,
  aiProviderRepo,
  aiUpstreamAssignmentRepo,
  aiUpstreamModelMappingRepo,
  aiUpstreamRepo,
  aiUsageLogRepo,
} from "@/server/repos";

import { invalidateKeyPool } from "../lib/key-balancer";
import { invalidateModelMappingCache } from "../lib/model-mapping-cache";
import { invalidateUpstreamCacheForUpstream } from "../lib/upstream-routing";
import { formatUpstream } from "./admin-ai-helpers";

const router = new Hono();

// ── Global Upstream CRUD ─────────────────────────────────────────────

router.get("/upstreams", async (c) => {
  getAdminSession(c);
  const upstreams = await aiUpstreamRepo.findAll();
  return ok(c, upstreams.map(formatUpstream));
});

router.post("/upstreams", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiUpstreamBody);
  if (!parsed.ok) return parsed.response;

  const created = await aiUpstreamRepo.create({
    name: parsed.data.name,
    baseUrl: parsed.data.baseUrl,
    kind: parsed.data.kind ?? "custom",
    modelsEndpoint: parsed.data.modelsEndpoint ?? null,
    enabled: parsed.data.enabled ?? true,
    metadata: JSON.stringify(parsed.data.metadata ?? {}),
  });

  log.auth.info({ upstreamId: created.upstreamId }, "Global upstream created");
  return ok(c, formatUpstream(created), 201);
});

router.get("/upstreams/overview", async (c) => {
  getAdminSession(c);
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 24 * 30);

  const upstreams = await aiUpstreamRepo.findAll();
  const upstreamIds = upstreams.map((u) => u.id);

  const assignmentCounts = await aiUpstreamAssignmentRepo.countByUpstreamIds(upstreamIds);
  const keyCounts = await aiKeyRepo.countByUpstreamIds(upstreamIds);
  const keyCountMap = new Map(keyCounts.map((row) => [row.upstreamId, row]));
  const usageRows = await aiUsageLogRepo.upstreamOverview(hours);
  const usageMap = new Map(usageRows.map((row) => [row.upstreamId, row]));
  const latestMap = await aiUsageLogRepo.findLatestByUpstreamIds(upstreamIds);

  const items = upstreams.map((upstream) => {
    const keyStat = keyCountMap.get(upstream.id);
    const usage = usageMap.get(upstream.id);
    const latest = latestMap.get(upstream.id);
    const totalErrors = (usage?.clientErrors24h ?? 0) + (usage?.serverErrors24h ?? 0);
    const errorRate24h = usage && usage.requests24h > 0 ? totalErrors / usage.requests24h : 0;

    // Health determined by a 30-minute sliding window.
    const recentRequests = usage?.recentRequests ?? 0;
    const recentErrorRate =
      recentRequests > 0 ? (usage?.recentTotalErrors ?? 0) / recentRequests : 0;

    let healthStatus: "unknown" | "healthy" | "degraded" | "down" | "idle" | "no-key" | "disabled";
    if (!upstream.enabled) {
      healthStatus = "disabled";
    } else if (upstream.autoDisabled || upstream.healthStatus === "down") {
      healthStatus = "down";
    } else if ((keyStat?.enabledKeys ?? 0) === 0) {
      healthStatus = "no-key";
    } else if (upstream.healthStatus === "healthy" || upstream.healthStatus === "degraded") {
      healthStatus = upstream.healthStatus;
    } else if (recentRequests === 0) {
      healthStatus = "idle";
    } else if ((usage?.recentServerErrors ?? 0) > 0 || recentErrorRate >= 0.2) {
      healthStatus = "degraded";
    } else {
      healthStatus = "healthy";
    }

    return {
      id: upstream.id,
      upstreamId: upstream.upstreamId,
      name: upstream.name,
      baseUrl: upstream.baseUrl,
      kind: upstream.kind,
      modelsEndpoint: upstream.modelsEndpoint,
      enabled: upstream.enabled,
      autoDisabled: upstream.autoDisabled,
      assignmentCount: assignmentCounts.get(upstream.id) ?? 0,
      totalKeys: keyStat?.totalKeys ?? 0,
      enabledKeys: keyStat?.enabledKeys ?? 0,
      requests24h: usage?.requests24h ?? 0,
      clientErrors24h: usage?.clientErrors24h ?? 0,
      serverErrors24h: usage?.serverErrors24h ?? 0,
      totalTokens24h: usage?.totalTokens24h ?? 0,
      avgLatencyMs24h: usage?.avgLatencyMs24h ?? 0,
      errorRate24h,
      lastSeenAt: usage?.lastSeenAt ?? null,
      lastStatusCode: latest?.statusCode ?? null,
      lastError: latest?.error ?? null,
      healthStatus,
      lastCheckedAt: upstream.lastCheckedAt,
      consecutiveFailures: upstream.consecutiveFailures,
      updatedAt: upstream.updatedAt,
      createdAt: upstream.createdAt,
    };
  });

  return ok(c, {
    totals: {
      totalUpstreams: items.length,
      enabledUpstreams: items.filter((i) => i.enabled && !i.autoDisabled).length,
      activeUpstreams24h: items.filter((i) => i.requests24h > 0).length,
      degradedUpstreams30m: items.filter(
        (i) => i.healthStatus === "degraded" || i.healthStatus === "down",
      ).length,
    },
    upstreams: items,
  });
});

router.get("/upstreams/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiUpstreamRepo.findById(id);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const assignments = await aiUpstreamAssignmentRepo.findByUpstreamId(id);
  const providers = await aiProviderRepo.findAll();
  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const enrichedAssignments = assignments.map((a) => {
    const provider = providerMap.get(a.providerId);
    return {
      id: a.id,
      providerId: a.providerId,
      providerName: provider?.name ?? "Unknown",
      providerSlug: provider?.providerId ?? null,
      priority: a.priority,
      weight: a.weight,
      enabled: a.enabled,
    };
  });

  return ok(c, {
    ...formatUpstream(upstream),
    assignments: enrichedAssignments,
  });
});

router.put("/upstreams/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiUpstreamRepo.findById(id);
  if (!existing) return c.json({ error: "Upstream not found" }, 404);

  const parsed = await parseBody(c, updateAiUpstreamBody);
  if (!parsed.ok) return parsed.response;

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.metadata !== undefined) updates.metadata = JSON.stringify(parsed.data.metadata);
  if (parsed.data.enabled !== undefined) {
    updates.autoDisabled = false;
    updates.consecutiveFailures = 0;
    updates.healthStatus = "unknown";
    updates.lastError = null;
  }

  const updated = await aiUpstreamRepo.update(id, updates);

  // Invalidate all providers assigned to this upstream
  await invalidateUpstreamCacheForUpstream(id);
  const assignments = await aiUpstreamAssignmentRepo.findByUpstreamId(id);
  for (const a of assignments) {
    invalidateKeyPool(a.providerId);
    emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId: a.providerId });
    emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId: a.providerId });
  }

  return ok(c, formatUpstream(updated!));
});

router.delete("/upstreams/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiUpstreamRepo.findById(id);
  if (!existing) return c.json({ error: "Upstream not found" }, 404);

  // Invalidate caches before delete (cascade removes assignments + keys SET NULL)
  await invalidateUpstreamCacheForUpstream(id);
  const assignments = await aiUpstreamAssignmentRepo.findByUpstreamId(id);
  for (const a of assignments) {
    invalidateKeyPool(a.providerId);
    emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { providerId: a.providerId });
    emit(DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED, null, { providerId: a.providerId });
  }

  await aiUpstreamModelMappingRepo.deleteByUpstreamId(id);
  invalidateModelMappingCache(id);
  await aiUpstreamRepo.delete(id);

  log.auth.info({ upstreamId: existing.upstreamId }, "Global upstream deleted");
  return ok(c, { success: true });
});

router.get("/upstreams/:id/hourly", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiUpstreamRepo.findById(id);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 72);
  const rows = await aiUsageLogRepo.hourlyByUpstream(id, hours);
  return ok(c, rows);
});

router.get("/upstreams/:id/recent", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiUpstreamRepo.findById(id);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const limit = parsePaginationLimit(c.req.query("limit"));
  const logs = await aiUsageLogRepo.findAll(limit, 0, { upstreamId: id });
  return ok(c, logs);
});

// ── Model Mappings Sub-resource ─────────────────────────────────────

router.get("/upstreams/:id/model-mappings", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiUpstreamRepo.findById(id);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const mappings = await aiUpstreamModelMappingRepo.findByUpstreamId(id);
  return ok(c, mappings);
});

router.post("/upstreams/:id/model-mappings", async (c) => {
  getAdminSession(c);
  const upstreamId = Number(c.req.param("id"));
  if (Number.isNaN(upstreamId)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiUpstreamRepo.findById(upstreamId);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const parsed = await parseBody(c, createAiUpstreamModelMappingBody);
  if (!parsed.ok) return parsed.response;

  const created = await aiUpstreamModelMappingRepo.create({
    upstreamId,
    sourceModelId: parsed.data.sourceModelId,
    mappedModelId: parsed.data.mappedModelId,
    enabled: parsed.data.enabled ?? true,
  });

  invalidateModelMappingCache(upstreamId);
  log.auth.info(
    { upstreamId: upstream.upstreamId, sourceModelId: created.sourceModelId },
    "Model mapping created",
  );
  return ok(c, created, 201);
});

router.put("/upstreams/:id/model-mappings/:mappingId", async (c) => {
  getAdminSession(c);
  const upstreamId = Number(c.req.param("id"));
  const mappingId = Number(c.req.param("mappingId"));
  if (Number.isNaN(upstreamId) || Number.isNaN(mappingId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const mapping = await aiUpstreamModelMappingRepo.findById(mappingId);
  if (!mapping || mapping.upstreamId !== upstreamId) {
    return c.json({ error: "Model mapping not found" }, 404);
  }

  const parsed = await parseBody(c, updateAiUpstreamModelMappingBody);
  if (!parsed.ok) return parsed.response;

  const updated = await aiUpstreamModelMappingRepo.update(mappingId, parsed.data);
  invalidateModelMappingCache(upstreamId);
  return ok(c, updated);
});

router.delete("/upstreams/:id/model-mappings/:mappingId", async (c) => {
  getAdminSession(c);
  const upstreamId = Number(c.req.param("id"));
  const mappingId = Number(c.req.param("mappingId"));
  if (Number.isNaN(upstreamId) || Number.isNaN(mappingId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const mapping = await aiUpstreamModelMappingRepo.findById(mappingId);
  if (!mapping || mapping.upstreamId !== upstreamId) {
    return c.json({ error: "Model mapping not found" }, 404);
  }

  await aiUpstreamModelMappingRepo.delete(mappingId);
  invalidateModelMappingCache(upstreamId);
  return ok(c, { success: true });
});

export default router;
