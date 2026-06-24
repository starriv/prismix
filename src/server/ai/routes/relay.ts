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
import {
  getGatewayConfigCached,
  resolveTimeoutConfig,
  resolveUpstreamFetchTimeoutMs,
} from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import { gatewayUpstreamDuration } from "@/server/lib/metrics";
import { parseBody } from "@/server/lib/validate";
import { weightedShuffle } from "@/server/lib/weighted-shuffle";
import { enqueueJob } from "@/server/lib/write-queue";
import { getAdminSession } from "@/server/middleware/auth";
import { getRequestId } from "@/server/middleware/request-id";
import { aiGuardrailConfigRepo, aiModelRepo, aiModelRouteRepo } from "@/server/repos";
import { removeTailingZero, safeDividedBy, safeMultipliedBy, safePlus } from "@/shared/number";

import { buildAccessLogErrorMessage, enqueueAiAccessLog } from "../lib/access-log";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { markKeyFailure, markKeySuccess, pickKey } from "../lib/key-balancer";
import { resolveModelMapping } from "../lib/model-mapping-cache";
import { orderRoutesByPriorityAndWeight } from "../lib/model-routing";
import { buildProviderAuth } from "../lib/provider-auth";
import { extractPassthroughHeaders, isRequestLoggingEnabled } from "../lib/request-helpers";
import { notifyResourceDown, type ResourceDownAlertInput } from "../lib/runtime-alerts";
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
import { MAX_UPSTREAM_ATTEMPTS, resolveUpstreamCandidates } from "../lib/upstream-routing";
import { BEDROCK_STREAMING_SUPPORTED } from "../providers/bedrock";
import { getAdapter } from "../providers/registry";
import type { OpenAIChatBody, ProviderAdapter } from "../providers/types";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const relay = new Hono();

interface RelayErrorExtras {
  keyId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;
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
    upstreamId: extras?.upstreamId ?? null,
    upstreamName: extras?.upstreamName ?? null,
    upstreamBaseUrl: extras?.upstreamBaseUrl ?? null,
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

  // -- 2. Build candidate chain via model routes (primary + fallbacks) --
  const candidates = await buildCandidateChain(body.model);
  if (candidates.length === 0) {
    return respondWithRelayError(c, requestId, start, 404, {
      error: `Model "${body.model}" not found or disabled`,
    });
  }

  // -- 3. Try each candidate (fallback loop) --
  let lastError: { status: number; message: string } | null = null;
  let lastResourceDownAlert: ResourceDownAlertInput | null = null;
  let totalAttempts = 0;

  for (const candidate of candidates) {
    if (totalAttempts >= MAX_UPSTREAM_ATTEMPTS) break;
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
      model: candidate.providerModelId,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAIChatBody;
    // Get adapter early to transform body before auth
    const adapter = getAdapter(candidate.provider.apiFormat);
    if (!adapter) continue;
    const transformedBody = adapter.transformRequest(candidateBody);
    const serializedBody = JSON.stringify(transformedBody);

    const attempts = await resolveCandidate(
      candidate,
      adapter,
      !!body.stream,
      serializedBody,
      candidateBody,
    );
    if (attempts.length === 0) continue;

    for (const attempt of attempts) {
      if (totalAttempts >= MAX_UPSTREAM_ATTEMPTS) break;
      totalAttempts++;

      const { finalUrl, authHeaders, keyMeta, serializedBody: attemptBody } = attempt;
      const passthroughHeaders = extractPassthroughHeaders(c);

      const meta: StreamRelayMeta = {
        keyId: keyMeta.keyId,
        providerId: candidate.provider.providerId,
        modelId: candidate.model.modelId,
        requestId,
        start,
        inputPrice: candidate.model.inputPrice,
        outputPrice: candidate.model.outputPrice,
        requestBody: logEnabled ? attemptBody : undefined,
      };

      // -- Cache check (non-streaming only) --
      if (!body.stream) {
        const cacheKey = buildCacheKey({
          scope: "admin",
          model: candidate.model.modelId,
          providerId: candidate.provider.providerId,
          upstreamId: keyMeta.upstreamId,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          requestBody: attemptBody,
        });
        const cached = getCachedResponse(cacheKey);
        if (cached) {
          return c.json(cached);
        }
      }

      if (body.stream) {
        try {
          const upstreamFetchMs = resolveUpstreamFetchTimeoutMs(timeouts, {
            providerId: candidate.provider.providerId,
            modelId: candidate.model.modelId,
          });
          const upstreamRes = await fetchUpstream(
            finalUrl,
            { ...authHeaders, ...passthroughHeaders },
            attemptBody,
            upstreamFetchMs,
            { provider: candidate.provider.providerId, route: "chat" },
          );
          if (upstreamRes.ok) {
            return forwardStream(
              c,
              upstreamRes,
              adapter,
              {
                ...meta,
                upstreamId: keyMeta.upstreamId,
                upstreamName: keyMeta.upstreamName,
                upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              },
              undefined,
              timeouts,
            );
          }
          if (RETRYABLE_STATUS.has(upstreamRes.status)) {
            markKeyFailure(keyMeta.keyId);
            const errBody = await upstreamRes.text().catch(() => "");
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            lastResourceDownAlert = {
              route: "admin-chat",
              requestId,
              providerId: candidate.provider.providerId,
              providerName: candidate.provider.name,
              modelId: candidate.model.modelId,
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              status: lastError.status,
              detail: lastError.message,
            };
            continue;
          }
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
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              requestBody: logEnabled ? attemptBody : undefined,
            },
          );
        } catch (err) {
          markKeyFailure(keyMeta.keyId);
          lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
          lastResourceDownAlert = {
            route: "admin-chat",
            requestId,
            providerId: candidate.provider.providerId,
            providerName: candidate.provider.name,
            modelId: candidate.model.modelId,
            upstreamId: keyMeta.upstreamId,
            upstreamName: keyMeta.upstreamName,
            upstreamBaseUrl: keyMeta.upstreamBaseUrl,
            status: lastError.status,
            detail: lastError.message,
          };
          continue;
        }
      }

      try {
        const fetchStart = Date.now();
        const upstreamRes = await fetch(finalUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
          body: attemptBody,
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
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            lastResourceDownAlert = {
              route: "admin-chat",
              requestId,
              providerId: candidate.provider.providerId,
              providerName: candidate.provider.name,
              modelId: candidate.model.modelId,
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              status: lastError.status,
              detail: lastError.message,
            };
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
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              requestBody: logEnabled ? attemptBody : undefined,
            },
          );
        }

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
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              requestBody: logEnabled ? attemptBody : undefined,
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
          upstreamId: keyMeta.upstreamId,
          upstreamName: keyMeta.upstreamName,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: usage?.totalTokens ?? 0,
          cacheCreationInputTokens: usage?.cacheCreationInputTokens ?? 0,
          cacheReadInputTokens: usage?.cacheReadInputTokens ?? 0,
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
            requestBody: attemptBody,
            responseBody: JSON.stringify(responseBody),
            createdAt: new Date().toISOString(),
          } as Record<string, unknown>);
        }

        enqueueJob("ai-key-touch", {
          keyId: keyMeta.keyId,
          keyType: "admin",
        });

        const cacheKey = buildCacheKey({
          scope: "admin",
          model: candidate.model.modelId,
          providerId: candidate.provider.providerId,
          upstreamId: keyMeta.upstreamId,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          requestBody: attemptBody,
        });
        setCachedResponse(cacheKey, transformed);

        return c.json(transformed);
      } catch (err) {
        markKeyFailure(keyMeta.keyId);
        lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
        lastResourceDownAlert = {
          route: "admin-chat",
          requestId,
          providerId: candidate.provider.providerId,
          providerName: candidate.provider.name,
          modelId: candidate.model.modelId,
          upstreamId: keyMeta.upstreamId,
          upstreamName: keyMeta.upstreamName,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          status: lastError.status,
          detail: lastError.message,
        };
        continue;
      }
    }
  }

  // All candidates exhausted
  if (lastError && lastResourceDownAlert) {
    notifyResourceDown(lastResourceDownAlert);
  }
  return respondWithRelayError(
    c,
    requestId,
    start,
    502,
    { error: "All models failed", detail: lastError?.message ?? "No suitable key found" },
    {
      providerId: candidates[0]?.provider.providerId ?? null,
      modelId: candidates[0]?.model.modelId ?? body.model,
    },
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

  const result = await aiModelRepo.findEnabledByModelId(modelId, "openai");
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

  interface ResolvedPassthroughAttempt {
    keyId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    upstreamName: string;
    upstreamBaseUrl: string;
    serializedBody: string;
  }

  const resolvedAttempts: ResolvedPassthroughAttempt[] = [];
  const serializedBody = JSON.stringify(body);

  for (const upstream of await resolveUpstreamCandidates(provider)) {
    const key = await pickKey(provider.id, upstream.id);
    if (!key) continue;

    try {
      const plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
      const mappedModelId = await resolveModelMapping(upstream.id, modelId);
      const effectiveBody =
        mappedModelId === modelId
          ? serializedBody
          : JSON.stringify({ ...body, model: mappedModelId });
      const base = upstream.baseUrl.replace(/\/+$/, "");
      const upstreamUrl = base.endsWith("/v1") ? `${base}/${subPath}` : `${base}/v1/${subPath}`;
      const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
        provider,
        plainKey,
        upstreamUrl,
        effectiveBody,
      );
      resolvedAttempts.push({
        keyId: key.id,
        authHeaders,
        finalUrl,
        upstreamId: upstream.id,
        upstreamName: upstream.name,
        upstreamBaseUrl: upstream.baseUrl,
        serializedBody: effectiveBody,
      });
    } catch {
      continue;
    }
  }

  if (resolvedAttempts.length === 0) {
    return respondWithRelayError(
      c,
      requestId,
      start,
      403,
      { error: "No API key configured for this provider" },
      { providerId: provider.providerId, modelId },
    );
  }

  const passthroughHeaders = extractPassthroughHeaders(c);
  const isStreaming = body.stream === true;
  let lastError: { status: number; message: string } | null = null;
  let selected = resolvedAttempts[0];

  for (let idx = 0; idx < resolvedAttempts.length && idx < MAX_UPSTREAM_ATTEMPTS; idx++) {
    selected = resolvedAttempts[idx];

    const meta: StreamRelayMeta = {
      keyId: selected.keyId,
      providerId: provider.providerId,
      modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      requestId,
      start,
      inputPrice: result.model.inputPrice,
      outputPrice: result.model.outputPrice,
      requestBody: logEnabled ? selected.serializedBody : undefined,
    };

    try {
      const fetchStart = Date.now();
      const upstreamRes = await fetch(selected.finalUrl, {
        method: c.req.method,
        headers: {
          "Content-Type": "application/json",
          ...selected.authHeaders,
          ...passthroughHeaders,
        },
        body: c.req.method !== "GET" ? selected.serializedBody : undefined,
        signal: AbortSignal.timeout(
          isStreaming
            ? resolveUpstreamFetchTimeoutMs(timeouts, {
                providerId: provider.providerId,
                modelId,
              })
            : timeouts.streamMaxDurationMs,
        ),
      });
      gatewayUpstreamDuration.observe(
        { provider: provider.providerId, route: "passthrough", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );

      if (isStreaming && upstreamRes.ok && upstreamRes.body) {
        return forwardPassthroughStream(c, upstreamRes, meta, undefined, timeouts);
      }

      if (!upstreamRes.ok && RETRYABLE_STATUS.has(upstreamRes.status)) {
        markKeyFailure(selected.keyId);
        const errBody = await upstreamRes.text().catch(() => "");
        lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
        continue;
      }

      const latencyMs = Date.now() - start;
      const isJson = (upstreamRes.headers.get("content-type") ?? "").includes("application/json");
      let responseText: string | null = null;
      let usage: ReturnType<typeof extractPassthroughUsage> = null;

      if (isJson) {
        responseText = await upstreamRes.text();
        usage = extractPassthroughUsage(responseText);
      }

      if (upstreamRes.ok) {
        markKeySuccess(selected.keyId);
      } else if (upstreamRes.status === 429 || upstreamRes.status >= 500) {
        markKeyFailure(selected.keyId);
      }

      enqueueJob("ai-usage-log", {
        keyId: selected.keyId,
        providerId: provider.providerId,
        modelId,
        upstreamId: selected.upstreamId,
        upstreamName: selected.upstreamName,
        upstreamBaseUrl: selected.upstreamBaseUrl,
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
          requestBody: selected.serializedBody,
          responseBody: responseText ?? "",
          createdAt: new Date().toISOString(),
        } as Record<string, unknown>);
      }
      enqueueJob("ai-key-touch", { keyId: selected.keyId, keyType: "admin" });

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
      markKeyFailure(selected.keyId);
      lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
    }
  }

  if (lastError) {
    notifyResourceDown({
      route: "admin-passthrough",
      requestId,
      providerId: provider.providerId,
      providerName: provider.name,
      modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      status: lastError.status,
      detail: lastError.message,
    });
  }

  return respondWithRelayError(
    c,
    requestId,
    start,
    lastError?.status || 502,
    { error: "All upstream candidates failed", detail: lastError?.message ?? "Unknown error" },
    {
      keyId: selected.keyId,
      providerId: provider.providerId,
      modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      requestBody: logEnabled ? selected.serializedBody : undefined,
    },
  );
});

export default relay;

// ── Helpers ──────────────────────────────────────────────────────────

interface Candidate {
  model: AiModel;
  provider: AiProvider;
  /** Actual model slug sent to the upstream provider (may differ from model.modelId). */
  providerModelId: string;
}

interface KeyMeta {
  keyId: number;
  upstreamId: number | null;
  upstreamName: string;
  upstreamBaseUrl: string;
}

interface ResolvedCandidate {
  adapter: ProviderAdapter;
  finalUrl: string;
  authHeaders: Record<string, string>;
  keyMeta: KeyMeta;
  serializedBody: string;
  effectiveModelId: string;
}

/**
 * Build candidate list via model routes: each route maps a model to a provider.
 * Routes are sorted by priority ASC (from repo). After route-level candidates,
 * cross-model fallbacks (fallbackModelIds) are appended — each resolved through
 * their own routes.
 */
async function buildCandidateChain(modelId: string): Promise<Candidate[]> {
  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(modelId, "openai"),
  );
  if (routes.length === 0) return [];

  // Append cross-model fallbacks (orthogonal to route-level failover)
  const primaryModel = routes[0].model;
  const primaryCandidates =
    (primaryModel.weight ?? 1) > 0
      ? routes.map((r) => ({
          model: r.model,
          provider: r.provider,
          providerModelId: r.route.providerModelId ?? r.model.modelId,
        }))
      : [];
  const fallbackGroups: Array<{ model: AiModel; candidates: Candidate[] }> = [];

  if (primaryModel.fallbackModelIds) {
    const fallbackIds = safeParseJsonArray(primaryModel.fallbackModelIds, "fallbackModelIds");
    const seenFallbackIds = new Set<string>();

    for (const fbModelId of fallbackIds) {
      if (seenFallbackIds.has(fbModelId)) continue;
      seenFallbackIds.add(fbModelId);

      const fbRoutes = orderRoutesByPriorityAndWeight(
        await aiModelRouteRepo.findEnabledRoutesByModelId(fbModelId, "openai"),
      );
      if (fbRoutes.length === 0) continue;

      const fallbackModel = fbRoutes[0].model;
      if ((fallbackModel.weight ?? 1) <= 0) continue;

      fallbackGroups.push({
        model: fallbackModel,
        candidates: fbRoutes.map((fbr) => ({
          model: fbr.model,
          provider: fbr.provider,
          providerModelId: fbr.route.providerModelId ?? fbr.model.modelId,
        })),
      });
    }
  }

  return [
    ...primaryCandidates,
    ...weightedShuffle(fallbackGroups, (group) => group.model.weight ?? 1).flatMap(
      (group) => group.candidates,
    ),
  ];
}

/** Resolve key, auth headers, and URL for a candidate model. */
async function resolveCandidate(
  candidate: Candidate,
  adapter: ProviderAdapter,
  stream: boolean,
  defaultSerializedBody: string,
  candidateBody: OpenAIChatBody,
): Promise<ResolvedCandidate[]> {
  const { provider } = candidate;
  const upstreams = await resolveUpstreamCandidates(provider);
  const resolved: ResolvedCandidate[] = [];

  for (const upstream of upstreams) {
    const key = await pickKey(provider.id, upstream.id);
    if (!key) continue;

    let plainKey: string;
    try {
      plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
    } catch (err) {
      log.gateway.error({ err, keyId: key.id }, "Failed to decrypt AI key");
      continue;
    }

    const mappedModelId = await resolveModelMapping(upstream.id, candidate.providerModelId);
    const needsRemap = mappedModelId !== candidate.providerModelId;

    const effectiveBody = needsRemap
      ? JSON.stringify(adapter.transformRequest({ ...candidateBody, model: mappedModelId }))
      : defaultSerializedBody;

    const upstreamUrl = adapter.buildUrl(upstream.baseUrl, { model: mappedModelId, stream });
    const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
      provider,
      plainKey,
      upstreamUrl,
      effectiveBody,
    );

    resolved.push({
      adapter,
      finalUrl,
      authHeaders,
      keyMeta: {
        keyId: key.id,
        upstreamId: upstream.id,
        upstreamName: upstream.name,
        upstreamBaseUrl: upstream.baseUrl,
      },
      serializedBody: effectiveBody,
      effectiveModelId: mappedModelId,
    });
  }

  return resolved;
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

export function isUnsupportedStreamingCandidate(
  stream: boolean | undefined,
  apiFormat: string,
): boolean {
  return !!stream && apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED;
}
