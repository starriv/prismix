/**
 * AI supplier, endpoint, and endpoint-upstream management routes.
 *
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";

import { type AiSupplierConnection } from "@/server/db";
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import {
  createAiEndpointBody,
  createAiSupplierBody,
  createAiUpstreamAssignmentBody,
  updateAiEndpointBody,
  updateAiSupplierBody,
  updateAiUpstreamAssignmentBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  aiEndpointCredentialRepo,
  aiEndpointRepo,
  aiSupplierRepo,
  aiUpstreamAssignmentRepo,
  aiUpstreamRepo,
  aiUsageLogRepo,
} from "@/server/repos";

import { resolveConnectorRuntimeConfig } from "../lib/connector-runtime-config";
import { invalidateCredentialPool } from "../lib/credential-balancer";
import { seedDefaultEndpoints } from "../lib/seed-endpoints";
import { invalidateUpstreamCache } from "../lib/upstream-routing";
import {
  formatEndpointCredentials,
  formatEndpointWithSupplier,
  formatSupplier,
  formatUpstream,
} from "./admin-ai-helpers";

const router = new Hono();
type ConnectorConfigMode = "inherit" | "override";

function emitEndpointInvalidated(endpointId: number, upstreamId?: number | null): void {
  invalidateUpstreamCache(endpointId);
  invalidateCredentialPool(endpointId, upstreamId);
  emit(DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED, null, { endpointId });
  emit(DOMAIN_EVENT_TYPES.AI_CREDENTIAL_POOL_INVALIDATED, null, {
    endpointId,
    upstreamId: upstreamId ?? undefined,
  });
}

function inferAuthMode(input: {
  authMode?: ConnectorConfigMode;
  authType?: string;
  authConfig?: Record<string, unknown>;
}): ConnectorConfigMode {
  return (
    input.authMode ??
    (input.authType !== undefined || input.authConfig !== undefined ? "override" : "inherit")
  );
}

function inferConcurrencyMode(input: {
  concurrencyMode?: ConnectorConfigMode;
  officialConcurrencyLimit?: number | null;
  officialQueueTimeoutMs?: number;
}): ConnectorConfigMode {
  return (
    input.concurrencyMode ??
    (input.officialConcurrencyLimit !== undefined || input.officialQueueTimeoutMs !== undefined
      ? "override"
      : "inherit")
  );
}

async function syncInheritedSupplierDefaults(
  supplierId: number,
  previous: {
    authType: string;
    authConfig: string;
    officialConcurrencyLimit: number | null;
    officialQueueTimeoutMs: number;
  },
  updates: Record<string, unknown>,
): Promise<void> {
  const runtimeFields = [
    "authType",
    "authConfig",
    "officialConcurrencyLimit",
    "officialQueueTimeoutMs",
  ];
  if (!runtimeFields.some((field) => updates[field] !== undefined)) return;

  const nextDefaults = {
    authType: (updates.authType as string | undefined) ?? previous.authType,
    authConfig: (updates.authConfig as string | undefined) ?? previous.authConfig,
    officialConcurrencyLimit:
      updates.officialConcurrencyLimit !== undefined
        ? (updates.officialConcurrencyLimit as number | null)
        : previous.officialConcurrencyLimit,
    officialQueueTimeoutMs:
      (updates.officialQueueTimeoutMs as number | undefined) ?? previous.officialQueueTimeoutMs,
  };

  const authSets: Partial<AiSupplierConnection> = {};
  if (updates.authType !== undefined) authSets.authType = nextDefaults.authType;
  if (updates.authConfig !== undefined) authSets.authConfig = nextDefaults.authConfig;
  const affectedAuthIds = await aiEndpointRepo.updateInheritedBySupplier(
    supplierId,
    "auth",
    authSets,
  );

  const concurrencySets: Partial<AiSupplierConnection> = {};
  if (updates.officialConcurrencyLimit !== undefined) {
    concurrencySets.officialConcurrencyLimit = nextDefaults.officialConcurrencyLimit;
  }
  if (updates.officialQueueTimeoutMs !== undefined) {
    concurrencySets.officialQueueTimeoutMs = nextDefaults.officialQueueTimeoutMs;
  }
  const affectedConcurrencyIds = await aiEndpointRepo.updateInheritedBySupplier(
    supplierId,
    "concurrency",
    concurrencySets,
  );

  const affectedIds = new Set([...affectedAuthIds, ...affectedConcurrencyIds]);
  for (const id of affectedIds) {
    emitEndpointInvalidated(id);
  }
}

async function findEndpointsWithDefaults() {
  let endpoints = await aiEndpointRepo.findAllWithSupplier();

  if (endpoints.length === 0) {
    await seedDefaultEndpoints();
    endpoints = await aiEndpointRepo.findAllWithSupplier();
  }

  return endpoints;
}

// ── Suppliers ────────────────────────────────────────────────────────

router.get("/suppliers", async (c) => {
  getAdminSession(c);
  const suppliers = await aiSupplierRepo.findAll();
  return ok(c, suppliers.map(formatSupplier));
});

router.post("/suppliers", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiSupplierBody);
  if (!parsed.ok) return parsed.response;
  const { authConfig, iconUrl, officialConcurrencyLimit, officialQueueTimeoutMs, ...rest } =
    parsed.data;

  const existing = await aiSupplierRepo.findBySupplierId(rest.supplierId);
  if (existing) return c.json({ error: "Supplier ID already exists" }, 409);

  const created = await aiSupplierRepo.create({
    ...rest,
    authType: rest.authType ?? "bearer",
    authConfig: JSON.stringify(authConfig ?? {}),
    officialConcurrencyLimit: officialConcurrencyLimit ?? null,
    officialQueueTimeoutMs: officialQueueTimeoutMs ?? 30_000,
    iconUrl: iconUrl || null,
    enabled: rest.enabled ?? true,
  });

  log.auth.info({ supplierId: created.supplierId }, "AI supplier created");
  return ok(c, formatSupplier(created), 201);
});

router.put("/suppliers/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiSupplierRepo.findById(id);
  if (!existing) return c.json({ error: "Supplier not found" }, 404);

  const parsed = await parseBody(c, updateAiSupplierBody);
  if (!parsed.ok) return parsed.response;
  const { authConfig, iconUrl, ...rest } = parsed.data;

  const updates: Record<string, unknown> = { ...rest };
  if (authConfig !== undefined) updates.authConfig = JSON.stringify(authConfig);
  if (iconUrl !== undefined) updates.iconUrl = iconUrl || null;

  const updated = await aiSupplierRepo.update(id, updates);
  await syncInheritedSupplierDefaults(id, existing, updates);

  return ok(c, formatSupplier(updated!));
});

router.delete("/suppliers/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiSupplierRepo.findById(id);
  if (!existing) return c.json({ error: "Supplier not found" }, 404);

  await aiSupplierRepo.delete(id);
  log.auth.info({ supplierId: existing.supplierId }, "AI supplier deleted");
  return ok(c, { success: true });
});

// ── Endpoints ────────────────────────────────────────────────────────

router.get("/endpoints/overview", async (c) => {
  getAdminSession(c);
  const hours = Math.min(Math.max(Number(c.req.query("hours")) || 24, 1), 24 * 30);

  const endpoints = await findEndpointsWithDefaults();
  const endpointIds = endpoints.map((endpoint) => endpoint.id);

  const credentialCounts = await aiEndpointCredentialRepo.countByEndpointIds(endpointIds);
  const credentialCountMap = new Map(credentialCounts.map((row) => [row.endpointId, row]));

  const usageRows = await aiUsageLogRepo.endpointOverview(hours);
  const usageMap = new Map(usageRows.map((row) => [row.endpointId, row]));

  const assignmentCounts = await aiUpstreamAssignmentRepo.countByEndpointIds(endpointIds);

  const items = endpoints.map((endpoint) => {
    const runtime = resolveConnectorRuntimeConfig(endpoint);
    const credentialStat = credentialCountMap.get(endpoint.id);
    const usage = usageMap.get(endpoint.endpointId);
    const totalErrors = (usage?.clientErrors24h ?? 0) + (usage?.serverErrors24h ?? 0);
    const errorRate24h = usage && usage.requests24h > 0 ? totalErrors / usage.requests24h : 0;

    const recentRequests = usage?.recentRequests ?? 0;
    const recentErrorRate =
      recentRequests > 0 ? (usage?.recentTotalErrors ?? 0) / recentRequests : 0;

    let healthStatus: "unknown" | "healthy" | "degraded" | "down" | "idle" | "no-key" | "disabled";
    if (!endpoint.enabled || !endpoint.supplier.enabled) {
      healthStatus = "disabled";
    } else if (endpoint.autoDisabled || endpoint.healthStatus === "down") {
      healthStatus = "down";
    } else if ((credentialStat?.enabledCredentials ?? 0) === 0) {
      healthStatus = "no-key";
    } else if (endpoint.healthStatus === "healthy" || endpoint.healthStatus === "degraded") {
      healthStatus = endpoint.healthStatus;
    } else if (recentRequests === 0) {
      healthStatus = "idle";
    } else if ((usage?.recentServerErrors ?? 0) > 0 || recentErrorRate >= 0.2) {
      healthStatus = "degraded";
    } else {
      healthStatus = "healthy";
    }

    return {
      id: endpoint.id,
      supplierId: endpoint.supplierId,
      supplierSlug: endpoint.supplier.supplierId,
      supplierName: endpoint.supplier.name,
      endpointId: endpoint.endpointId,
      name: endpoint.name,
      baseUrl: endpoint.baseUrl,
      apiFormat: endpoint.apiFormat,
      authMode: endpoint.authMode,
      authType: runtime.authType,
      iconUrl: endpoint.iconUrl,
      enabled: endpoint.enabled,
      autoDisabled: endpoint.autoDisabled,
      concurrencyMode: endpoint.concurrencyMode,
      officialConcurrencyLimit: runtime.officialConcurrencyLimit,
      officialQueueTimeoutMs: runtime.officialQueueTimeoutMs,
      upstreamCount: assignmentCounts.get(endpoint.id) ?? 0,
      totalCredentials: credentialStat?.totalCredentials ?? 0,
      enabledCredentials: credentialStat?.enabledCredentials ?? 0,
      requests24h: usage?.requests24h ?? 0,
      clientErrors24h: usage?.clientErrors24h ?? 0,
      serverErrors24h: usage?.serverErrors24h ?? 0,
      totalTokens24h: usage?.totalTokens24h ?? 0,
      avgLatencyMs24h: usage?.avgLatencyMs24h ?? 0,
      errorRate24h,
      lastSeenAt: usage?.lastSeenAt ?? null,
      healthStatus,
      lastCheckedAt: endpoint.lastCheckedAt,
      lastError: endpoint.lastError,
      consecutiveFailures: endpoint.consecutiveFailures,
      updatedAt: endpoint.updatedAt,
      createdAt: endpoint.createdAt,
    };
  });

  return ok(c, {
    totals: {
      totalEndpoints: items.length,
      enabledEndpoints: items.filter((item) => item.enabled && !item.autoDisabled).length,
      activeEndpoints24h: items.filter((item) => item.requests24h > 0).length,
      degradedEndpoints30m: items.filter(
        (item) => item.healthStatus === "degraded" || item.healthStatus === "down",
      ).length,
    },
    endpoints: items,
  });
});

router.get("/endpoints", async (c) => {
  getAdminSession(c);
  const endpoints = await findEndpointsWithDefaults();
  const counts = await aiUpstreamAssignmentRepo.countByEndpointIds(
    endpoints.map((endpoint) => endpoint.id),
  );

  return ok(
    c,
    endpoints.map((endpoint) => ({
      ...formatEndpointWithSupplier(endpoint),
      upstreamCount: counts.get(endpoint.id) ?? 0,
    })),
  );
});

router.post("/endpoints", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiEndpointBody);
  if (!parsed.ok) return parsed.response;
  const {
    authConfig,
    authMode: requestedAuthMode,
    authType,
    concurrencyMode: requestedConcurrencyMode,
    iconUrl,
    officialConcurrencyLimit,
    officialQueueTimeoutMs,
    ...rest
  } = parsed.data;

  const supplier = await aiSupplierRepo.findById(rest.supplierId);
  if (!supplier || !supplier.enabled)
    return c.json({ error: "Supplier not found or disabled" }, 400);

  const existing = await aiEndpointRepo.findByEndpointId(rest.endpointId);
  if (existing) return c.json({ error: "Supplier connection ID already exists" }, 409);

  const authMode = inferAuthMode({
    authMode: requestedAuthMode,
    authType,
    authConfig,
  });
  const concurrencyMode = inferConcurrencyMode({
    concurrencyMode: requestedConcurrencyMode,
    officialConcurrencyLimit,
    officialQueueTimeoutMs,
  });

  const created = await aiEndpointRepo.create({
    ...rest,
    authMode,
    authType: authMode === "inherit" ? supplier.authType : (authType ?? supplier.authType),
    authConfig:
      authMode === "inherit"
        ? supplier.authConfig
        : authConfig === undefined
          ? supplier.authConfig
          : JSON.stringify(authConfig),
    concurrencyMode,
    officialConcurrencyLimit:
      concurrencyMode === "inherit" || officialConcurrencyLimit === undefined
        ? supplier.officialConcurrencyLimit
        : officialConcurrencyLimit,
    officialQueueTimeoutMs:
      concurrencyMode === "inherit"
        ? supplier.officialQueueTimeoutMs
        : (officialQueueTimeoutMs ?? supplier.officialQueueTimeoutMs),
    iconUrl: iconUrl || null,
    enabled: rest.enabled ?? true,
  });

  log.auth.info(
    { endpointId: created.endpointId, supplierId: supplier.supplierId },
    "AI endpoint created",
  );
  const createdWithSupplier = await aiEndpointRepo.findWithSupplierById(created.id);
  return ok(c, formatEndpointWithSupplier(createdWithSupplier ?? created), 201);
});

router.put("/endpoints/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiEndpointRepo.findById(id);
  if (!existing) return c.json({ error: "Supplier connection not found" }, 404);

  const parsed = await parseBody(c, updateAiEndpointBody);
  if (!parsed.ok) return parsed.response;
  const {
    authConfig,
    authMode: requestedAuthMode,
    authType,
    concurrencyMode: requestedConcurrencyMode,
    iconUrl,
    officialConcurrencyLimit,
    officialQueueTimeoutMs,
    supplierId,
    ...rest
  } = parsed.data;

  const targetSupplierId = supplierId ?? existing.supplierId;
  const supplier = await aiSupplierRepo.findById(targetSupplierId);
  if (!supplier) return c.json({ error: "Supplier not found" }, 400);

  if (supplierId !== undefined && !supplier.enabled)
    return c.json({ error: "Supplier not found or disabled" }, 400);

  const updates: Record<string, unknown> = { ...rest };
  if (supplierId !== undefined) updates.supplierId = supplierId;
  const authMode = inferAuthMode({
    authMode: requestedAuthMode,
    authType,
    authConfig,
  });
  const nextAuthMode =
    requestedAuthMode === undefined && authType === undefined && authConfig === undefined
      ? existing.authMode
      : authMode;

  if (
    requestedAuthMode !== undefined ||
    authType !== undefined ||
    authConfig !== undefined ||
    supplierId !== undefined
  ) {
    updates.authMode = nextAuthMode;
    if (nextAuthMode === "inherit") {
      updates.authType = supplier.authType;
      updates.authConfig = supplier.authConfig;
    } else {
      if (authType !== undefined) updates.authType = authType;
      if (authConfig !== undefined) updates.authConfig = JSON.stringify(authConfig);
    }
  }

  const concurrencyMode = inferConcurrencyMode({
    concurrencyMode: requestedConcurrencyMode,
    officialConcurrencyLimit,
    officialQueueTimeoutMs,
  });
  const nextConcurrencyMode =
    requestedConcurrencyMode === undefined &&
    officialConcurrencyLimit === undefined &&
    officialQueueTimeoutMs === undefined
      ? existing.concurrencyMode
      : concurrencyMode;

  if (
    requestedConcurrencyMode !== undefined ||
    officialConcurrencyLimit !== undefined ||
    officialQueueTimeoutMs !== undefined ||
    supplierId !== undefined
  ) {
    updates.concurrencyMode = nextConcurrencyMode;
    if (nextConcurrencyMode === "inherit") {
      updates.officialConcurrencyLimit = supplier.officialConcurrencyLimit;
      updates.officialQueueTimeoutMs = supplier.officialQueueTimeoutMs;
    } else {
      if (officialConcurrencyLimit !== undefined) {
        updates.officialConcurrencyLimit = officialConcurrencyLimit;
      }
      if (officialQueueTimeoutMs !== undefined) {
        updates.officialQueueTimeoutMs = officialQueueTimeoutMs;
      }
    }
  }

  if (iconUrl !== undefined) updates.iconUrl = iconUrl || null;
  if (parsed.data.enabled !== undefined) {
    updates.autoDisabled = false;
    updates.consecutiveFailures = 0;
    updates.healthStatus = "unknown";
    updates.lastError = null;
  }

  const updated = await aiEndpointRepo.update(id, updates);

  if (
    parsed.data.enabled !== undefined ||
    parsed.data.baseUrl !== undefined ||
    parsed.data.upstreamRoutingStrategy !== undefined ||
    parsed.data.loadBalanceStrategy !== undefined ||
    parsed.data.authMode !== undefined ||
    parsed.data.authType !== undefined ||
    parsed.data.authConfig !== undefined ||
    parsed.data.concurrencyMode !== undefined ||
    parsed.data.officialConcurrencyLimit !== undefined ||
    parsed.data.officialQueueTimeoutMs !== undefined ||
    parsed.data.supplierId !== undefined
  ) {
    emitEndpointInvalidated(id);
  }

  const updatedWithSupplier = await aiEndpointRepo.findWithSupplierById(updated!.id);
  return ok(c, formatEndpointWithSupplier(updatedWithSupplier ?? updated!));
});

router.delete("/endpoints/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiEndpointRepo.findById(id);
  if (!existing) return c.json({ error: "Supplier connection not found" }, 404);

  await aiEndpointRepo.delete(id);
  emitEndpointInvalidated(id);
  log.auth.info({ endpointId: existing.endpointId }, "AI endpoint deleted");
  return ok(c, { success: true });
});

router.get("/endpoints/:id/credentials", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const endpoint = await aiEndpointRepo.findById(id);
  if (!endpoint) return c.json({ error: "Supplier connection not found" }, 404);

  const credentials = await aiEndpointCredentialRepo.findByEndpointId(id);
  return ok(c, await formatEndpointCredentials(credentials));
});

// ── Endpoint ↔ Upstream Assignments ─────────────────────────────────

router.get("/endpoints/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const endpoint = await aiEndpointRepo.findById(id);
  if (!endpoint) return c.json({ error: "Supplier connection not found" }, 404);

  const assignments = await aiUpstreamAssignmentRepo.findByEndpointId(id);
  return ok(
    c,
    assignments.map((assignment) => ({
      id: assignment.id,
      endpointId: assignment.endpointId,
      upstream: formatUpstream(assignment.upstream),
      priority: assignment.priority,
      weight: assignment.weight,
      enabled: assignment.enabled,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    })),
  );
});

router.post("/endpoints/:id/upstreams", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const endpoint = await aiEndpointRepo.findById(id);
  if (!endpoint) return c.json({ error: "Supplier connection not found" }, 404);

  const parsed = await parseBody(c, createAiUpstreamAssignmentBody);
  if (!parsed.ok) return parsed.response;

  const upstream = await aiUpstreamRepo.findById(parsed.data.upstreamId);
  if (!upstream) return c.json({ error: "Upstream not found" }, 404);

  const existing = await aiUpstreamAssignmentRepo.findByEndpointAndUpstreamId(
    id,
    parsed.data.upstreamId,
  );
  if (existing)
    return c.json({ error: "Upstream already assigned to this supplier connection" }, 409);

  const created = await aiUpstreamAssignmentRepo.create({
    endpointId: id,
    upstreamId: parsed.data.upstreamId,
    priority: parsed.data.priority ?? 100,
    weight: parsed.data.weight ?? 1,
    enabled: parsed.data.enabled ?? true,
  });

  emitEndpointInvalidated(id);

  log.auth.info(
    { endpointId: endpoint.endpointId, upstreamId: upstream.upstreamId },
    "Upstream assigned to endpoint",
  );
  return ok(c, created, 201);
});

router.put("/endpoints/:endpointId/upstreams/:assignmentId", async (c) => {
  getAdminSession(c);
  const endpointId = Number(c.req.param("endpointId"));
  const assignmentId = Number(c.req.param("assignmentId"));
  if (Number.isNaN(endpointId) || Number.isNaN(assignmentId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const endpoint = await aiEndpointRepo.findById(endpointId);
  if (!endpoint) return c.json({ error: "Supplier connection not found" }, 404);

  const existing = await aiUpstreamAssignmentRepo.findById(assignmentId);
  if (!existing || existing.endpointId !== endpointId) {
    return c.json({ error: "Assignment not found" }, 404);
  }

  const parsed = await parseBody(c, updateAiUpstreamAssignmentBody);
  if (!parsed.ok) return parsed.response;

  const updated = await aiUpstreamAssignmentRepo.update(assignmentId, parsed.data);
  emitEndpointInvalidated(endpointId);

  return ok(c, updated);
});

router.delete("/endpoints/:endpointId/upstreams/:assignmentId", async (c) => {
  getAdminSession(c);
  const endpointId = Number(c.req.param("endpointId"));
  const assignmentId = Number(c.req.param("assignmentId"));
  if (Number.isNaN(endpointId) || Number.isNaN(assignmentId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const existing = await aiUpstreamAssignmentRepo.findById(assignmentId);
  if (!existing || existing.endpointId !== endpointId) {
    return c.json({ error: "Assignment not found" }, 404);
  }

  await aiUpstreamAssignmentRepo.delete(assignmentId);
  emitEndpointInvalidated(endpointId, existing.upstreamId);
  return ok(c, { success: true });
});

export default router;
