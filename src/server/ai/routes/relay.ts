/**
 * AI Relay route — proxies OpenAI-compatible chat completion requests to upstream providers.
 *
 * Mounted at /api/admin/ai/relay (adminAuthMiddleware applied via parent).
 * Supports: non-streaming + SSE streaming, model fallback chain, cost tracking.
 */
import { type Context, Hono } from "hono";

import type { AiModel, AiProvider } from "@/server/db";
import { aiRelayChatBody } from "@/server/lib/body-schemas";
import { decrypt } from "@/server/lib/crypto";
import { getGatewayConfigCached, resolveTimeoutConfig } from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import { gatewayUpstreamDuration } from "@/server/lib/metrics";
import { parseBody } from "@/server/lib/validate";
import { enqueueJob } from "@/server/lib/write-queue";
import { getAdminSession } from "@/server/middleware/auth";
import { getRequestId } from "@/server/middleware/request-id";
import { aiGuardrailConfigRepo, aiModelRepo } from "@/server/repos";
import { removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import { buildAccessLogErrorMessage, enqueueAiAccessLog } from "../lib/access-log";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { markKeyFailure, markKeySuccess, pickKey } from "../lib/key-balancer";
import { buildProviderAuth } from "../lib/provider-auth";
import { extractPassthroughHeaders, isRequestLoggingEnabled } from "../lib/request-helpers";
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
import { BEDROCK_STREAMING_SUPPORTED } from "../providers/bedrock";
import { getAdapter } from "../providers/registry";
import type { OpenAIChatBody, ProviderAdapter } from "../providers/types";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const relay = new Hono();

interface RelayErrorExtras {
  keyId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  requestBody?: string;
  responseBody?: string;
  estimatedCost?: string | null;
}

function respondWithRelayError(
  c: Context,
  requestId: string,
  start: number,
  statusCode: number,
  payload: Record<string, unknown>,
  extras?: RelayErrorExtras,
): Response {
  enqueueAiAccessLog({
    requestId,
    statusCode,
    keyId: extras?.keyId ?? null,
    providerId: extras?.providerId ?? null,
    modelId: extras?.modelId ?? null,
    estimatedCost: extras?.estimatedCost ?? null,
    latencyMs: Date.now() - start,
    requestBody: extras?.requestBody,
    responseBody: extras?.responseBody ?? JSON.stringify(payload),
    error: buildAccessLogErrorMessage(
      typeof payload.error === "string" ? payload.error : `HTTP ${statusCode}`,
      "detail" in payload ? payload.detail : undefined,
    ),
  });
  return c.json(payload, statusCode as 400);
}

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
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);
  const logEnabled = await isRequestLoggingEnabled();

  // -- 1. Validate request body --
  const parsed = await parseBody(c, aiRelayChatBody);
  if (!parsed.ok) return respondWithRelayError(c, requestId, start, 400, { error: parsed.error });
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
        return respondWithRelayError(c, requestId, start, 403, {
          error: result.reason ?? "Request blocked by guardrails",
          flagged: result.flaggedContent,
        });
      }
      if (!result.allowed) {
        log.gateway.warn({ reason: result.reason }, "AI guardrail triggered");
      }
    }
  }

  // -- 2. Build candidate chain (primary + fallbacks) --
  const primary = await aiModelRepo.findEnabledByModelId(body.model);
  if (!primary) {
    return respondWithRelayError(c, requestId, start, 404, {
      error: `Model "${body.model}" not found or disabled`,
    });
  }

  const candidates = await buildCandidateChain(primary.model, primary.provider);

  if (isUnsupportedStreamingCandidate(body.stream, primary.provider.apiFormat)) {
    return respondWithRelayError(
      c,
      requestId,
      start,
      400,
      { error: "Bedrock streaming is not supported yet" },
      { providerId: primary.provider.providerId, modelId: primary.model.modelId },
    );
  }

  // -- 3. Try each candidate (fallback loop) --
  let lastError: { status: number; message: string } | null = null;

  for (const candidate of candidates) {
    if (isUnsupportedStreamingCandidate(body.stream, candidate.provider.apiFormat)) {
      log.gateway.info(
        { provider: candidate.provider.providerId, model: candidate.model.modelId, requestId },
        "Skipping unsupported Bedrock streaming fallback candidate",
      );
      continue;
    }

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
    const passthroughHeaders = extractPassthroughHeaders(c);

    const meta: StreamRelayMeta = {
      keyId: keyMeta.keyId,
      providerId: candidate.provider.providerId,
      modelId: candidate.model.modelId,
      requestId,
      start,
      inputPrice: candidate.model.inputPrice,
      outputPrice: candidate.model.outputPrice,
      requestBody: logEnabled ? serializedBody : undefined,
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
        const upstreamRes = await fetchUpstream(
          finalUrl,
          { ...authHeaders, ...passthroughHeaders },
          serializedBody,
          timeouts.upstreamFetchMs,
          { provider: candidate.provider.providerId, route: "chat" },
        );
        if (upstreamRes.ok) {
          return forwardStream(c, upstreamRes, adapter, meta, undefined, timeouts);
        }
        // Retryable → try next candidate
        if (RETRYABLE_STATUS.has(upstreamRes.status)) {
          markKeyFailure(keyMeta.keyId);
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
        return respondWithRelayError(
          c,
          requestId,
          start,
          upstreamRes.status,
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          {
            keyId: keyMeta.keyId,
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
            requestBody: logEnabled ? serializedBody : undefined,
          },
        );
      } catch (err) {
        markKeyFailure(keyMeta.keyId);
        const message = err instanceof Error ? err.message : String(err);
        lastError = { status: 0, message };
        continue;
      }
    }

    // -- Non-streaming path --
    try {
      const fetchStart = Date.now();
      const upstreamRes = await fetch(finalUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
        body: serializedBody,
        signal: AbortSignal.timeout(timeouts.streamMaxDurationMs),
      });
      gatewayUpstreamDuration.observe(
        { provider: candidate.provider.providerId, route: "chat", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );

      if (!upstreamRes.ok) {
        const errBody = await upstreamRes.text().catch(() => "");
        if (RETRYABLE_STATUS.has(upstreamRes.status)) {
          markKeyFailure(keyMeta.keyId);
          log.gateway.warn(
            { provider: meta.providerId, model: meta.modelId, status: upstreamRes.status },
            "AI relay fallback: retryable error",
          );
          lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
          continue;
        }
        return respondWithRelayError(
          c,
          requestId,
          start,
          upstreamRes.status,
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          {
            keyId: keyMeta.keyId,
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
            requestBody: logEnabled ? serializedBody : undefined,
          },
        );
      }

      // Success — parse, transform, log, return
      const latencyMs = Date.now() - start;
      let responseBody: unknown;
      try {
        responseBody = await upstreamRes.json();
      } catch {
        return respondWithRelayError(
          c,
          requestId,
          start,
          502,
          { error: "Failed to parse upstream response" },
          {
            keyId: keyMeta.keyId,
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
            requestBody: logEnabled ? serializedBody : undefined,
          },
        );
      }

      const transformed = adapter.transformResponse(responseBody);
      const usage = adapter.extractUsage(responseBody);
      markKeySuccess(keyMeta.keyId);

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
        error: null,
      } as Record<string, unknown>);

      if (logEnabled) {
        enqueueJob("ai-request-log", {
          requestId,
          consumerKeyId: null,
          modelId: candidate.model.modelId,
          requestBody: serializedBody,
          responseBody: JSON.stringify(responseBody),
          createdAt: new Date().toISOString(),
        } as Record<string, unknown>);
      }

      enqueueJob("ai-key-touch", {
        keyId: keyMeta.keyId,
        keyType: "admin",
      });

      // Store in cache for future identical requests
      const cacheKey = buildCacheKey(candidate.model.modelId, body.messages);
      setCachedResponse(cacheKey, transformed);

      return c.json(transformed);
    } catch (err) {
      markKeyFailure(keyMeta.keyId);
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
  return respondWithRelayError(
    c,
    requestId,
    start,
    502,
    { error: "All models failed", detail: lastError?.message ?? "No suitable key found" },
    { providerId: primary.provider.providerId, modelId: primary.model.modelId },
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
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);
  const subPath = c.req.path.replace(/^.*\/v1\//, "");
  const logEnabled = await isRequestLoggingEnabled();

  // Parse model from body (POST/PUT/PATCH)
  let body: Record<string, unknown> = {};
  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH") {
    try {
      const raw: unknown = await c.req.json();
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return respondWithRelayError(c, requestId, start, 400, {
          error: "Request body must be a JSON object",
        });
      }
      body = raw as Record<string, unknown>;
    } catch {
      return respondWithRelayError(c, requestId, start, 400, { error: "Invalid JSON body" });
    }
  }

  const modelId = body.model as string | undefined;
  if (!modelId) {
    return respondWithRelayError(c, requestId, start, 400, {
      error: "Request body must contain a 'model' field",
    });
  }

  const result = await aiModelRepo.findEnabledByModelId(modelId);
  if (!result) {
    return respondWithRelayError(c, requestId, start, 404, {
      error: `Model "${modelId}" not found or disabled`,
    });
  }

  const { provider } = result;

  if (body.stream === true && provider.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
    return respondWithRelayError(
      c,
      requestId,
      start,
      400,
      { error: "Bedrock streaming is not supported yet" },
      { providerId: provider.providerId, modelId },
    );
  }

  const key = await pickKey(provider.id);
  if (!key) {
    return respondWithRelayError(
      c,
      requestId,
      start,
      403,
      { error: "No API key configured for this provider" },
      { providerId: provider.providerId, modelId },
    );
  }

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch {
    return respondWithRelayError(
      c,
      requestId,
      start,
      500,
      { error: "Failed to decrypt provider key" },
      { keyId: key.id, providerId: provider.providerId, modelId },
    );
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
    requestBody: logEnabled ? serializedBody : undefined,
  };

  const isStreaming = body.stream === true;

  try {
    const fetchStart = Date.now();
    const upstreamRes = await fetch(finalUrl, {
      method: c.req.method,
      headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
      body: c.req.method !== "GET" ? serializedBody : undefined,
      signal: AbortSignal.timeout(
        isStreaming ? timeouts.upstreamFetchMs : timeouts.streamMaxDurationMs,
      ),
    });
    gatewayUpstreamDuration.observe(
      { provider: provider.providerId, route: "passthrough", phase: "response" },
      (Date.now() - fetchStart) / 1000,
    );

    // ── Streaming passthrough — parse SSE frames for usage ──
    if (isStreaming && upstreamRes.ok && upstreamRes.body) {
      return forwardPassthroughStream(c, upstreamRes, meta, undefined, timeouts);
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

    if (upstreamRes.ok) {
      markKeySuccess(key.id);
    } else if (upstreamRes.status === 429 || upstreamRes.status >= 500) {
      markKeyFailure(key.id);
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
      error:
        !upstreamRes.ok && responseText
          ? buildAccessLogErrorMessage(`Upstream returned ${upstreamRes.status}`, responseText)
          : !upstreamRes.ok
            ? `Upstream returned ${upstreamRes.status}`
            : null,
    } as Record<string, unknown>);

    if (logEnabled) {
      enqueueJob("ai-request-log", {
        requestId,
        consumerKeyId: null,
        modelId,
        requestBody: serializedBody,
        responseBody: responseText ?? "",
        createdAt: new Date().toISOString(),
      } as Record<string, unknown>);
    }
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
    markKeyFailure(key.id);
    const message = err instanceof Error ? err.message : String(err);
    return respondWithRelayError(
      c,
      requestId,
      start,
      502,
      { error: `Upstream request failed: ${message}` },
      {
        keyId: key.id,
        providerId: provider.providerId,
        modelId,
        requestBody: logEnabled ? serializedBody : undefined,
      },
    );
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

export function isUnsupportedStreamingCandidate(
  stream: boolean | undefined,
  apiFormat: string,
): boolean {
  return !!stream && apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED;
}
