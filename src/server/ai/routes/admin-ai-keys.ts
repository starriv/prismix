/**
 * AI key CRUD + connectivity test routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";
import { compact, uniq } from "lodash-es";

import { emit } from "@/server/events";
import { createAiKeyBody, updateAiKeyBody } from "@/server/lib/body-schemas";
import { decrypt, encrypt, hashApiKey } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { aiKeyRepo, aiProviderRepo, keyProviderRepo } from "@/server/repos";

import { invalidateKeyPool } from "../lib/key-balancer";
import { buildProviderAuth } from "../lib/provider-auth";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const router = new Hono();

// ── Keys CRUD ───────────────────────────────────────────────────────────

router.get("/keys", async (c) => {
  getAdminSession(c);
  const keys = await aiKeyRepo.findAll();

  const providerIds = uniq(keys.map((k) => k.providerId));
  const providerMap = new Map<number, string>();
  for (const pid of providerIds) {
    const p = await aiProviderRepo.findById(pid);
    if (p) providerMap.set(pid, p.name);
  }

  // Enrich with key provider (owner) name
  const ownerIds = compact(uniq(keys.map((k) => k.ownerId))) as number[];
  const ownerMap = new Map<number, string>();
  for (const oid of ownerIds) {
    const kp = await keyProviderRepo.findById(oid);
    if (kp) ownerMap.set(oid, kp.name);
  }

  return ok(
    c,
    keys.map(({ encryptedKey, keyHash, ...rest }) => ({
      ...rest,
      providerName: providerMap.get(rest.providerId) ?? "Unknown",
      ownerName: rest.ownerId ? (ownerMap.get(rest.ownerId) ?? null) : null,
    })),
  );
});

router.post("/keys", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createAiKeyBody);
  if (!parsed.ok) return parsed.response;
  const { providerId, name, apiKey, ownerId } = parsed.data;

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider || !provider.enabled) {
    return c.json({ error: "Provider not found or disabled" }, 400);
  }

  const keyHash = hashApiKey(apiKey);
  const encryptedKey = encrypt(apiKey, AI_KEY_DOMAIN_TAG);
  const keyPrefix = apiKey.length > 8 ? `${apiKey.slice(0, 8)}...` : apiKey;

  const created = await aiKeyRepo.create({
    providerId,
    name,
    encryptedKey,
    keyHash,
    keyPrefix,
    ownerId: ownerId ?? null,
  });

  log.auth.info({ providerId: provider.providerId, keyId: created.id }, "AI key created");

  invalidateKeyPool(providerId);
  emit("ai.key-pool-invalidated", null, { providerId });

  const { encryptedKey: _, keyHash: _h, ...safe } = created;
  return ok(c, { ...safe, providerName: provider.name }, 201);
});

router.put("/keys/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiKeyRepo.findById(id);
  if (!existing) return c.json({ error: "Key not found" }, 404);

  const parsed = await parseBody(c, updateAiKeyBody);
  if (!parsed.ok) return parsed.response;

  const updated = await aiKeyRepo.update(id, parsed.data);
  if (!updated) return c.json({ error: "Update failed" }, 500);

  invalidateKeyPool(existing.providerId);
  emit("ai.key-pool-invalidated", null, { providerId: existing.providerId });

  const { encryptedKey: _, keyHash: _h, ...safe } = updated;
  return ok(c, safe);
});

router.delete("/keys/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiKeyRepo.findById(id);
  if (!existing) return c.json({ error: "Key not found" }, 404);

  await aiKeyRepo.delete(id);
  invalidateKeyPool(existing.providerId);
  emit("ai.key-pool-invalidated", null, { providerId: existing.providerId });
  return ok(c, { success: true });
});

// ── Test key connectivity ───────────────────────────────────────────────

router.post("/keys/:id/test", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const key = await aiKeyRepo.findById(id);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const provider = await aiProviderRepo.findById(key.providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch {
    return c.json({ success: false, error: "Failed to decrypt key" });
  }

  const start = Date.now();
  try {
    const { headers, url } = buildProviderAuth(provider, plainKey, `${provider.baseUrl}/models`);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      await aiKeyRepo.updateLastUsed(id);
      return ok(c, { success: true, latencyMs, status: res.status });
    }

    const body = await res.text().catch(() => "");
    return ok(c, { success: false, latencyMs, status: res.status, error: body.slice(0, 500) });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return ok(c, { success: false, latencyMs, error: message });
  }
});

export default router;
