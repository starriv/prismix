/**
 * Admin Key Provider management routes.
 *
 * Mounted at /api/admin/key-providers — requires adminAuthMiddleware.
 */
import { Hono } from "hono";
import { uniq } from "lodash-es";

import { invalidateCredentialPool } from "@/server/ai";
import { emit } from "@/server/events";
import { DOMAIN_EVENT_TYPES } from "@/server/events/registry";
import {
  adjustKeyProviderBalanceBody,
  createKeyProviderBody,
  updateKeyProviderBody,
} from "@/server/lib/body-schemas";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import {
  parseBody,
  parseIntParam,
  parsePaginationLimit,
  parsePaginationOffset,
} from "@/server/lib/validate";
import {
  aiCredentialRepo,
  aiEndpointCredentialRepo,
  aiEndpointRepo,
  aiUpstreamRepo,
  aiUsageLogRepo,
  keyProviderRepo,
  keyProviderTransactionRepo,
} from "@/server/repos";
import { removeTailingZero, safeMinus } from "@/shared/number";

const keyProvidersRouter = new Hono();

async function buildProviderSummary(id: number) {
  const provider = await keyProviderRepo.findById(id);
  if (!provider) return null;

  const [ownerStats, usageTotals, revenueShare] = await Promise.all([
    aiCredentialRepo.ownerStats(id),
    aiUsageLogRepo.totalsByOwnerId(id),
    keyProviderTransactionRepo.totalRevenueShareByProviderId(id),
  ]);

  return {
    ...provider,
    credentialCount: ownerStats.totalCredentials,
    latestCallAt: ownerStats.latestCallAt,
    totals: {
      requests: usageTotals.requests,
      inputTokens: usageTotals.inputTokens,
      outputTokens: usageTotals.outputTokens,
      totalTokens: usageTotals.totalTokens,
      consumerSpend: removeTailingZero(usageTotals.estimatedCost, 6),
      upstreamCost: removeTailingZero(usageTotals.upstreamCost, 6),
      revenueShare: removeTailingZero(revenueShare, 6),
    },
  };
}

async function buildProviderKeySummaries(
  id: number,
  opts?: {
    limit?: number;
    offset?: number;
  },
) {
  const ownedCredentials = await aiCredentialRepo.findByOwnerId(id, opts);
  const credentialIds = ownedCredentials.map((credential) => credential.id);
  const endpointCredentials = await aiEndpointCredentialRepo.findByOwnerId(id);
  const endpointIds = uniq(endpointCredentials.map((credential) => credential.endpointId));
  const upstreamIds = uniq(
    endpointCredentials.flatMap((credential) =>
      credential.upstreamId ? [credential.upstreamId] : [],
    ),
  );

  const [usageByCredential, revenueShareByCredential, endpoints, upstreams] = await Promise.all([
    aiUsageLogRepo.summaryByOwnerAndCredentialIds(id, credentialIds),
    keyProviderTransactionRepo.summarizeRevenueShareByProviderAndCredentialIds(id, credentialIds),
    aiEndpointRepo.findByIds(endpointIds),
    aiUpstreamRepo.findByIds(upstreamIds),
  ]);

  const usageMap = new Map(usageByCredential.map((row) => [row.credentialId, row]));
  const endpointNameMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.name]));
  const upstreamNameMap = new Map(upstreams.map((upstream) => [upstream.id, upstream.name]));
  const assignmentsByCredentialId = new Map(
    ownedCredentials.map((credential) => [
      credential.id,
      endpointCredentials.filter((assignment) => assignment.credentialId === credential.id),
    ]),
  );

  return ownedCredentials.map((credential) => {
    const usage = usageMap.get(credential.id);
    const estimatedCost = usage?.estimatedCost ?? "0";
    const upstreamCost = usage?.upstreamCost ?? "0";
    const revenueShare = revenueShareByCredential.get(credential.id) ?? "0";
    const assignments = assignmentsByCredentialId.get(credential.id) ?? [];

    return {
      credentialId: credential.id,
      credentialName: credential.name,
      keyPrefix: credential.keyPrefix,
      enabled: credential.enabled,
      lastUsedAt: credential.lastUsedAt,
      assignments: assignments.map((assignment) => ({
        endpointCredentialId: assignment.id,
        endpointId: assignment.endpointId,
        endpointName: endpointNameMap.get(assignment.endpointId) ?? null,
        upstreamId: assignment.upstreamId ?? null,
        upstreamName: assignment.upstreamId
          ? (upstreamNameMap.get(assignment.upstreamId) ?? null)
          : null,
        enabled: assignment.enabled,
        weight: assignment.weight,
      })),
      requests: usage?.requests ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      consumerSpend: removeTailingZero(estimatedCost, 6),
      upstreamCost: removeTailingZero(upstreamCost, 6),
      revenueShare: removeTailingZero(revenueShare, 6),
    };
  });
}

// ── List all key providers ──────────────────────────────────────────

keyProvidersRouter.get("/", async (c) => {
  const providers = await keyProviderRepo.findAll();

  // Enrich with credential count per provider
  const allCredentials = await aiCredentialRepo.findAll();
  const credentialCountByOwner = new Map<number, number>();
  for (const credential of allCredentials) {
    if (credential.ownerId) {
      credentialCountByOwner.set(
        credential.ownerId,
        (credentialCountByOwner.get(credential.ownerId) ?? 0) + 1,
      );
    }
  }

  const enriched = providers.map((p) => ({
    ...p,
    credentialCount: credentialCountByOwner.get(p.id) ?? 0,
  }));

  return ok(c, enriched);
});

// ── Transaction list (must be before /:id) ──────────────────────────

keyProvidersRouter.get("/txns", async (c) => {
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const providerId = parseIntParam(c.req.query("providerId"));

  if (!providerId) return c.json({ error: "providerId is required" }, 400);

  const rows = await keyProviderTransactionRepo.findByProviderId(providerId, limit, offset);
  return ok(c, rows);
});

// ── Get single key provider ─────────────────────────────────────────

keyProvidersRouter.get("/:id/summary", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const summary = await buildProviderSummary(id);
  if (!summary) return c.json({ error: "Key provider not found" }, 404);

  return ok(c, summary);
});

keyProvidersRouter.get("/:id/credentials", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));

  const provider = await keyProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Key provider not found" }, 404);

  return ok(c, await buildProviderKeySummaries(id, { limit, offset }));
});

keyProvidersRouter.get("/:id/recent", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));

  const provider = await keyProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Key provider not found" }, 404);

  return ok(c, await aiUsageLogRepo.findAll(limit, offset, { ownerId: id }));
});

// ── Create key provider ─────────────────────────────────────────────

keyProvidersRouter.post("/", async (c) => {
  const parsed = await parseBody(c, createKeyProviderBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const provider = await keyProviderRepo.create({
    name: body.name.trim(),
    email: body.email || null,
    contactInfo: body.contactInfo ?? null,
    address: body.address || null,
    revenueSharePercent: body.revenueSharePercent ?? 70,
    status: body.status ?? "active",
  });

  log.admin.info({ providerId: provider.id, name: provider.name }, "Key provider created");
  return ok(c, provider, 201);
});

// ── Update key provider ─────────────────────────────────────────────

keyProvidersRouter.put("/:id", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, updateKeyProviderBody);
  if (!parsed.ok) return parsed.response;

  const existing = await keyProviderRepo.findById(id);
  if (!existing) return c.json({ error: "Key provider not found" }, 404);

  const updated = await keyProviderRepo.update(id, parsed.data);

  // Cascade status change to owned credentials
  const newStatus = parsed.data.status;
  if (newStatus && newStatus !== existing.status) {
    const enabled = newStatus === "active";
    const affectedCredentials = await aiCredentialRepo.setEnabledByOwnerId(id, enabled);
    const affectedAssignments = await aiEndpointCredentialRepo.findByOwnerId(id);

    const endpointIds = uniq(affectedAssignments.map((assignment) => assignment.endpointId));
    for (const endpointId of endpointIds) {
      invalidateCredentialPool(endpointId);
      emit(DOMAIN_EVENT_TYPES.AI_CREDENTIAL_POOL_INVALIDATED, null, { endpointId });
    }

    log.admin.info(
      { providerId: id, newStatus, credentialsAffected: affectedCredentials.length },
      "Key provider status changed — cascaded to owned credentials",
    );
  }

  log.admin.info({ providerId: id }, "Key provider updated");
  return ok(c, updated);
});

// ── Delete key provider ─────────────────────────────────────────────

keyProvidersRouter.delete("/:id", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const existing = await keyProviderRepo.findById(id);
  if (!existing) return c.json({ error: "Key provider not found" }, 404);

  // Delete all owned credentials, then delete the provider
  const affectedAssignments = await aiEndpointCredentialRepo.findByOwnerId(id);
  const deletedCredentials = await aiCredentialRepo.deleteByOwnerId(id);
  const endpointIds = uniq(affectedAssignments.map((assignment) => assignment.endpointId));

  await keyProviderRepo.delete(id);

  for (const endpointId of endpointIds) {
    invalidateCredentialPool(endpointId);
    emit(DOMAIN_EVENT_TYPES.AI_CREDENTIAL_POOL_INVALIDATED, null, { endpointId });
  }

  log.admin.info(
    { providerId: id, name: existing.name, credentialsDeleted: deletedCredentials.length },
    "Key provider deleted — owned credentials removed",
  );
  return ok(c, { success: true });
});

// ── Manual balance adjustment ───────────────────────────────────────

keyProvidersRouter.post("/:id/adjust", async (c) => {
  const id = parseIntParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);

  const parsed = await parseBody(c, adjustKeyProviderBalanceBody);
  if (!parsed.ok) return parsed.response;
  const { amount, type, description } = parsed.data;

  const provider = await keyProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Key provider not found" }, 404);

  const balanceBefore = provider.balance;

  if (type === "credit") {
    const updated = await keyProviderRepo.creditBalance(id, amount);
    await keyProviderTransactionRepo.insert({
      providerId: id,
      type: "adjustment",
      amount,
      balanceBefore,
      balanceAfter: updated.balance,
      description: description ?? "Admin manual credit",
    });
    log.admin.info({ providerId: id, amount, type: "credit" }, "Key provider balance adjusted");
    return ok(c, updated);
  }

  // debit
  const updated = await keyProviderRepo.debitBalance(id, amount);
  if (!updated) return c.json({ error: "Insufficient balance" }, 400);

  await keyProviderTransactionRepo.insert({
    providerId: id,
    type: "adjustment",
    amount,
    balanceBefore,
    balanceAfter: safeMinus(balanceBefore, amount),
    description: description ?? "Admin manual debit",
  });
  log.admin.info({ providerId: id, amount, type: "debit" }, "Key provider balance adjusted");
  return ok(c, updated);
});

export default keyProvidersRouter;
