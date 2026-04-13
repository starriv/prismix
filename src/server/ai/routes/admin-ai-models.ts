/**
 * AI model CRUD + discovery + price-sync routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";
import { match } from "ts-pattern";

import {
  batchCreateAiModelsBody,
  createAiModelBody,
  updateAiModelBody,
} from "@/server/lib/body-schemas";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import { aiKeyRepo, aiModelRepo, aiProviderRepo } from "@/server/repos";

import { isCatalogReady, lookupPricing, refreshLiteLLMPricing } from "../lib/litellm-pricing";
import { buildProviderAuth } from "../lib/provider-auth";
import { resolveUpstreamCandidates } from "../lib/upstream-routing";
import { formatModel } from "./admin-ai-helpers";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const router = new Hono();

// ── Models CRUD ─────────────────────────────────────────────────────────

router.get("/providers/:id/models", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const models = await aiModelRepo.findByProviderId(id);
  return ok(c, models.map(formatModel));
});

router.get("/providers/:id/discover-models", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  let key: Awaited<ReturnType<typeof aiKeyRepo.findAnyEnabledByUpstream>> | undefined;
  let baseUrl: string | null = null;

  for (const upstream of await resolveUpstreamCandidates(provider)) {
    const candidateKey = await aiKeyRepo.findAnyEnabledByUpstream(id, upstream.id);
    if (!candidateKey) continue;
    key = candidateKey;
    baseUrl = upstream.baseUrl;
    break;
  }

  if (!key || !baseUrl) {
    return c.json({ error: "No API key configured — add an API key for this provider first" }, 400);
  }

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch {
    return c.json({ error: "Failed to decrypt key" }, 500);
  }

  const base = baseUrl.replace(/\/+$/, "");
  // Gemini and Anthropic have their own model list endpoints; OpenAI-compatible use /v1/models
  const modelsUrl = match(provider.apiFormat)
    .with("bedrock", () => {
      // ListFoundationModels is on the control plane (bedrock.region), not runtime (bedrock-runtime.region)
      const controlPlaneBase = base.replace("bedrock-runtime.", "bedrock.");
      return `${controlPlaneBase}/foundation-models`;
    })
    .with("gemini", () => `${base}/models`)
    .with("anthropic", () => `${base}/models`)
    .otherwise(() => (base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`));
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(provider, plainKey, modelsUrl);

  try {
    const res = await fetch(finalUrl, {
      headers: { "Content-Type": "application/json", ...authHeaders },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return c.json(
        { error: `Upstream returned ${res.status}`, detail: body.slice(0, 1000) },
        res.status as 400,
      );
    }

    const upstream = (await res.json()) as Record<string, unknown>;

    // Parse model list — different providers return different shapes
    const rawModels = match(provider.apiFormat)
      .with("bedrock", () => {
        // Bedrock ListFoundationModels: { modelSummaries: [{modelId, modelName, providerName}] }
        const arr = upstream.modelSummaries as Array<Record<string, unknown>> | undefined;
        return (arr ?? []).map((m) => ({
          modelId: m.modelId as string,
          name: (m.modelName as string) ?? (m.modelId as string),
          ownedBy: m.providerName as string | undefined,
        }));
      })
      .with("gemini", () => {
        // Gemini: { models: [{ name: "models/gemini-pro", displayName: "..." }] }
        const arr = upstream.models as Array<Record<string, unknown>> | undefined;
        return (arr ?? []).map((m) => ({
          modelId: ((m.name as string) ?? "").replace(/^models\//, ""),
          name: (m.displayName as string) ?? ((m.name as string) ?? "").replace(/^models\//, ""),
          ownedBy: "google" as string | undefined,
        }));
      })
      .with("anthropic", () => {
        // Anthropic: { data: [{ id: "claude-3...", display_name: "..." }] }
        const arr = upstream.data as Array<Record<string, unknown>> | undefined;
        return (arr ?? []).map((m) => ({
          modelId: m.id as string,
          name: (m.display_name as string) ?? (m.id as string),
          ownedBy: "anthropic" as string | undefined,
        }));
      })
      .otherwise(() => {
        // OpenAI-compatible: { data: [{ id: "gpt-4o", name?: "..." }] }
        const arr = upstream.data as Array<Record<string, unknown>> | undefined;
        return (arr ?? []).map((m) => ({
          modelId: m.id as string,
          name: (m.name as string) ?? (m.id as string),
          ownedBy: m.owned_by as string | undefined,
        }));
      });

    const models = rawModels;

    const existing = await aiModelRepo.findByProviderId(id);
    const existingIds = new Set(existing.map((e) => e.modelId));

    return ok(
      c,
      models.map((m) => {
        const pricing = lookupPricing(m.modelId, provider.providerId);
        return {
          ...m,
          registered: existingIds.has(m.modelId),
          inputPrice: pricing?.inputPricePerMTok ?? null,
          outputPrice: pricing?.outputPricePerMTok ?? null,
          contextWindow: pricing?.contextWindow ?? null,
          capabilities: pricing?.capabilities ?? null,
        };
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to fetch models: ${message}` }, 502);
  }
});

router.post("/providers/:id/models", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("id"));
  if (Number.isNaN(providerId)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const parsed = await parseBody(c, createAiModelBody);
  if (!parsed.ok) return parsed.response;
  const { capabilities, fallbackModelIds, ...rest } = parsed.data;

  const existing = await aiModelRepo.findByProviderAndModelId(providerId, rest.modelId);
  if (existing) return c.json({ error: "Model ID already exists for this provider" }, 409);

  const created = await aiModelRepo.create({
    ...rest,
    providerId,
    capabilities: JSON.stringify(capabilities ?? []),
    fallbackModelIds: fallbackModelIds ? JSON.stringify(fallbackModelIds) : null,
  });

  log.auth.info({ modelId: created.modelId }, "AI model created");
  return ok(c, formatModel(created), 201);
});

// POST /providers/:id/models/batch — batch create models (for discover-and-add)
router.post("/providers/:id/models/batch", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("id"));
  if (Number.isNaN(providerId)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const parsed = await parseBody(c, batchCreateAiModelsBody);
  if (!parsed.ok) return parsed.response;

  const rows = parsed.data.models.map((m) => ({
    providerId,
    modelId: m.modelId,
    name: m.name,
    contextWindow: m.contextWindow ?? null,
    inputPrice: m.inputPrice ?? "0",
    outputPrice: m.outputPrice ?? "0",
    capabilities: JSON.stringify(m.capabilities ?? []),
    fallbackModelIds: null,
    enabled: m.enabled ?? true,
  }));

  const created = await aiModelRepo.batchCreate(rows);
  log.auth.info(
    { providerId, requested: rows.length, created: created.length },
    "AI models batch created",
  );
  return ok(c, { created: created.length, models: created.map(formatModel) }, 201);
});

// POST /providers/:id/models/sync-prices/preview — preview price diff from LiteLLM
router.post("/providers/:id/models/sync-prices/preview", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("id"));
  if (Number.isNaN(providerId)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  if (!isCatalogReady()) await refreshLiteLLMPricing();
  if (!isCatalogReady()) return c.json({ error: "LiteLLM pricing catalog unavailable" }, 503);

  const models = await aiModelRepo.findByProviderId(providerId);
  const diffs = [];

  for (const m of models) {
    const pricing = lookupPricing(m.modelId, provider.providerId);
    if (!pricing) continue;

    const changed =
      m.inputPrice !== pricing.inputPricePerMTok || m.outputPrice !== pricing.outputPricePerMTok;

    if (changed) {
      diffs.push({
        id: m.id,
        modelId: m.modelId,
        name: m.name,
        oldInputPrice: m.inputPrice,
        oldOutputPrice: m.outputPrice,
        newInputPrice: pricing.inputPricePerMTok,
        newOutputPrice: pricing.outputPricePerMTok,
        contextWindow: pricing.contextWindow,
      });
    }
  }

  return ok(c, diffs.slice(0, 200));
});

// POST /providers/:id/models/sync-prices/apply — apply selected price updates
router.post("/providers/:id/models/sync-prices/apply", async (c) => {
  getAdminSession(c);
  const providerId = Number(c.req.param("id"));
  if (Number.isNaN(providerId)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const raw: unknown = await c.req.json();
  const modelIds =
    typeof raw === "object" &&
    raw !== null &&
    "modelIds" in raw &&
    Array.isArray((raw as Record<string, unknown>).modelIds)
      ? ((raw as Record<string, unknown>).modelIds as unknown[]).filter(
          (v): v is number => typeof v === "number",
        )
      : [];
  if (modelIds.length === 0) {
    return c.json({ error: "modelIds required (array of numbers)" }, 400);
  }

  if (!isCatalogReady()) await refreshLiteLLMPricing();
  if (!isCatalogReady()) return c.json({ error: "LiteLLM pricing catalog unavailable" }, 503);

  const models = await aiModelRepo.findByProviderId(providerId);
  const selected = new Set(modelIds);
  const updates: Array<{
    id: number;
    inputPrice: string;
    outputPrice: string;
    contextWindow?: number | null;
  }> = [];

  for (const m of models) {
    if (!selected.has(m.id)) continue;
    const pricing = lookupPricing(m.modelId, provider.providerId);
    if (!pricing) continue;

    updates.push({
      id: m.id,
      inputPrice: pricing.inputPricePerMTok,
      outputPrice: pricing.outputPricePerMTok,
      contextWindow: pricing.contextWindow,
    });
  }

  if (updates.length > 0) {
    await aiModelRepo.batchUpdatePrices(updates);
    log.auth.info({ providerId, synced: updates.length }, "AI model prices synced from LiteLLM");
  }

  return ok(c, { synced: updates.length });
});

router.put("/models/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiModelRepo.findById(id);
  if (!existing) return c.json({ error: "Model not found" }, 404);

  // Verify provider exists
  const provider = await aiProviderRepo.findById(existing.providerId);
  if (!provider) return c.json({ error: "Model not found" }, 404);

  const parsed = await parseBody(c, updateAiModelBody);
  if (!parsed.ok) return parsed.response;
  const { capabilities, fallbackModelIds, ...rest } = parsed.data;

  const updates: Record<string, unknown> = { ...rest };
  if (capabilities !== undefined) updates.capabilities = JSON.stringify(capabilities);
  if (fallbackModelIds !== undefined)
    updates.fallbackModelIds = fallbackModelIds ? JSON.stringify(fallbackModelIds) : null;

  const updated = await aiModelRepo.update(id, updates);
  return ok(c, formatModel(updated!));
});

// POST /models/batch-delete — batch delete models by IDs
router.post("/models/batch-delete", async (c) => {
  getAdminSession(c);
  const body = await c.req.json<{ ids?: number[] }>();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids must be a non-empty array of numbers" }, 400);
  }
  if (ids.some((id) => typeof id !== "number" || !Number.isInteger(id))) {
    return c.json({ error: "All ids must be integers" }, 400);
  }

  const deleted = await aiModelRepo.batchDelete(ids);
  log.auth.info({ ids, deleted }, "AI models batch deleted");
  return ok(c, { deleted });
});

router.delete("/models/:id", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const existing = await aiModelRepo.findById(id);
  if (!existing) return c.json({ error: "Model not found" }, 404);

  const provider = await aiProviderRepo.findById(existing.providerId);
  if (!provider) return c.json({ error: "Model not found" }, 404);

  await aiModelRepo.delete(id);
  return ok(c, { success: true });
});

export default router;
