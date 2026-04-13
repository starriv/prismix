/**
 * AI provider CRUD routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import {
  createAiProviderBody,
  createAiProviderUpstreamBody,
  updateAiProviderBody,
  updateAiProviderUpstreamBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { aiKeyRepo, aiProviderRepo, aiProviderUpstreamRepo, aiUsageLogRepo } from "@/server/repos";

import { invalidateKeyPool } from "../lib/key-balancer";
import { seedDefaultProviders } from "../lib/seed-providers";
import { invalidateUpstreamCache } from "../lib/upstream-routing";
import { formatProvider, formatProviderUpstream } from "./admin-ai-helpers";

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

router.get("/upstreams/overview", async (c) => {
  getAdminSession(c);
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 24 * 30);
  const providers = await aiProviderRepo.findAll();
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const upstreams = await Promise.all(
    providers.map((provider) => aiProviderUpstreamRepo.findByProviderId(provider.id)),
  ).then((groups) => groups.flat());

  const upstreamIds = upstreams.map((upstream) => upstream.id);
  const keyCounts = await aiKeyRepo.countByUpstreamIds(upstreamIds);
  const keyCountMap = new Map(keyCounts.map((row) => [row.upstreamId, row]));
  const usageRows = await aiUsageLogRepo.upstreamOverview(hours);
  const usageMap = new Map(usageRows.map((row) => [row.upstreamId, row]));

  const latestMap = await aiUsageLogRepo.findLatestByUpstreamIds(upstreamIds);

  const items = upstreams.map((upstream) => {
    const provider = providerMap.get(upstream.providerId);
    const keyStat = keyCountMap.get(upstream.id);
    const usage = usageMap.get(upstream.id);
    const latest = latestMap.get(upstream.id);
    const totalErrors = (usage?.clientErrors24h ?? 0) + (usage?.serverErrors24h ?? 0);
    const errorRate24h = usage && usage.requests24h > 0 ? totalErrors / usage.requests24h : 0;

    let healthStatus: "healthy" | "degraded" | "idle" | "no-key" | "disabled";
    if (!upstream.enabled) {
      healthStatus = "disabled";
    } else if ((keyStat?.enabledKeys ?? 0) === 0) {
      healthStatus = "no-key";
    } else if (!usage || usage.requests24h === 0) {
      healthStatus = "idle";
    } else if ((usage.serverErrors24h ?? 0) > 0 || errorRate24h >= 0.2) {
      healthStatus = "degraded";
    } else {
      healthStatus = "healthy";
    }

    return {
      id: upstream.id,
      providerDbId: upstream.providerId,
      providerId: provider?.providerId ?? null,
      providerName: provider?.name ?? null,
      name: upstream.name,
      upstreamId: upstream.upstreamId,
      baseUrl: upstream.baseUrl,
      kind: upstream.kind,
      enabled: upstream.enabled,
      priority: upstream.priority,
      weight: upstream.weight,
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
      updatedAt: upstream.updatedAt,
      createdAt: upstream.createdAt,
    };
  });

  return ok(c, {
    totals: {
      totalUpstreams: items.length,
      enabledUpstreams: items.filter((item) => item.enabled).length,
      activeUpstreams24h: items.filter((item) => item.requests24h > 0).length,
      degradedUpstreams24h: items.filter((item) => item.healthStatus === "degraded").length,
    },
    upstreams: items,
  });
});

router.get("/upstreams/:id/recent", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const upstream = await aiProviderUpstreamRepo.findById(id);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 10, 1), 50);
  const logs = await aiUsageLogRepo.findAll(limit, 0, { upstreamId: id });
  return ok(c, logs);
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

router.get("/providers/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const rows = await aiProviderUpstreamRepo.findByProviderId(id);
  return ok(c, rows.map(formatProviderUpstream));
});

router.post("/providers/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const parsed = await parseBody(c, createAiProviderUpstreamBody);
  if (!parsed.ok) return parsed.response;

  const existing = await aiProviderUpstreamRepo.findByProviderAndUpstreamId(
    id,
    parsed.data.upstreamId,
  );
  if (existing) return c.json({ error: "Upstream ID already exists for this provider" }, 409);

  const created = await aiProviderUpstreamRepo.create({
    providerId: id,
    upstreamId: parsed.data.upstreamId,
    name: parsed.data.name,
    baseUrl: parsed.data.baseUrl,
    kind: parsed.data.kind ?? "custom",
    priority: parsed.data.priority ?? 100,
    weight: parsed.data.weight ?? 1,
    enabled: parsed.data.enabled ?? true,
    metadata: JSON.stringify(parsed.data.metadata ?? {}),
  });

  invalidateUpstreamCache(id);
  invalidateKeyPool(id);

  log.auth.info(
    { providerId: provider.providerId, upstreamId: created.upstreamId },
    "AI provider upstream created",
  );
  return ok(c, formatProviderUpstream(created), 201);
});

router.put("/providers/:providerId/upstreams/:upstreamDbId", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("providerId"));
  const upstreamDbId = Number(c.req.param("upstreamDbId"));
  if (Number.isNaN(providerId) || Number.isNaN(upstreamDbId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const existing = await aiProviderUpstreamRepo.findById(upstreamDbId);
  if (!existing || existing.providerId !== providerId) {
    return c.json({ error: "Upstream not found" }, 404);
  }

  const parsed = await parseBody(c, updateAiProviderUpstreamBody);
  if (!parsed.ok) return parsed.response;

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.metadata !== undefined) updates.metadata = JSON.stringify(parsed.data.metadata);

  const updated = await aiProviderUpstreamRepo.update(upstreamDbId, updates);

  invalidateUpstreamCache(providerId);
  invalidateKeyPool(providerId);

  return ok(c, formatProviderUpstream(updated!));
});

router.delete("/providers/:providerId/upstreams/:upstreamDbId", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("providerId"));
  const upstreamDbId = Number(c.req.param("upstreamDbId"));
  if (Number.isNaN(providerId) || Number.isNaN(upstreamDbId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const existing = await aiProviderUpstreamRepo.findById(upstreamDbId);
  if (!existing || existing.providerId !== providerId) {
    return c.json({ error: "Upstream not found" }, 404);
  }

  await aiProviderUpstreamRepo.delete(upstreamDbId);

  invalidateUpstreamCache(providerId);
  invalidateKeyPool(providerId);

  return ok(c, { success: true });
});

export default router;
