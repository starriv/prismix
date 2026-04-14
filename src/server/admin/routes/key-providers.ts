/**
 * Admin Key Provider management routes.
 *
 * Mounted at /api/admin/key-providers — requires adminAuthMiddleware.
 */
import { Hono } from "hono";
import { uniq } from "lodash-es";

import { invalidateKeyPool } from "@/server/ai";
import { emit } from "@/server/events";
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
  aiKeyRepo,
  aiProviderRepo,
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
    aiKeyRepo.ownerStats(id),
    aiUsageLogRepo.totalsByOwnerId(id),
    keyProviderTransactionRepo.totalRevenueShareByProviderId(id),
  ]);

  return {
    ...provider,
    keyCount: ownerStats.totalKeys,
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
  const ownedKeys = await aiKeyRepo.findByOwnerId(id, opts);
  const keyIds = ownedKeys.map((k) => k.id);
  const providerIds = uniq(ownedKeys.map((k) => k.providerId));
  const upstreamIds = uniq(ownedKeys.flatMap((key) => (key.upstreamId ? [key.upstreamId] : [])));

  const [usageByKey, revenueShareByKey, aiProviders, upstreams] = await Promise.all([
    aiUsageLogRepo.summaryByOwnerAndAiKeyIds(id, keyIds),
    keyProviderTransactionRepo.summarizeRevenueShareByProviderAndKeyIds(id, keyIds),
    aiProviderRepo.findByIds(providerIds),
    aiUpstreamRepo.findByIds(upstreamIds),
  ]);

  const usageMap = new Map(usageByKey.map((row) => [row.keyId, row]));
  const providerNameMap = new Map(aiProviders.map((provider) => [provider.id, provider.name]));
  const upstreamNameMap = new Map(upstreams.map((upstream) => [upstream.id, upstream.name]));

  return ownedKeys.map((key) => {
    const usage = usageMap.get(key.id);
    const estimatedCost = usage?.estimatedCost ?? "0";
    const upstreamCost = usage?.upstreamCost ?? "0";
    const revenueShare = revenueShareByKey.get(key.id) ?? "0";

    return {
      keyId: key.id,
      keyName: key.name,
      keyPrefix: key.keyPrefix,
      providerId: key.providerId,
      providerName: providerNameMap.get(key.providerId) ?? null,
      upstreamId: key.upstreamId ?? null,
      upstreamName: key.upstreamId ? (upstreamNameMap.get(key.upstreamId) ?? null) : null,
      enabled: key.enabled,
      weight: key.weight,
      lastUsedAt: key.lastUsedAt,
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

  // Enrich with key count per provider
  const allKeys = await aiKeyRepo.findAll();
  const keyCountByOwner = new Map<number, number>();
  for (const key of allKeys) {
    if (key.ownerId) {
      keyCountByOwner.set(key.ownerId, (keyCountByOwner.get(key.ownerId) ?? 0) + 1);
    }
  }

  const enriched = providers.map((p) => ({
    ...p,
    keyCount: keyCountByOwner.get(p.id) ?? 0,
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

keyProvidersRouter.get("/:id/keys", async (c) => {
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

  // Cascade status change to owned keys
  const newStatus = parsed.data.status;
  if (newStatus && newStatus !== existing.status) {
    const enabled = newStatus === "active";
    const affectedKeys = await aiKeyRepo.setEnabledByOwnerId(id, enabled);

    // Invalidate key pools for all affected providers
    const providerIds = uniq(affectedKeys.map((k) => k.providerId));
    for (const pid of providerIds) {
      invalidateKeyPool(pid);
      emit("ai.key-pool-invalidated", null, { providerId: pid });
    }

    log.admin.info(
      { providerId: id, newStatus, keysAffected: affectedKeys.length },
      "Key provider status changed — cascaded to owned keys",
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

  // Delete all owned keys, then delete the provider
  const deletedKeys = await aiKeyRepo.deleteByOwnerId(id);
  const providerIds = uniq(deletedKeys.map((k) => k.providerId));

  await keyProviderRepo.delete(id);

  for (const pid of providerIds) {
    invalidateKeyPool(pid);
    emit("ai.key-pool-invalidated", null, { providerId: pid });
  }

  log.admin.info(
    { providerId: id, name: existing.name, keysDeleted: deletedKeys.length },
    "Key provider deleted — owned keys removed",
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
