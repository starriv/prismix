/**
 * AI Relay route — proxies OpenAI-compatible chat completion requests to upstream providers.
 *
 * Mounted at /api/admin/ai/relay (adminAuthMiddleware applied via parent).
 * Supports: non-streaming + SSE streaming, model fallback chain, cost tracking.
 */
import { Hono } from "hono";

import type { AiModel, AiProvider } from "@/server/db";
import { aiRelayChatBody } from "@/server/lib/body-schemas";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { parseBody } from "@/server/lib/validate";
import { enqueueJob } from "@/server/lib/write-queue";
import { getAdminSession } from "@/server/middleware/auth";
import { getRequestId } from "@/server/middleware/request-id";
import { aiGuardrailConfigRepo, aiModelRepo } from "@/server/repos";
import { removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { pickKey } from "../lib/key-balancer";
import { buildProviderAuth } from "../lib/provider-auth";
import { extractPassthroughHeaders } from "../lib/request-helpers";
import { safeParseGuardrailRules, safeParseJsonArray } from "../lib/safe-json";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "../lib/semantic-cache";
import {
  extractPassthroughUsage,
  fetchUpstream,
  forwardPassthroughStream,
  forwardStream,
  RETRYABLE_STATUS,
  type StreamRelayMeta,
} from "../lib/stream-proxy";
import { getAdapter } from "../providers/registry";
import type { OpenAIChatBody, ProviderAdapter } from "../providers/types";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

/** Default upstream timeout: 5 minutes (AI requests can be slow). */
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;

const relay = new Hono();

// ── GET /v1/models — OpenAI-compatible model catalog ────────────────

relay.get("/v1/models", async (c) => {
  getAdminSession(c);
  const rows = await aiModelRepo.findAllEnabled();
  const data = rows.map((r) => ({
    id: r.model.modelId,
    object: "model" as const,
    created: Math.floor(new Date(r.model.createdAt).getTime() / 1000),
    owned_by: r.provider.providerId,
  }));
  return c.json({ object: "list", data });
});

// ── POST /v1/chat/completions ────────────────────────────────────────

relay.post("/v1/chat/completions", async (c) => {
  getAdminSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  // -- 1. Validate request body --
  const parsed = await parseBody(c, aiRelayChatBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // -- 1b. Input guardrails --
  const guardrailConfigs = await aiGuardrailConfigRepo.findAllEnabled();
  if (guardrailConfigs.length > 0) {
    for (const gc of guardrailConfigs) {
      const rules = safeParseGuardrailRules(gc.rules);
      if (!rules) continue;
      const result = checkInputGuardrails(body.messages, {
        rules,
        action: gc.action as GuardrailConfig["action"],
      });
      if (!result.allowed && gc.action === "block") {
        return c.json(
          {
            error: result.reason ?? "Request blocked by guardrails",
            flagged: result.flaggedContent,
          },
          403,
        );
      }
      if (!result.allowed) {
        log.gateway.warn({ reason: result.reason }, "AI guardrail triggered");
      }
    }
  }

  // -- 2. Build candidate chain (primary + fallbacks) --
  const primary = await aiModelRepo.findEnabledByModelId(body.model);
  if (!primary) {
    return c.json({ error: `Model "${body.model}" not found or disabled` }, 404);
  }

  const candidates = await buildCandidateChain(primary.model, primary.provider);

  // -- 3. Try each candidate (fallback loop) --
  let lastError: { status: number; message: string } | null = null;

  for (const candidate of candidates) {
    // Pre-compute transformed body for this candidate (needed for SigV4 signing)
    // Inject stream_options at route level so OpenAI-compatible providers return usage in SSE chunks.
    const candidateBody = {
      ...body,
      model: candidate.model.modelId,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAIChatBody;
    // Get adapter early to transform body before auth
    const adapter = getAdapter(candidate.provider.apiFormat);
    if (!adapter) continue;
    const transformedBody = adapter.transformRequest(candidateBody);
    const serializedBody = JSON.stringify(transformedBody);

    const attempt = await resolveCandidate(candidate, adapter, !!body.stream, serializedBody);
    if (!attempt) continue; // no key for this provider

    const { finalUrl, authHeaders, keyMeta } = attempt;

    const meta: StreamRelayMeta = {
      keyId: keyMeta.keyId,
      providerId: candidate.provider.providerId,
      modelId: candidate.model.modelId,
      requestId,
      start,
      inputPrice: candidate.model.inputPrice,
      outputPrice: candidate.model.outputPrice,
    };

    // -- Cache check (non-streaming only) --
    if (!body.stream) {
      const cacheKey = buildCacheKey(candidate.model.modelId, body.messages);
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        return c.json(cached);
      }
    }

    // -- Streaming path --
    if (body.stream) {
      try {
        const upstreamRes = await fetchUpstream(finalUrl, authHeaders, serializedBody);
        if (upstreamRes.ok) {
          return forwardStream(c, upstreamRes, adapter, meta);
        }
        // Retryable → try next candidate
        if (RETRYABLE_STATUS.has(upstreamRes.status)) {
          const errBody = await upstreamRes.text().catch(() => "");
          log.gateway.warn(
            { provider: meta.providerId, model: meta.modelId, status: upstreamRes.status },
            "AI relay fallback: retryable stream error",
          );
          lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
          continue;
        }
        // Non-retryable → return error immediately
        const errBody = await upstreamRes.text().catch(() => "");
        return c.json(
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          upstreamRes.status as 400,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = { status: 0, message };
        continue;
      }
    }

    // -- Non-streaming path --
    try {
      const upstreamRes = await fetch(finalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: serializedBody,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      if (!upstreamRes.ok) {
        const errBody = await upstreamRes.text().catch(() => "");
        if (RETRYABLE_STATUS.has(upstreamRes.status)) {
          log.gateway.warn(
            { provider: meta.providerId, model: meta.modelId, status: upstreamRes.status },
            "AI relay fallback: retryable error",
          );
          lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
          continue;
        }
        return c.json(
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          upstreamRes.status as 400,
        );
      }

      // Success — parse, transform, log, return
      const latencyMs = Date.now() - start;
      let responseBody: unknown;
      try {
        responseBody = await upstreamRes.json();
      } catch {
        return c.json({ error: "Failed to parse upstream response" }, 502);
      }

      const transformed = adapter.transformResponse(responseBody);
      const usage = adapter.extractUsage(responseBody);

      const cost = calculateCost(usage, candidate.model);
      enqueueJob("ai-usage-log", {
        keyId: keyMeta.keyId,
        providerId: candidate.provider.providerId,
        modelId: candidate.model.modelId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        estimatedCost: cost ?? null,
        latencyMs,
        statusCode: upstreamRes.status,
        requestId,
      } as Record<string, unknown>);

      enqueueJob("ai-key-touch", {
        keyId: keyMeta.keyId,
        keyType: "admin",
      });

      // Store in cache for future identical requests
      const cacheKey = buildCacheKey(candidate.model.modelId, body.messages);
      setCachedResponse(cacheKey, transformed);

      return c.json(transformed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.gateway.error(
        { err, provider: meta.providerId, model: meta.modelId },
        "AI relay upstream fetch failed",
      );
      lastError = { status: 0, message };
      continue;
    }
  }

  // All candidates exhausted
  return c.json(
    { error: "All models failed", detail: lastError?.message ?? "No suitable key found" },
    502,
  );
});

// ── ALL /v1/* — Generic passthrough proxy (must be LAST) ────────────
//
// Catch-all for any /v1/* endpoint not matched above (e.g. /v1/messages,
// /v1/embeddings). Forwards request as-is to the upstream provider.
// Registered last so specific handlers (/v1/models, /v1/chat/completions)
// take priority.

relay.all("/v1/*", async (c) => {
  getAdminSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();
  const subPath = c.req.path.replace(/^.*\/v1\//, "");

  // Parse model from body (POST/PUT/PATCH)
  let body: Record<string, unknown> = {};
  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH") {
    try {
      const raw: unknown = await c.req.json();
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return c.json({ error: "Request body must be a JSON object" }, 400);
      }
      body = raw as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
  }

  const modelId = body.model as string | undefined;
  if (!modelId) {
    return c.json({ error: "Request body must contain a 'model' field" }, 400);
  }

  const result = await aiModelRepo.findEnabledByModelId(modelId);
  if (!result) {
    return c.json({ error: `Model "${modelId}" not found or disabled` }, 404);
  }

  const { provider } = result;

  const key = await pickKey(provider.id);
  if (!key) return c.json({ error: "No API key configured for this provider" }, 403);

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch {
    return c.json({ error: "Failed to decrypt provider key" }, 500);
  }

  const base = provider.baseUrl.replace(/\/+$/, "");
  const upstreamUrl = base.endsWith("/v1") ? `${base}/${subPath}` : `${base}/v1/${subPath}`;

  const serializedBody = JSON.stringify(body);
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
    provider,
    plainKey,
    upstreamUrl,
    serializedBody,
  );

  const passthroughHeaders = extractPassthroughHeaders(c);

  const meta: StreamRelayMeta = {
    keyId: key.id,
    providerId: provider.providerId,
    modelId,
    requestId,
    start,
    inputPrice: result.model.inputPrice,
    outputPrice: result.model.outputPrice,
  };

  const isStreaming = body.stream === true;

  try {
    const upstreamRes = await fetch(finalUrl, {
      method: c.req.method,
      headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
      body: c.req.method !== "GET" ? serializedBody : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // ── Streaming passthrough — parse SSE frames for usage ──
    if (isStreaming && upstreamRes.ok && upstreamRes.body) {
      return forwardPassthroughStream(c, upstreamRes, meta);
    }

    // ── Non-streaming passthrough — read JSON for usage ──
    const latencyMs = Date.now() - start;
    const isJson = (upstreamRes.headers.get("content-type") ?? "").includes("application/json");
    let responseText: string | null = null;
    let usage: ReturnType<typeof extractPassthroughUsage> = null;

    if (isJson) {
      responseText = await upstreamRes.text();
      usage = extractPassthroughUsage(responseText);
    }

    enqueueJob("ai-usage-log", {
      keyId: key.id,
      providerId: provider.providerId,
      modelId,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      latencyMs,
      statusCode: upstreamRes.status,
      requestId,
    } as Record<string, unknown>);
    enqueueJob("ai-key-touch", { keyId: key.id, keyType: "admin" });

    const resHeaders = new Headers();
    upstreamRes.headers.forEach((v, k) => {
      if (!["transfer-encoding", "content-encoding", "connection"].includes(k.toLowerCase())) {
        resHeaders.set(k, v);
      }
    });

    const responseBody = responseText !== null ? responseText : upstreamRes.body;
    return new Response(responseBody, {
      status: upstreamRes.status,
      headers: resHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Upstream request failed: ${message}` }, 502);
  }
});

export default relay;

// ── Helpers ──────────────────────────────────────────────────────────

interface Candidate {
  model: AiModel;
  provider: AiProvider;
}

interface KeyMeta {
  keyId: number;
}

interface ResolvedCandidate {
  adapter: ProviderAdapter;
  finalUrl: string;
  authHeaders: Record<string, string>;
  keyMeta: KeyMeta;
}

/**
 * Build weighted candidate list: primary + fallbacks, ordered by weighted random selection.
 * Candidates with weight=0 are excluded. Higher weight = higher probability of being first.
 */
async function buildCandidateChain(
  primaryModel: AiModel,
  primaryProvider: AiProvider,
): Promise<Candidate[]> {
  const pool: Candidate[] = [{ model: primaryModel, provider: primaryProvider }];

  // Collect fallbacks
  if (primaryModel.fallbackModelIds) {
    const fallbackIds = safeParseJsonArray(primaryModel.fallbackModelIds, "fallbackModelIds");
    for (const modelId of fallbackIds) {
      const result = await aiModelRepo.findEnabledByModelId(modelId);
      if (result) pool.push({ model: result.model, provider: result.provider });
    }
  }

  // Filter out weight=0 candidates
  const weighted = pool.filter((c) => (c.model.weight ?? 1) > 0);
  if (weighted.length <= 1) return weighted;

  // Weighted shuffle: pick candidates in probability-weighted order
  return weightedShuffle(weighted);
}

/** Resolve key, auth headers, and URL for a candidate model. */
async function resolveCandidate(
  candidate: Candidate,
  adapter: ProviderAdapter,
  stream: boolean,
  bodyForSigning?: string,
): Promise<ResolvedCandidate | null> {
  const { model, provider } = candidate;

  const key = await pickKey(provider.id);
  if (!key) return null;

  const keyMeta: KeyMeta = { keyId: key.id };

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch (err) {
    log.gateway.error({ err, keyId: key.id }, "Failed to decrypt AI key");
    return null;
  }

  // Build URL + auth headers
  const upstreamUrl = adapter.buildUrl(provider.baseUrl, { model: model.modelId, stream });
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
    provider,
    plainKey,
    upstreamUrl,
    bodyForSigning,
  );

  return { adapter, finalUrl, authHeaders, keyMeta };
}

function calculateCost(
  usage: { inputTokens: number; outputTokens: number } | null | undefined,
  model: AiModel,
): string | undefined {
  if (!usage) return undefined;
  const inputCost = safeDividedBy(safeMultipliedBy(usage.inputTokens, model.inputPrice), 1_000_000);
  const outputCost = safeDividedBy(
    safeMultipliedBy(usage.outputTokens, model.outputPrice),
    1_000_000,
  );
  return removeTailingZero(safePlus(inputCost, outputCost), 6);
}

/**
 * Weighted shuffle: reorder candidates so higher-weight items appear first probabilistically.
 * Uses Fisher-Yates with weighted random selection (no shared state, stateless per-request).
 */
function weightedShuffle(candidates: Candidate[]): Candidate[] {
  const result: Candidate[] = [];
  const pool = [...candidates];

  while (pool.length > 0) {
    const totalWeight = pool.reduce((sum, c) => sum + (c.model.weight ?? 1), 0);
    let rand = Math.random() * totalWeight;
    let picked = false;

    for (let i = 0; i < pool.length; i++) {
      rand -= pool[i].model.weight ?? 1;
      if (rand <= 0) {
        result.push(pool[i]);
        pool.splice(i, 1);
        picked = true;
        break;
      }
    }

    // M2: Floating-point safety — if rand didn't reach <= 0, pick last element
    if (!picked && pool.length > 0) {
      result.push(pool.pop()!);
    }
  }

  return result;
}
