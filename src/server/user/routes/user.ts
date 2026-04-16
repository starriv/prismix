/**
 * User portal routes — profile, consumer keys, usage, logs, and model catalog.
 */
import { Hono } from "hono";
import { groupBy, pick, uniq } from "lodash-es";

import { safeParseJsonArray } from "@/server/ai/lib/safe-json";
import { getGlobalDefaultMarkup } from "@/server/ai/middleware/consumer-key-auth";
import type { NewRelayConsumerKey, RelayConsumerKey } from "@/server/db";
import { emit } from "@/server/events";
import { createConsumerKeyBody, updateProfileBody } from "@/server/lib/body-schemas";
import { decrypt, encrypt, generateConsumerApiKey } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { ensureUserAgent } from "@/server/lib/wallet";
import { getUserSession } from "@/server/middleware/auth";
import {
  aiModelRepo,
  aiUsageLogRepo,
  announcementRepo,
  payAgentRepo,
  relayConsumerKeyRepo,
  settingsRepo,
  userRepo,
} from "@/server/repos";
import { removeTailingZero, safeMultipliedBy } from "@/shared/number";

import walletRoutes from "./wallet";

const user = new Hono();

function serializeUserKey(key: RelayConsumerKey) {
  return {
    id: key.id,
    name: key.name,
    description: key.description,
    apiKeyPrefix: key.apiKeyPrefix,
    status: key.status,
    markupPercent: key.markupPercent,
    rateLimitRpm: key.rateLimitRpm,
    allowedModels: key.allowedModels,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
  };
}

// ── Wallet (sub-router) ─────────────────────────────────────────
user.route("/wallet", walletRoutes);

// ── Profile ──────────────────────────────────────────────────────

// GET /profile — current user info
user.get("/profile", async (c) => {
  const session = getUserSession(c);
  const u = await userRepo.findById(session.userId);
  if (!u) return c.json({ error: "User not found" }, 404);
  return ok(c, pick(u, ["id", "uuid", "name", "email", "avatar", "status"]));
});

// PUT /profile — update name/avatar
user.put("/profile", async (c) => {
  const session = getUserSession(c);
  const parsed = await parseBody(c, updateProfileBody);
  if (!parsed.ok) return parsed.response;
  const updated = await userRepo.update(session.userId, parsed.data);
  if (!updated) return c.json({ error: "User not found" }, 404);
  return ok(c, pick(updated, ["id", "uuid", "name", "email", "avatar", "status"]));
});

// ── Model Catalog ───────────────────────────────────────────────

// GET /models — available models with effective consumer pricing
user.get("/models", async (c) => {
  const session = getUserSession(c);

  // 1. Get user's active consumer keys → extract ACL + markup
  const keys = await relayConsumerKeyRepo.findByUserId(session.userId);
  const activeKeys = keys.filter((k) => k.status === "active");

  // 2. Resolve effective markup: key → agent → global (same cascade as consumer-key-auth)
  let effectiveMarkup = await getGlobalDefaultMarkup();
  if (activeKeys.length > 0) {
    const agentIds = uniq(activeKeys.map((k) => k.agentId));
    const agents = await Promise.all(agentIds.map((id) => payAgentRepo.findById(id)));
    const agentMap = new Map(agents.filter(Boolean).map((a) => [a!.id, a!]));

    const markups = activeKeys.map((k) => {
      const agent = agentMap.get(k.agentId);
      return k.markupPercent ?? agent?.defaultMarkupPercent ?? effectiveMarkup;
    });
    effectiveMarkup = Math.min(...markups);
  }

  // 3. Build unified ACL (union of all keys' allowedModels; empty ACL on any key → all models)
  let hasOpenAccess = activeKeys.length === 0; // no keys → show full catalog
  const allPatterns: string[] = [];
  for (const k of activeKeys) {
    const models: string[] = safeParseJsonArray(k.allowedModels, "allowedModels");
    if (models.length === 0) {
      hasOpenAccess = true;
      break;
    }
    allPatterns.push(...models);
  }
  const uniquePatterns = uniq(allPatterns);

  // 4. Fetch all enabled models
  const rows = await aiModelRepo.findAllEnabled();

  // 5. Filter by unified ACL
  const filtered = hasOpenAccess
    ? rows
    : rows.filter((r) =>
        uniquePatterns.some((pattern) =>
          pattern.endsWith("*")
            ? r.model.modelId.startsWith(pattern.slice(0, -1))
            : r.model.modelId === pattern,
        ),
      );

  // 6. Compute consumer prices + group by provider
  const markupMultiplier = 1 + effectiveMarkup / 100;
  const grouped = groupBy(filtered, (r) => r.provider.id);

  const providers = Object.entries(grouped).map(([, items]) => {
    const { provider } = items[0];
    return {
      id: provider.id,
      name: provider.name,
      iconUrl: provider.iconUrl,
      apiFormat: provider.apiFormat,
      models: items.map(({ model }) => ({
        modelId: model.modelId,
        name: model.name,
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        consumerInputPrice: removeTailingZero(
          safeMultipliedBy(model.inputPrice, markupMultiplier),
          6,
        ),
        consumerOutputPrice: removeTailingZero(
          safeMultipliedBy(model.outputPrice, markupMultiplier),
          6,
        ),
        capabilities: safeParseJsonArray(model.capabilities, "capabilities") as string[],
        contextWindow: model.contextWindow,
      })),
    };
  });

  return ok(c, { providers, markupPercent: effectiveMarkup });
});

// ── Consumer Keys ────────────────────────────────────────────────

// GET /keys — list user's consumer keys
user.get("/keys", async (c) => {
  const session = getUserSession(c);
  const keys = await relayConsumerKeyRepo.findByUserId(session.userId);
  return ok(c, keys.map(serializeUserKey));
});

// POST /keys — create a new consumer key (self-service)
user.post("/keys", async (c) => {
  const session = getUserSession(c);

  // Check if self-create is enabled
  const selfCreate = await settingsRepo.getGlobal("user_self_create_key");
  if (selfCreate !== "true") {
    return c.json(
      { error: "Self-service key creation is disabled. Contact the administrator." },
      403,
    );
  }

  // Check max keys limit
  const maxKeysStr = await settingsRepo.getGlobal("user_max_keys");
  const maxKeys = Number(maxKeysStr ?? "10");
  const existing = await relayConsumerKeyRepo.findByUserId(session.userId);
  if (existing.length >= maxKeys) {
    return c.json({ error: `Maximum ${maxKeys} keys per user` }, 400);
  }

  const parsed = await parseBody(c, createConsumerKeyBody);
  if (!parsed.ok) return parsed.response;

  const { name, description, markupPercent, rateLimitRpm, allowedModels } = parsed.data;

  // Get or create the user's single pay agent (wallet)
  const agentId = await ensureUserAgent(session.userId);

  const CONSUMER_KEY_TAG = "relay-consumer-key";
  const consumerApiKey = generateConsumerApiKey();
  const encryptedConsumerKey = encrypt(consumerApiKey.raw, CONSUMER_KEY_TAG);

  const consumerKey = await relayConsumerKeyRepo.create({
    userId: session.userId,
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

  log.gateway.info(
    { keyId: consumerKey.id, agentId, userId: session.userId },
    "User created consumer key",
  );

  return ok(
    c,
    { id: consumerKey.id, name, apiKeyPrefix: consumerApiKey.prefix, apiKey: consumerApiKey.raw },
    201,
  );
});

// GET /keys/:id — single key detail
user.get("/keys/:id", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);

  return ok(c, serializeUserKey(key));
});

// POST /keys/:id/disable — disable a user-owned key immediately
user.post("/keys/:id/disable", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);
  if (key.status !== "active") return c.json({ error: "Key is not active" }, 409);

  const updated = await relayConsumerKeyRepo.update(id, session.userId, { status: "suspended" });
  if (!updated) return c.json({ error: "Key not found" }, 404);

  log.gateway.info({ keyId: id, userId: session.userId }, "User disabled consumer key");
  return ok(c, serializeUserKey(updated));
});

// POST /keys/:id/enable — re-enable a suspended user-owned key
user.post("/keys/:id/enable", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);
  if (key.status !== "suspended") return c.json({ error: "Key is not suspended" }, 409);

  const updated = await relayConsumerKeyRepo.update(id, session.userId, { status: "active" });
  if (!updated) return c.json({ error: "Key not found" }, 404);

  log.gateway.info({ keyId: id, userId: session.userId }, "User enabled consumer key");
  return ok(c, serializeUserKey(updated));
});

// POST /keys/:id/reveal — reveal full API key (for copy)
user.post("/keys/:id/reveal", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);
  if (!key.encryptedKey) return c.json({ error: "Key cannot be revealed" }, 400);

  const CONSUMER_KEY_TAG = "relay-consumer-key";
  let apiKey: string;
  try {
    apiKey = decrypt(key.encryptedKey, CONSUMER_KEY_TAG);
  } catch {
    return c.json({ error: "Failed to decrypt key" }, 500);
  }

  return ok(c, { apiKey });
});

// DELETE /keys/:id — blacklist then delete a user-owned key
user.delete("/keys/:id", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);

  await relayConsumerKeyRepo.blacklistAndDelete(key);
  emit("consumer-key.deleted", null, { keyId: id, agentId: key.agentId });
  log.gateway.info({ keyId: id, userId: session.userId }, "User deleted consumer key");

  return ok(c, { success: true });
});

// GET /keys/:id/usage — per-key usage summary
user.get("/keys/:id/usage", async (c) => {
  const session = getUserSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid key ID" }, 400);

  const key = await relayConsumerKeyRepo.findByIdAndUser(id, session.userId);
  if (!key) return c.json({ error: "Key not found" }, 404);

  const [summary, daily] = await Promise.all([
    aiUsageLogRepo.summary(undefined, undefined, id),
    aiUsageLogRepo.dailySummary(30, id),
  ]);

  return ok(c, { summary, daily });
});

// ── Usage ────────────────────────────────────────────────────────

// GET /usage/summary — aggregate across all user's keys (full breakdown)
user.get("/usage/summary", async (c) => {
  const session = getUserSession(c);
  const summary = await aiUsageLogRepo.summary(undefined, undefined, undefined, session.userId);
  return ok(c, summary);
});

// GET /usage/daily — daily trend for user (admin-compatible format)
user.get("/usage/daily", async (c) => {
  const session = getUserSession(c);
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  const daily = await aiUsageLogRepo.dailySummary(days, undefined, session.userId);
  return ok(c, daily);
});

user.get("/usage/error-overview", async (c) => {
  const session = getUserSession(c);
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  return ok(c, await aiUsageLogRepo.errorOverview(days, session.userId));
});

user.get("/usage/error-daily", async (c) => {
  const session = getUserSession(c);
  const days = Math.min(Number(c.req.query("days") ?? 30), 90);
  return ok(c, await aiUsageLogRepo.errorDaily(days, session.userId));
});

// ── Logs ─────────────────────────────────────────────────────────

// GET /logs — AI request logs (paginated, filterable)
user.get("/logs", async (c) => {
  const session = getUserSession(c);
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const modelId = c.req.query("modelId") || undefined;
  const rawStatusClass = c.req.query("statusClass");
  const statusClass: "4xx" | "5xx" | undefined =
    rawStatusClass === "4xx" || rawStatusClass === "5xx" ? rawStatusClass : undefined;

  const filters = { userId: session.userId, modelId, statusClass };
  const [items, total] = await Promise.all([
    aiUsageLogRepo.findAll(limit, offset, filters),
    aiUsageLogRepo.count(filters),
  ]);
  return ok(c, { items, total });
});

// GET /logs/request/:requestId — request/response body detail (user-scoped)
user.get("/logs/request/:requestId", async (c) => {
  const session = getUserSession(c);
  const { requestId } = c.req.param();

  // Verify the request belongs to this user
  const logEntry = await aiUsageLogRepo.findAll(1, 0, {
    userId: session.userId,
    requestId,
  });
  if (logEntry.length === 0) {
    return c.json({ error: "Request log not found" }, 404);
  }

  const { getRequestLog } = await import("@/server/ai/log-store");
  const entry = await getRequestLog(requestId);
  if (!entry) {
    return c.json({ error: "Request log not found or expired" }, 404);
  }

  return ok(c, entry);
});

// ── Announcements ───────────────────────────────────────────────

// GET /announcements — recent sent announcements (global broadcast)
user.get("/announcements", async (c) => {
  const rows = await announcementRepo.findRecentSent(10);
  return ok(c, rows);
});

// ── Error handler ────────────────────────────────────────────────

user.onError((err, c) => {
  log.auth.error({ err }, "User route error");
  return c.json({ error: "Internal server error" }, 500);
});

export default user;
