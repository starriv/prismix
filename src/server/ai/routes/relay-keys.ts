/**
 * Relay Consumer Key management routes — admin-facing CRUD.
 *
 * Mounted at /api/admin/relay-keys (adminAuthMiddleware applied via parent).
 */
import { Hono } from "hono";

import { db, payAgents, relayConsumerKeys, transaction } from "@/server/db";
import type { NewPayAgent, NewRelayConsumerKey, PayAgent, RelayConsumerKey } from "@/server/db";
import { emit } from "@/server/events";
import { createConsumerKeyBody, updateConsumerKeyBody } from "@/server/lib/body-schemas";
import { decrypt, encrypt, generateConsumerApiKey } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { ensureAgentWallet, ensureUserAgent } from "@/server/lib/wallet";
import { getAdminSession } from "@/server/middleware/auth";
import {
  payAgentRepo,
  payAgentTransactionRepo,
  relayConsumerKeyRepo,
  userRepo,
} from "@/server/repos";
import { gt } from "@/shared/number";

const CONSUMER_KEY_TAG = "relay-consumer-key";

const relayKeys = new Hono();

// ── List ──────────────────────────────────────────────────────────────

relayKeys.get("/", async (c) => {
  getAdminSession(c);
  const prefix = c.req.query("prefix")?.trim() || undefined;
  const userUuid = c.req.query("userUuid")?.trim() || undefined;
  const page = Math.max(0, Number(c.req.query("page") ?? 0));
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset")) || page * limit;
  const filters = { prefix, userUuid };

  const [keys, total] = await Promise.all([
    relayConsumerKeyRepo.findFiltered(limit, offset, filters),
    relayConsumerKeyRepo.countFiltered(filters),
  ]);
  return ok(c, {
    items: keys.map(({ apiKeyHash: _h, encryptedKey: _e, ...rest }) => ({
      ...rest,
      allowedModels: JSON.parse(rest.allowedModels),
    })),
    total,
  });
});

// ── Options (lightweight lookup for all keys — no secrets, no pagination) ──

relayKeys.get("/options", async (c) => {
  getAdminSession(c);
  const options = await relayConsumerKeyRepo.findAllOptions();
  return ok(c, options);
});

// ── Detail ────────────────────────────────────────────────────────────

relayKeys.get("/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const key = await relayConsumerKeyRepo.findById(id);
  if (!key) return c.json({ error: "Consumer key not found" }, 404);

  const { apiKeyHash: _h, encryptedKey: _e, ...safe } = key;
  return ok(c, { ...safe, allowedModels: JSON.parse(safe.allowedModels) });
});

// ── Create ────────────────────────────────────────────────────────────

relayKeys.post("/", async (c) => {
  getAdminSession(c);
  const parsed = await parseBody(c, createConsumerKeyBody);
  if (!parsed.ok) return parsed.response;

  const { name, description, userId, markupPercent, rateLimitRpm, allowedModels, initialBalance } =
    parsed.data;

  const consumerApiKey = generateConsumerApiKey();
  const encryptedConsumerKey = encrypt(consumerApiKey.raw, CONSUMER_KEY_TAG);

  let agentId: number;

  if (userId) {
    // User-linked key — use the user's shared wallet (agent)
    const user = await userRepo.findById(userId);
    if (!user) return c.json({ error: "User not found" }, 404);
    agentId = await ensureUserAgent(userId);
  } else {
    // Admin orphan key — create a standalone agent (original behavior)
    const agentName = `[AI] ${name}`;

    const { agent, consumerKey } = await transaction(async (tx) => {
      const [agent] = await (tx as typeof import("@/server/db").db)
        .insert(payAgents)
        .values({
          name: agentName,
          description: null,
          address: null,
          privateKey: null,
          type: "ledger",
          balance: "0",
          status: "active",
        } satisfies NewPayAgent)
        .returning();

      const [consumerKey] = await (tx as typeof import("@/server/db").db)
        .insert(relayConsumerKeys)
        .values({
          userId: null,
          agentId: agent.id,
          name,
          description: description ?? null,
          apiKeyHash: consumerApiKey.hash,
          apiKeyPrefix: consumerApiKey.prefix,
          encryptedKey: encryptedConsumerKey,
          markupPercent: markupPercent ?? null,
          rateLimitRpm: rateLimitRpm ?? null,
          allowedModels: JSON.stringify(allowedModels ?? []),
        } satisfies NewRelayConsumerKey)
        .returning();

      return { agent: agent as PayAgent, consumerKey: consumerKey as RelayConsumerKey };
    });

    // Generate deposit wallet for the standalone agent (non-blocking)
    ensureAgentWallet(agent.id).catch((err) =>
      log.gateway.warn(
        { err, agentId: agent.id },
        "Failed to generate agent wallet on key creation",
      ),
    );

    // Credit initial balance if provided
    if (initialBalance && gt(initialBalance, "0")) {
      const credited = await payAgentRepo.creditBalance(agent.id, initialBalance);
      await payAgentTransactionRepo.insert({
        agentId: agent.id,
        type: "top_up",
        amount: initialBalance,
        balanceBefore: "0",
        balanceAfter: credited.balance,
        description: "Initial balance on key creation",
        source: "platform",
      });
    }

    emit("agent.created", null, { agentId: agent.id, name: agent.name });
    log.gateway.info(
      { keyId: consumerKey.id, agentId: agent.id, initialBalance },
      "Consumer key created with standalone agent",
    );

    const { apiKeyHash: _h, encryptedKey: _e, ...safe } = consumerKey;
    return ok(c, { ...safe, apiKey: consumerApiKey.raw, allowedModels: allowedModels ?? [] }, 201);
  }

  // User-linked path — only create the consumer key (agent already exists)
  const consumerKey = await relayConsumerKeyRepo.create({
    userId,
    agentId,
    name,
    description: description ?? null,
    apiKeyHash: consumerApiKey.hash,
    apiKeyPrefix: consumerApiKey.prefix,
    encryptedKey: encryptedConsumerKey,
    markupPercent: markupPercent ?? null,
    rateLimitRpm: rateLimitRpm ?? null,
    allowedModels: JSON.stringify(allowedModels ?? []),
  } satisfies NewRelayConsumerKey);

  // Credit initial balance to user's wallet if provided
  if (initialBalance && gt(initialBalance, "0")) {
    const credited = await payAgentRepo.creditBalance(agentId, initialBalance);
    await payAgentTransactionRepo.insert({
      agentId,
      type: "top_up",
      amount: initialBalance,
      balanceBefore: "0",
      balanceAfter: credited.balance,
      description: "Initial balance on key creation (admin)",
      source: "platform",
    });
  }

  log.gateway.info(
    { keyId: consumerKey.id, agentId, userId, initialBalance },
    "Consumer key created for user agent",
  );

  const { apiKeyHash: _h, encryptedKey: _e, ...safe } = consumerKey;
  return ok(c, { ...safe, apiKey: consumerApiKey.raw, allowedModels: allowedModels ?? [] }, 201);
});

// ── Update ────────────────────────────────────────────────────────────

relayKeys.put("/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await relayConsumerKeyRepo.findById(id);
  if (!existing) return c.json({ error: "Consumer key not found" }, 404);

  const parsed = await parseBody(c, updateConsumerKeyBody);
  if (!parsed.ok) return parsed.response;

  const { allowedModels, agentId, ...rest } = parsed.data;
  const updates: Record<string, unknown> = { ...rest };
  if (allowedModels !== undefined) {
    updates.allowedModels = allowedModels ? JSON.stringify(allowedModels) : "[]";
  }
  if (agentId !== undefined) {
    const agent = await payAgentRepo.findById(agentId);
    if (!agent) return c.json({ error: "Pay-agent not found" }, 404);
    if (agent.status !== "active")
      return c.json({ error: "Cannot reassign to a suspended pay-agent" }, 400);
    updates.agentId = agentId;
  }

  // Admin update uses the key's userId (may be null for admin-created keys)
  const updated = await relayConsumerKeyRepo.update(id, existing.userId ?? 0, updates);
  const { apiKeyHash: _h, encryptedKey: _e, ...safe } = updated!;
  return ok(c, { ...safe, allowedModels: JSON.parse(safe.allowedModels) });
});

// ── Reveal Key ───────────────────────────────────────────────────────

relayKeys.post("/:id/reveal", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const key = await relayConsumerKeyRepo.findById(id);
  if (!key) return c.json({ error: "Consumer key not found" }, 404);

  if (!key.encryptedKey) return c.json({ error: "Key cannot be revealed" }, 400);

  let apiKey: string;
  try {
    apiKey = decrypt(key.encryptedKey, CONSUMER_KEY_TAG);
  } catch {
    return c.json({ error: "Failed to decrypt key" }, 500);
  }

  return ok(c, { apiKey });
});

// ── Delete ────────────────────────────────────────────────────────────

relayKeys.delete("/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await relayConsumerKeyRepo.findById(id);
  if (!existing) return c.json({ error: "Consumer key not found" }, 404);

  await relayConsumerKeyRepo.blacklistAndDelete(existing);
  emit("consumer-key.deleted", null, { keyId: id, agentId: existing.agentId });
  log.gateway.info({ keyId: id }, "Consumer key deleted");

  return ok(c, { success: true });
});

// ── Rotate Key ────────────────────────────────────────────────────────

relayKeys.post("/:id/rotate", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await relayConsumerKeyRepo.findById(id);
  if (!existing) return c.json({ error: "Consumer key not found" }, 404);

  const { raw, hash, prefix } = generateConsumerApiKey();
  const encryptedKey = encrypt(raw, CONSUMER_KEY_TAG);
  await relayConsumerKeyRepo.update(id, existing.userId ?? 0, {
    apiKeyHash: hash,
    apiKeyPrefix: prefix,
    encryptedKey,
  });

  log.gateway.info({ keyId: id }, "Consumer key rotated");
  return ok(c, { apiKey: raw, apiKeyPrefix: prefix });
});

export default relayKeys;
