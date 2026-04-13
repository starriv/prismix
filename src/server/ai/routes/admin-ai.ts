/**
 * AI management routes — catalog, usage, settings + sub-router mounting.
 *
 * All AI providers, models, and keys are system-level.
 * Mounted at /api/admin/ai (adminAuthMiddleware applied via parent).
 */
import { Hono } from "hono";

import { ok } from "@/server/lib/response";
import { parseIntParam, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  aiKeyRepo,
  aiModelRepo,
  aiProviderRepo,
  aiUsageLogRepo,
  settingsRepo,
} from "@/server/repos";

import { safeParseJsonArray } from "../lib/safe-json";
import { globalMarkupCache } from "../middleware/consumer-key-auth";
import adminAiKeys from "./admin-ai-keys";
import adminAiModels from "./admin-ai-models";
import adminAiProviders from "./admin-ai-providers";

const adminAi = new Hono();

// ── Mount sub-routers ──────────────────────────────────────────────────

adminAi.route("/", adminAiProviders);
adminAi.route("/", adminAiModels);
adminAi.route("/", adminAiKeys);

// ── Catalog ─────────────────────────────────────────────────────────────

adminAi.get("/catalog", async (c) => {
  getAdminSession(c);
  const providers = await aiProviderRepo.findAllEnabled();
  const keys = await aiKeyRepo.findAll();
  const enabledKeyProviderIds = new Set(keys.filter((k) => k.enabled).map((k) => k.providerId));

  const catalog = [];
  for (const provider of providers) {
    const models = await aiModelRepo.findEnabledByProviderId(provider.id);
    for (const model of models) {
      catalog.push({
        modelId: model.modelId,
        name: model.name,
        provider: provider.providerId,
        providerName: provider.name,
        capabilities: safeParseJsonArray(model.capabilities, "capabilities"),
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        contextWindow: model.contextWindow,
        hasKey: enabledKeyProviderIds.has(provider.id),
      });
    }
  }

  return ok(c, catalog);
});

// ── Usage ─────────────────────────────────────────────────────────────

adminAi.get("/usage/summary", async (c) => {
  getAdminSession(c);
  const from = c.req.query("from") ? new Date(c.req.query("from")!) : undefined;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : undefined;
  const consumerKeyId = parseIntParam(c.req.query("consumerKeyId")) ?? undefined;
  return ok(c, await aiUsageLogRepo.summary(from, to, consumerKeyId));
});

adminAi.get("/usage/recent", async (c) => {
  getAdminSession(c);
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const from = c.req.query("from") ? new Date(c.req.query("from")!) : undefined;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : undefined;
  const consumerKeyId = parseIntParam(c.req.query("consumerKeyId")) ?? undefined;
  const modelId = c.req.query("modelId") || undefined;
  const providerId = c.req.query("providerId") || undefined;
  const statusCode = parseIntParam(c.req.query("statusCode")) ?? undefined;
  const rawStatusClass = c.req.query("statusClass");
  const statusClass =
    rawStatusClass === "4xx" || rawStatusClass === "5xx" ? rawStatusClass : undefined;
  return ok(
    c,
    await aiUsageLogRepo.findAll(limit, offset, {
      from,
      to,
      consumerKeyId,
      modelId,
      providerId,
      statusCode,
      statusClass,
    }),
  );
});

adminAi.get("/usage/daily", async (c) => {
  getAdminSession(c);
  const days = Math.min(Number(c.req.query("days")) || 30, 90);
  const consumerKeyId = parseIntParam(c.req.query("consumerKeyId")) ?? undefined;
  return ok(c, await aiUsageLogRepo.dailySummary(days, consumerKeyId));
});

adminAi.get("/usage/error-overview", async (c) => {
  getAdminSession(c);
  const days = Math.min(Number(c.req.query("days")) || 30, 90);
  return ok(c, await aiUsageLogRepo.errorOverview(days));
});

adminAi.get("/usage/error-daily", async (c) => {
  getAdminSession(c);
  const days = Math.min(Number(c.req.query("days")) || 30, 90);
  return ok(c, await aiUsageLogRepo.errorDaily(days));
});

adminAi.get("/usage/by-key", async (c) => {
  getAdminSession(c);
  const from = c.req.query("from") ? new Date(c.req.query("from")!) : undefined;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : undefined;
  return ok(c, await aiUsageLogRepo.summaryByConsumerKey(from, to));
});

// ── Request log detail (Redis-backed, opt-in) ──────────────────────

adminAi.get("/usage/request/:requestId", async (c) => {
  getAdminSession(c);
  const { requestId } = c.req.param();

  const { getRequestLog } = await import("../log-store");
  const entry = await getRequestLog(requestId);

  if (!entry) {
    return c.json({ error: "Request log not found or expired" }, 404);
  }

  return ok(c, entry);
});

// ── Request logging toggle ──────────────────────────────────────────

adminAi.get("/settings/request-logging", async (c) => {
  getAdminSession(c);
  const value = await settingsRepo.getGlobal("ai_request_logging");
  return ok(c, { enabled: value === "enabled" });
});

adminAi.put("/settings/request-logging", async (c) => {
  getAdminSession(c);
  const raw: unknown = await c.req.json();
  const enabled =
    typeof raw === "object" && raw !== null && "enabled" in raw && raw.enabled === true;
  await settingsRepo.setGlobal("ai_request_logging", enabled ? "enabled" : "disabled");
  return ok(c, { enabled });
});

// ── Default markup ─────────────────────────────────────────────────

adminAi.get("/settings/default-markup", async (c) => {
  getAdminSession(c);
  const raw = await settingsRepo.getGlobal("ai_default_markup");
  return ok(c, { defaultMarkupPercent: raw !== undefined ? Number(raw) : 0 });
});

adminAi.put("/settings/default-markup", async (c) => {
  getAdminSession(c);
  const raw: unknown = await c.req.json();
  const rawPercent =
    typeof raw === "object" && raw !== null && "defaultMarkupPercent" in raw
      ? (raw as Record<string, unknown>).defaultMarkupPercent
      : 0;
  const value = Math.max(0, Math.min(1000, Number(rawPercent) || 0));
  await settingsRepo.setGlobal("ai_default_markup", String(value));
  // Reset in-memory cache so the middleware picks up the new value immediately
  globalMarkupCache.expiresAt = 0;
  return ok(c, { defaultMarkupPercent: value });
});

export default adminAi;
