/**
 * AI model CRUD + discovery + price-sync routes.
 * Mounted under /api/admin/ai (auth applied by parent).
 */
import { Hono } from "hono";
import { match } from "ts-pattern";

import {
  batchCreateAiModelsBody,
  createAiModelBody,
  createAiModelRouteBody,
  updateAiModelBody,
  updateAiModelRouteBody,
} from "@/server/lib/body-schemas";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getAdminSession } from "@/server/middleware/auth";
import {
  aiKeyRepo,
  aiModelGrayUserRepo,
  aiModelRepo,
  aiModelRouteRepo,
  aiProviderRepo,
} from "@/server/repos";
import { lte } from "@/shared/number";

import {
  canAttachProviderToClientFormat,
  type ClientFormat,
  defaultClientFormatForProvider,
  isClientFormat,
} from "../lib/client-format";
import { isCatalogReady, lookupPricing, refreshLiteLLMPricing } from "../lib/litellm-pricing";
import { buildProviderAuth } from "../lib/provider-auth";
import { buildModelsUrl } from "../lib/supplier-health";
import { resolveUpstreamCandidates } from "../lib/upstream-routing";
import { formatModel } from "./admin-ai-helpers";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const router = new Hono();

async function formatModelWithGrayUsers(model: Parameters<typeof formatModel>[0]) {
  const grayUsers = await aiModelGrayUserRepo.findUsersByModelId(Number(model.id));
  return {
    ...formatModel(model),
    grayUsers,
    grayUserIds: grayUsers.map((user) => user.id),
  };
}

function validateLimitedFreeConfig(
  inputPrice: string,
  outputPrice: string,
  limitedFreeUntil: Date | null | undefined,
  options: { requireFuture?: boolean } = {},
): string | null {
  if (!limitedFreeUntil) return null;
  if (limitedFreeUntil.getTime() <= Date.now()) {
    return options.requireFuture ? "Limited-free expiry must be in the future" : null;
  }
  if (!lte(inputPrice, "0") || !lte(outputPrice, "0")) {
    return "Limited-free models must have zero input and output prices";
  }
  return null;
}

// ── Models CRUD ─────────────────────────────────────────────────────────

router.get("/providers/:id/models", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  const models = await aiModelRepo.findByProviderId(id);
  const grayUsersByModelId = await aiModelGrayUserRepo.findUsersByModelIds(models.map((m) => m.id));
  return ok(
    c,
    models.map((model) => {
      const grayUsers = grayUsersByModelId.get(model.id) ?? [];
      return { ...formatModel(model), grayUsers, grayUserIds: grayUsers.map((u) => u.id) };
    }),
  );
});

router.get("/providers/:id/discover-models", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const source = (c.req.query("source") ?? "official") as "official" | "upstream";
  if (source !== "official" && source !== "upstream") {
    return c.json({ error: "Invalid source — must be 'official' or 'upstream'" }, 400);
  }
  const requestedClientFormat = c.req.query("clientFormat");
  if (requestedClientFormat && !isClientFormat(requestedClientFormat)) {
    return c.json({ error: "Invalid clientFormat" }, 400);
  }

  const provider = await aiProviderRepo.findById(id);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  let key: Awaited<ReturnType<typeof aiKeyRepo.findAnyEnabledByUpstream>> | undefined;
  let baseUrl: string | null = null;
  let modelsEndpointOverride: string | null = null;

  if (source === "official") {
    if (!provider.baseUrl) {
      return c.json({ error: "Provider has no base URL configured" }, 400);
    }
    baseUrl = provider.baseUrl;
    key = await aiKeyRepo.findAnyEnabledByProvider(id);
  } else {
    for (const upstream of await resolveUpstreamCandidates(provider)) {
      const candidateKey = await aiKeyRepo.findAnyEnabledByUpstream(id, upstream.id);
      if (!candidateKey) continue;
      key = candidateKey;
      baseUrl = upstream.baseUrl;
      modelsEndpointOverride = upstream.modelsEndpoint;
      break;
    }
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

  const modelsUrl = buildModelsUrl(provider, baseUrl, modelsEndpointOverride);
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

    const clientFormat =
      requestedClientFormat ?? defaultClientFormatForProvider(provider.apiFormat);
    const existing = await aiModelRepo.findByProviderId(id);
    const existingIds = new Set(
      existing.filter((e) => e.clientFormat === clientFormat).map((e) => e.modelId),
    );

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
  const {
    capabilities,
    fallbackModelIds,
    clientFormat: requestedClientFormat,
    grayUserIds,
    ...rest
  } = parsed.data;
  const clientFormat = requestedClientFormat ?? defaultClientFormatForProvider(provider.apiFormat);
  if (!canAttachProviderToClientFormat(clientFormat, provider.apiFormat)) {
    return c.json(
      { error: `Provider "${provider.name}" is not compatible with ${clientFormat} models` },
      400,
    );
  }
  const limitedFreeError = validateLimitedFreeConfig(
    rest.inputPrice,
    rest.outputPrice,
    rest.limitedFreeUntil,
    { requireFuture: true },
  );
  if (limitedFreeError) return c.json({ error: limitedFreeError }, 400);

  const existing = await aiModelRepo.findByModelId(rest.modelId, clientFormat);
  if (existing) {
    // Model exists — just ensure a route to this provider exists
    const route = await aiModelRouteRepo.findByModelAndProvider(existing.id, providerId);
    if (route) return c.json({ error: "Model already has a route to this provider" }, 409);
    await aiModelRouteRepo.create({ modelId: existing.id, providerId });
    if (grayUserIds !== undefined) {
      try {
        await aiModelGrayUserRepo.replaceForModel(existing.id, grayUserIds);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/23503|foreign key/.test(msg)) {
          return c.json(
            { error: "One or more grayUserIds reference users that do not exist" },
            400,
          );
        }
        throw err;
      }
    }
    log.auth.info({ modelId: existing.modelId, providerId }, "AI model route added");
    return ok(c, await formatModelWithGrayUsers(existing), 201);
  }

  const created = await aiModelRepo.create({
    ...rest,
    providerId,
    clientFormat,
    capabilities: JSON.stringify(capabilities ?? []),
    fallbackModelIds: fallbackModelIds ? JSON.stringify(fallbackModelIds) : null,
  });

  // Auto-create route to this provider
  await aiModelRouteRepo.create({ modelId: created.id, providerId });
  if (grayUserIds !== undefined) {
    try {
      await aiModelGrayUserRepo.replaceForModel(created.id, grayUserIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/23503|foreign key/.test(msg)) {
        return c.json({ error: "One or more grayUserIds reference users that do not exist" }, 400);
      }
      throw err;
    }
  }

  log.auth.info({ modelId: created.modelId, providerId }, "AI model created with route");
  return ok(c, await formatModelWithGrayUsers(created), 201);
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
  const defaultClientFormat = defaultClientFormatForProvider(provider.apiFormat);

  const rows = parsed.data.models.map((m) => ({
    providerId,
    clientFormat: m.clientFormat ?? defaultClientFormat,
    modelId: m.modelId,
    name: m.name,
    contextWindow: m.contextWindow ?? null,
    inputPrice: m.inputPrice ?? "0",
    outputPrice: m.outputPrice ?? "0",
    capabilities: JSON.stringify(m.capabilities ?? []),
    fallbackModelIds: null,
    limitedFreeUntil: m.limitedFreeUntil ?? null,
    grayReleaseEnabled: m.grayReleaseEnabled ?? false,
    enabled: m.enabled ?? true,
  }));
  const incompatible = rows.find(
    (row) => !canAttachProviderToClientFormat(row.clientFormat, provider.apiFormat),
  );
  if (incompatible) {
    return c.json(
      {
        error: `Provider "${provider.name}" is not compatible with ${incompatible.clientFormat} models`,
      },
      400,
    );
  }
  const limitedFreeError = rows
    .map((row) => ({
      modelId: row.modelId,
      error: validateLimitedFreeConfig(row.inputPrice, row.outputPrice, row.limitedFreeUntil, {
        requireFuture: true,
      }),
    }))
    .find((result) => result.error);
  if (limitedFreeError) {
    return c.json({ error: `${limitedFreeError.modelId}: ${limitedFreeError.error}` }, 400);
  }

  const modelIdsByFormat = new Map<string, string[]>();
  for (const row of rows) {
    modelIdsByFormat.set(row.clientFormat, [
      ...(modelIdsByFormat.get(row.clientFormat) ?? []),
      row.modelId,
    ]);
  }

  const existing = (
    await Promise.all(
      [...modelIdsByFormat.entries()].map(([clientFormat, modelIds]) =>
        aiModelRepo.findByModelIds(modelIds, clientFormat as typeof defaultClientFormat),
      ),
    )
  ).flat();
  const modelKey = (clientFormat: string, modelId: string) => `${clientFormat}:${modelId}`;
  const existingByModelKey = new Map(
    existing.map((model) => [modelKey(model.clientFormat, model.modelId), model]),
  );
  const rowsToCreate = rows.filter(
    (row) => !existingByModelKey.has(modelKey(row.clientFormat, row.modelId)),
  );
  const created = await aiModelRepo.batchCreate(rowsToCreate);
  const targetModelsByModelKey = new Map(existingByModelKey);

  for (const model of created) {
    targetModelsByModelKey.set(modelKey(model.clientFormat, model.modelId), model);
  }

  const routeTargets = parsed.data.models.flatMap((m) => {
    const clientFormat = m.clientFormat ?? defaultClientFormat;
    const model = targetModelsByModelKey.get(modelKey(clientFormat, m.modelId));
    return model ? [model] : [];
  });
  const linked = await aiModelRouteRepo.batchCreate(
    routeTargets.map((model) => ({ modelId: model.id, providerId })),
  );

  // Wire gray users for newly created models
  const grayUserRequests = parsed.data.models.flatMap((m) => {
    if (!m.grayUserIds?.length) return [];
    const clientFormat = m.clientFormat ?? defaultClientFormat;
    const model = targetModelsByModelKey.get(modelKey(clientFormat, m.modelId));
    if (!model || !created.some((c) => c.id === model.id)) return [];
    return [{ modelId: model.id, userIds: m.grayUserIds! }];
  });
  if (grayUserRequests.length > 0) {
    await Promise.all(
      grayUserRequests.map(({ modelId, userIds }) =>
        aiModelGrayUserRepo.replaceForModel(modelId, userIds),
      ),
    );
  }

  const grayUsersByModelId = await aiModelGrayUserRepo.findUsersByModelIds(
    routeTargets.map((m) => m.id),
  );

  log.auth.info(
    { providerId, requested: rows.length, created: created.length, linked: linked.length },
    "AI models batch created with routes",
  );
  return ok(
    c,
    {
      created: created.length,
      linked: linked.length,
      models: routeTargets.map((model) => {
        const grayUsers = grayUsersByModelId.get(model.id) ?? [];
        return { ...formatModel(model), grayUsers, grayUserIds: grayUsers.map((u) => u.id) };
      }),
    },
    201,
  );
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

  const parsed = await parseBody(c, updateAiModelBody);
  if (!parsed.ok) return parsed.response;
  const { capabilities, fallbackModelIds, grayUserIds, ...rest } = parsed.data;
  const limitedFreeError = validateLimitedFreeConfig(
    rest.inputPrice ?? existing.inputPrice,
    rest.outputPrice ?? existing.outputPrice,
    rest.limitedFreeUntil === undefined ? existing.limitedFreeUntil : rest.limitedFreeUntil,
    { requireFuture: rest.limitedFreeUntil !== undefined && rest.limitedFreeUntil !== null },
  );
  if (limitedFreeError) return c.json({ error: limitedFreeError }, 400);

  if (rest.clientFormat && rest.clientFormat !== existing.clientFormat) {
    const duplicate = await aiModelRepo.findByModelId(existing.modelId, rest.clientFormat);
    if (duplicate && duplicate.id !== existing.id) {
      return c.json(
        { error: `Model "${existing.modelId}" already exists for ${rest.clientFormat}` },
        409,
      );
    }

    const routes = await aiModelRouteRepo.findByModelPk(existing.id);
    const incompatible = routes.find(
      ({ provider }) => !canAttachProviderToClientFormat(rest.clientFormat!, provider.apiFormat),
    );
    if (incompatible) {
      return c.json(
        {
          error: `Provider "${incompatible.provider.name}" is not compatible with ${rest.clientFormat} models`,
        },
        400,
      );
    }
  }

  const updates: Record<string, unknown> = { ...rest };
  if (capabilities !== undefined) updates.capabilities = JSON.stringify(capabilities);
  if (fallbackModelIds !== undefined)
    updates.fallbackModelIds = fallbackModelIds ? JSON.stringify(fallbackModelIds) : null;

  const updated = await aiModelRepo.update(id, updates);
  if (!updated) return c.json({ error: "Model not found" }, 404);
  if (grayUserIds !== undefined) {
    try {
      await aiModelGrayUserRepo.replaceForModel(id, grayUserIds);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/23503|foreign key/.test(msg)) {
        return c.json({ error: "One or more grayUserIds reference users that do not exist" }, 400);
      }
      throw err;
    }
  }
  return ok(c, await formatModelWithGrayUsers(updated));
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

  await aiModelRepo.delete(id);
  return ok(c, { success: true });
});

// ── Flat models list (with routes) ────────────────────────────────────

router.get("/models", async (c) => {
  getAdminSession(c);
  const allModels = await aiModelRepo.findAll();
  const grayUsersByModelId = await aiModelGrayUserRepo.findUsersByModelIds(
    allModels.map((m) => m.id),
  );

  const results = await Promise.all(
    allModels.map(async (model) => {
      const routes = await aiModelRouteRepo.findByModelPk(model.id);
      const grayUsers = grayUsersByModelId.get(model.id) ?? [];
      return {
        ...formatModel(model),
        grayUsers,
        grayUserIds: grayUsers.map((u) => u.id),
        routes: routes.map(({ route, provider }) => ({
          id: route.id,
          providerId: route.providerId,
          providerName: provider.name,
          providerIconUrl: provider.iconUrl,
          providerModelId: route.providerModelId,
          priority: route.priority,
          weight: route.weight,
          enabled: route.enabled,
        })),
      };
    }),
  );

  return ok(c, results);
});

// ── Model Routes CRUD ─────────────────────────────────────────────────

router.get("/models/:id/routes", async (c) => {
  getAdminSession(c);
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const model = await aiModelRepo.findById(id);
  if (!model) return c.json({ error: "Model not found" }, 404);

  const routes = await aiModelRouteRepo.findByModelPk(id);
  return ok(
    c,
    routes.map(({ route, provider }) => ({
      id: route.id,
      modelId: route.modelId,
      providerId: route.providerId,
      providerName: provider.name,
      providerIconUrl: provider.iconUrl,
      apiFormat: provider.apiFormat,
      providerModelId: route.providerModelId,
      priority: route.priority,
      weight: route.weight,
      enabled: route.enabled,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
    })),
  );
});

router.post("/models/:id/routes", async (c) => {
  getAdminSession(c);
  const modelPk = Number(c.req.param("id"));
  if (Number.isNaN(modelPk)) return c.json({ error: "Invalid id" }, 400);

  const model = await aiModelRepo.findById(modelPk);
  if (!model) return c.json({ error: "Model not found" }, 404);

  const parsed = await parseBody(c, createAiModelRouteBody);
  if (!parsed.ok) return parsed.response;

  const provider = await aiProviderRepo.findById(parsed.data.providerId);
  if (!provider) return c.json({ error: "Provider not found" }, 404);

  if (!canAttachProviderToClientFormat(model.clientFormat as ClientFormat, provider.apiFormat)) {
    return c.json(
      { error: `Provider "${provider.name}" is not compatible with ${model.clientFormat} models` },
      400,
    );
  }

  const existing = await aiModelRouteRepo.findByModelAndProvider(modelPk, provider.id);
  if (existing) return c.json({ error: "Route already exists for this provider" }, 409);

  const route = await aiModelRouteRepo.create({
    modelId: modelPk,
    ...parsed.data,
  });

  log.auth.info({ modelId: model.modelId, providerId: provider.id }, "AI model route created");
  return ok(c, route, 201);
});

router.put("/models/:id/routes/:routeId", async (c) => {
  getAdminSession(c);
  const modelPk = Number(c.req.param("id"));
  const routeId = Number(c.req.param("routeId"));
  if (Number.isNaN(modelPk) || Number.isNaN(routeId)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const parsed = await parseBody(c, updateAiModelRouteBody);
  if (!parsed.ok) return parsed.response;

  const model = await aiModelRepo.findById(modelPk);
  if (!model) return c.json({ error: "Model not found" }, 404);

  const updated = await aiModelRouteRepo.updateForModel(modelPk, routeId, parsed.data);
  if (!updated) return c.json({ error: "Route not found" }, 404);

  return ok(c, updated);
});

router.delete("/models/:id/routes/:routeId", async (c) => {
  getAdminSession(c);
  const modelPk = Number(c.req.param("id"));
  const routeId = Number(c.req.param("routeId"));
  if (Number.isNaN(modelPk) || Number.isNaN(routeId)) return c.json({ error: "Invalid id" }, 400);

  const model = await aiModelRepo.findById(modelPk);
  if (!model) return c.json({ error: "Model not found" }, 404);

  const deleted = await aiModelRouteRepo.deleteForModel(modelPk, routeId);
  if (!deleted) return c.json({ error: "Route not found" }, 404);

  return ok(c, { success: true });
});

export default router;
