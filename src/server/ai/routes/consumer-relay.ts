/**
 * Consumer AI Relay route — same pipeline as relay.ts but authenticated via ska_ consumer keys.
 *
 * Adds: balance gate, model ACL, post-request billing (debit + transaction record).
 * Mounted at /api/gateway/ai/openai and /api/gateway/ai/anthropic
 * (consumerKeyAuthMiddleware applied via parent).
 */
import { type Context, Hono } from "hono";

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
import { getRequestId } from "@/server/middleware/request-id";
import { aiGuardrailConfigRepo, aiModelRepo, aiModelRouteRepo } from "@/server/repos";
import { removeTailingZero } from "@/shared/number";

import { buildAccessLogErrorMessage, enqueueAiAccessLog } from "../lib/access-log";
import { billConsumer, checkConsumerSpendingLimits } from "../lib/billing";
import { type ClientFormat, isNativePassthroughProvider } from "../lib/client-format";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { markKeyFailure, markKeySuccess, pickKey } from "../lib/key-balancer";
import { resolveModelMapping } from "../lib/model-mapping-cache";
import { orderRoutesByPriorityAndWeight } from "../lib/model-routing";
import { buildProviderAuth } from "../lib/provider-auth";
import { extractPassthroughHeaders, isRequestLoggingEnabled } from "../lib/request-helpers";
import { safeParseGuardrailRules } from "../lib/safe-json";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "../lib/semantic-cache";
import {
  extractPassthroughUsage,
  fetchUpstream,
  forwardPassthroughStream,
  forwardStream,
  RETRYABLE_STATUS,
  type StreamCompleteCallback,
  type StreamRelayMeta,
} from "../lib/stream-proxy";
import { MAX_UPSTREAM_ATTEMPTS, resolveUpstreamCandidates } from "../lib/upstream-routing";
import { type ConsumerSession, getConsumerSession } from "../middleware/consumer-key-auth";
import { BEDROCK_STREAMING_SUPPORTED } from "../providers/bedrock";
import { getAdapter } from "../providers/registry";
import type { OpenAIChatBody, TokenUsage } from "../providers/types";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";

const consumerOpenAiRelay = new Hono();
const consumerAnthropicRelay = new Hono();

interface ConsumerErrorExtras {
  keyId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  upstreamId?: number | null;
  upstreamName?: string | null;
  upstreamBaseUrl?: string | null;

  requestBody?: string;
  responseBody?: string;
  estimatedCost?: string | null;
  upstreamCost?: string | null;
}

function respondWithConsumerError(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  statusCode: number,
  payload: Record<string, unknown>,
  extras?: ConsumerErrorExtras,
): Response {
  enqueueAiAccessLog({
    requestId,
    statusCode,
    keyId: extras?.keyId ?? null,
    consumerKeyId: consumer.consumerId,
    userId: consumer.userId,
    providerId: extras?.providerId ?? null,
    modelId: extras?.modelId ?? null,
    upstreamId: extras?.upstreamId ?? null,
    upstreamName: extras?.upstreamName ?? null,
    upstreamBaseUrl: extras?.upstreamBaseUrl ?? null,

    estimatedCost: extras?.estimatedCost ?? null,
    upstreamCost: extras?.upstreamCost ?? null,
    markupPercent: consumer.markupPercent,
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

async function listConsumerModels(consumer: ConsumerSession, clientFormat: ClientFormat) {
  const rows = await aiModelRepo.findAllEnabled(clientFormat);
  if (consumer.allowedModels.length === 0) return rows;

  return rows.filter((r) =>
    consumer.allowedModels.some((pattern) =>
      pattern.endsWith("*")
        ? r.model.modelId.startsWith(pattern.slice(0, -1))
        : r.model.modelId === pattern,
    ),
  );
}

// ── GET /v1/models — OpenAI-compatible model catalog ────────────────

consumerOpenAiRelay.get("/v1/models", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);

  try {
    const filtered = await listConsumerModels(consumer, "openai");
    const data = filtered.map((r) => ({
      id: r.model.modelId,
      object: "model" as const,
      created: Math.floor(new Date(r.model.createdAt).getTime() / 1000),
      owned_by: r.provider.providerId,
    }));
    return c.json({ object: "list", data });
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in models handler",
    );
    enqueueAiAccessLog({
      requestId,
      statusCode: 500,
      error: err instanceof Error ? err.message : "Internal Server Error",
      consumerKeyId: consumer.consumerId,
      userId: consumer.userId,
    });
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// ── GET /v1/models — Anthropic-compatible model catalog ─────────────

consumerAnthropicRelay.get("/v1/models", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);

  try {
    const filtered = await listConsumerModels(consumer, "anthropic");
    const data = filtered.map((r) => ({
      id: r.model.modelId,
      type: "model" as const,
      display_name: r.model.name,
      created_at: new Date(r.model.createdAt).toISOString(),
    }));
    return c.json({
      data,
      first_id: data[0]?.id ?? null,
      last_id: data.at(-1)?.id ?? null,
      has_more: false,
    });
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in anthropic models handler",
    );
    enqueueAiAccessLog({
      requestId,
      statusCode: 500,
      error: err instanceof Error ? err.message : "Internal Server Error",
      consumerKeyId: consumer.consumerId,
      userId: consumer.userId,
    });
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// ── POST /v1/chat/completions ────────────────────────────────────────

consumerOpenAiRelay.post("/v1/chat/completions", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  try {
    return await handleChatCompletions(c, consumer, requestId, start);
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in chat completions handler",
    );
    return respondWithConsumerError(c, consumer, requestId, start, 500, {
      error: "Internal Server Error",
    });
  }
});

async function handleChatCompletions(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
): Promise<Response> {
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);

  // -- 1. Validate request body --
  const parsed = await parseBody(c, aiRelayChatBody);
  if (!parsed.ok)
    return respondWithConsumerError(c, consumer, requestId, start, 400, { error: parsed.error });
  const body = parsed.data;

  // -- 2. Model ACL check --
  if (consumer.allowedModels.length > 0) {
    const allowed = consumer.allowedModels.some((pattern) => {
      if (pattern.endsWith("*")) return body.model.startsWith(pattern.slice(0, -1));
      return body.model === pattern;
    });
    if (!allowed) {
      return respondWithConsumerError(c, consumer, requestId, start, 403, {
        error: `Model "${body.model}" is not allowed for this key`,
      });
    }
  }

  // -- 3. Input guardrails --
  try {
    const configs = await aiGuardrailConfigRepo.findAllEnabled();
    for (const gc of configs) {
      const rules = safeParseGuardrailRules(gc.rules);
      if (!rules) continue;
      const result = checkInputGuardrails(body.messages, {
        rules,
        action: gc.action as GuardrailConfig["action"],
      });
      if (!result.allowed && gc.action === "block") {
        return respondWithConsumerError(c, consumer, requestId, start, 403, {
          error: result.reason ?? "Blocked by guardrails",
        });
      }
    }
  } catch (err) {
    log.gateway.warn({ err }, "Guardrail evaluation failed — proceeding without guardrails");
  }

  // -- 4. Resolve model via routes --
  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(body.model, "openai"),
  );
  if (routes.length === 0) {
    return respondWithConsumerError(c, consumer, requestId, start, 404, {
      error: `Model "${body.model}" not found or disabled`,
    });
  }

  // -- 6. Resolve key across all routes (multi-provider failover) --
  const model = routes[0].model;

  interface ResolvedUpstream {
    keyId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    upstreamName: string;
    upstreamBaseUrl: string;
    providerId: string;
    serializedBody: string;
    adapter: ReturnType<typeof getAdapter>;
  }
  const resolvedUpstreams: ResolvedUpstream[] = [];

  for (const { route, provider, model: routeModel } of routes) {
    const providerModelId = route.providerModelId ?? routeModel.modelId;

    if (body.stream && provider.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
      continue; // skip unsupported streaming routes
    }

    const adapter = getAdapter(provider.apiFormat);
    if (!adapter) continue;

    const candidateBody = {
      ...body,
      model: providerModelId,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAIChatBody;
    const transformedBody = adapter.transformRequest(candidateBody);
    const serializedBody = JSON.stringify(transformedBody);

    for (const upstream of await resolveUpstreamCandidates(provider)) {
      const key = await pickKey(provider.id, upstream.id);
      if (!key) continue;
      try {
        const plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
        const mappedModelId = await resolveModelMapping(upstream.id, providerModelId);
        const needsRemap = mappedModelId !== providerModelId;
        const effectiveBody = needsRemap
          ? JSON.stringify(
              adapter.transformRequest({
                ...body,
                model: mappedModelId,
                ...(body.stream ? { stream_options: { include_usage: true } } : {}),
              } as unknown as OpenAIChatBody),
            )
          : serializedBody;
        const upstreamUrl = adapter.buildUrl(upstream.baseUrl, {
          model: mappedModelId,
          stream: !!body.stream,
        });
        const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
          provider,
          plainKey,
          upstreamUrl,
          effectiveBody,
        );
        resolvedUpstreams.push({
          keyId: key.id,
          authHeaders,
          finalUrl,
          upstreamId: upstream.id,
          upstreamName: upstream.name,
          upstreamBaseUrl: upstream.baseUrl,
          providerId: provider.providerId,
          serializedBody: effectiveBody,
          adapter,
        });
      } catch {
        continue;
      }
    }
  }
  if (resolvedUpstreams.length === 0) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: "No API key configured for any provider route" },
      { modelId: model.modelId },
    );
  }

  // Start with first candidate; fallback to next on retryable failures
  let selected = resolvedUpstreams[0];
  const passthroughHeaders = extractPassthroughHeaders(c);

  // -- 7b. Check if request logging is enabled --
  const logEnabled = await isRequestLoggingEnabled();

  // -- 8. Pre-flight spending limit check (daily/monthly) --
  // Catches agents that have already exceeded their limits before we hit upstream.
  const preflightLimit = await checkConsumerSpendingLimits(consumer);
  if (preflightLimit) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      preflightLimit.statusCode,
      preflightLimit.body,
      { keyId: selected.keyId, providerId: selected.providerId, modelId: model.modelId },
    );
  }

  // -- 9. Upstream fetch with fallback retry --
  // Try each resolved upstream in order; on retryable failure, advance to next.
  let lastError: { status: number; message: string } | null = null;

  for (let uIdx = 0; uIdx < resolvedUpstreams.length && uIdx < MAX_UPSTREAM_ATTEMPTS; uIdx++) {
    selected = resolvedUpstreams[uIdx];

    // Create fresh meta per iteration — shared reference would race with async stream callbacks
    const meta: StreamRelayMeta = {
      keyId: selected.keyId,
      providerId: selected.providerId,
      modelId: model.modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      requestId,
      start,
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
      requestBody: logEnabled ? selected.serializedBody : undefined,
    };

    const cacheKey = !body.stream
      ? buildCacheKey({
          scope: `consumer:${consumer.consumerId}`,
          model: model.modelId,
          providerId: selected.providerId,
          upstreamId: selected.upstreamId,
          upstreamBaseUrl: selected.upstreamBaseUrl,
          requestBody: selected.serializedBody,
        })
      : null;
    if (cacheKey) {
      const cached = getCachedResponse(cacheKey);
      if (cached) return c.json(cached);
    }

    // -- 9a. Streaming path --
    if (body.stream) {
      try {
        const streamingHeaders = { ...selected.authHeaders, ...passthroughHeaders };
        const upstreamFetchMs = resolveUpstreamFetchTimeoutMs(timeouts, {
          providerId: selected.providerId,
          modelId: model.modelId,
        });
        const upstreamRes = await fetchUpstream(
          selected.finalUrl,
          streamingHeaders,
          selected.serializedBody,
          upstreamFetchMs,
          {
            provider: selected.providerId,
            route: "chat",
          },
        );
        if (!upstreamRes.ok) {
          if (RETRYABLE_STATUS.has(upstreamRes.status)) {
            markKeyFailure(selected.keyId);
            const errBody = await upstreamRes.text().catch(() => "");
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            continue; // try next upstream
          }
          // Non-retryable — return immediately
          const errBody = await upstreamRes.text().catch(() => "");
          return respondWithConsumerError(
            c,
            consumer,
            requestId,
            start,
            upstreamRes.status,
            { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
            {
              keyId: selected.keyId,
              providerId: selected.providerId,
              modelId: model.modelId,
              upstreamId: selected.upstreamId,
              upstreamName: selected.upstreamName,
              upstreamBaseUrl: selected.upstreamBaseUrl,
              requestBody: logEnabled ? selected.serializedBody : undefined,
            },
          );
        }

        // Post-stream consumer billing callback
        const billSelected = selected; // capture for closure
        const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
          await billConsumer({
            usage,
            latencyMs,
            consumer,
            keyId: billSelected.keyId,
            providerId: billSelected.providerId,
            modelId: model.modelId,
            upstreamId: billSelected.upstreamId,
            upstreamName: billSelected.upstreamName,
            upstreamBaseUrl: billSelected.upstreamBaseUrl,
            inputPrice: model.inputPrice,
            outputPrice: model.outputPrice,
            requestId,
            statusCode: 200,
            requestBody: logEnabled ? billSelected.serializedBody : undefined,
            responseBody: rawResponse,
          });
        };

        return forwardStream(c, upstreamRes, selected.adapter!, meta, onComplete, timeouts);
      } catch (err) {
        markKeyFailure(selected.keyId);
        lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
        continue; // try next upstream
      }
    }

    // -- 9b. Non-streaming path --
    let upstreamRes: Response;
    try {
      const fetchStart = Date.now();
      upstreamRes = await fetch(selected.finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...selected.authHeaders,
          ...passthroughHeaders,
        },
        body: selected.serializedBody,
        signal: AbortSignal.timeout(timeouts.streamMaxDurationMs),
      });
      gatewayUpstreamDuration.observe(
        { provider: selected.providerId, route: "chat", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );
    } catch (err) {
      markKeyFailure(selected.keyId);
      lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
      continue; // try next upstream
    }

    if (!upstreamRes.ok) {
      if (RETRYABLE_STATUS.has(upstreamRes.status)) {
        markKeyFailure(selected.keyId);
        const errBody = await upstreamRes.text().catch(() => "");
        lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
        continue; // try next upstream
      }
      // Non-retryable — return immediately
      const errBody = await upstreamRes.text().catch(() => "");
      return respondWithConsumerError(
        c,
        consumer,
        requestId,
        start,
        upstreamRes.status,
        { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
        {
          keyId: selected.keyId,
          providerId: selected.providerId,
          modelId: model.modelId,
          upstreamId: selected.upstreamId,
          upstreamName: selected.upstreamName,
          upstreamBaseUrl: selected.upstreamBaseUrl,
          requestBody: logEnabled ? selected.serializedBody : undefined,
        },
      );
    }

    // Success — parse, bill, log, return
    let responseBody: unknown;
    try {
      responseBody = await upstreamRes.json();
    } catch {
      return respondWithConsumerError(
        c,
        consumer,
        requestId,
        start,
        502,
        { error: "Failed to parse upstream response" },
        {
          keyId: selected.keyId,
          providerId: selected.providerId,
          modelId: model.modelId,
          upstreamId: selected.upstreamId,
          upstreamName: selected.upstreamName,
          upstreamBaseUrl: selected.upstreamBaseUrl,
          requestBody: logEnabled ? selected.serializedBody : undefined,
        },
      );
    }

    const transformed = selected.adapter!.transformResponse(responseBody);
    const usage = selected.adapter!.extractUsage(responseBody);
    const latencyMs = Date.now() - start;
    markKeySuccess(selected.keyId);

    // -- 10. Debit consumer + log usage --
    const billing = await billConsumer({
      usage,
      latencyMs,
      consumer,
      keyId: selected.keyId,
      providerId: selected.providerId,
      modelId: model.modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
      requestId,
      statusCode: upstreamRes.status,
      requestBody: logEnabled ? selected.serializedBody : undefined,
      responseBody: logEnabled ? JSON.stringify(responseBody) : undefined,
      rejectOnLimit: true,
    });
    if (!billing.ok) {
      return respondWithConsumerError(
        c,
        consumer,
        requestId,
        start,
        billing.statusCode,
        billing.body,
        {
          keyId: selected.keyId,
          providerId: selected.providerId,
          modelId: model.modelId,
          upstreamId: selected.upstreamId,
          upstreamName: selected.upstreamName,
          upstreamBaseUrl: selected.upstreamBaseUrl,
          requestBody: logEnabled ? selected.serializedBody : undefined,
          estimatedCost: billing.costStr,
          upstreamCost: removeTailingZero(billing.upstreamCost, 6),
        },
      );
    }

    // Cache
    if (cacheKey) {
      setCachedResponse(cacheKey, transformed);
    }

    return c.json(transformed);
  }

  // All upstreams exhausted — return last error
  return respondWithConsumerError(
    c,
    consumer,
    requestId,
    start,
    lastError?.status || 502,
    {
      error: "All upstream candidates failed",
      detail: lastError?.message ?? "Unknown error",
    },
    {
      keyId: selected.keyId,
      providerId: selected.providerId,
      modelId: model.modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      requestBody: logEnabled ? selected.serializedBody : undefined,
    },
  );
}

// ── ALL /v1/* — Format-specific passthrough proxy (must be LAST) ────

consumerOpenAiRelay.all("/v1/*", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  try {
    return await handlePassthrough(c, consumer, requestId, start, "openai");
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in passthrough handler",
    );
    return respondWithConsumerError(c, consumer, requestId, start, 500, {
      error: "Internal Server Error",
    });
  }
});

consumerAnthropicRelay.all("/v1/*", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  try {
    return await handlePassthrough(c, consumer, requestId, start, "anthropic");
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in anthropic passthrough handler",
    );
    return respondWithConsumerError(c, consumer, requestId, start, 500, {
      error: "Internal Server Error",
    });
  }
});

async function handlePassthrough(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  clientFormat: ClientFormat,
): Promise<Response> {
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);
  const subPath = c.req.path.replace(/^.*\/v1\//, "");

  let body: Record<string, unknown> = {};
  if (c.req.method === "POST" || c.req.method === "PUT" || c.req.method === "PATCH") {
    try {
      const raw: unknown = await c.req.json();
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return respondWithConsumerError(c, consumer, requestId, start, 400, {
          error: "Request body must be a JSON object",
        });
      }
      body = raw as Record<string, unknown>;
    } catch {
      return respondWithConsumerError(c, consumer, requestId, start, 400, {
        error: "Invalid JSON body",
      });
    }
  }

  const modelId = body.model as string | undefined;
  if (!modelId) {
    return respondWithConsumerError(c, consumer, requestId, start, 400, {
      error: "Request body must contain a 'model' field",
    });
  }

  // Model ACL
  if (consumer.allowedModels.length > 0) {
    const allowed = consumer.allowedModels.some((pattern) =>
      pattern.endsWith("*") ? modelId.startsWith(pattern.slice(0, -1)) : modelId === pattern,
    );
    if (!allowed) {
      return respondWithConsumerError(c, consumer, requestId, start, 403, {
        error: `Model "${modelId}" is not allowed for this key`,
      });
    }
  }

  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(modelId, clientFormat),
  );
  if (routes.length === 0) {
    return respondWithConsumerError(c, consumer, requestId, start, 404, {
      error: `Model "${modelId}" not found or disabled`,
    });
  }

  const model = routes[0].model;
  const serializedBody = JSON.stringify(body);

  // Resolve all upstream candidates for fallback retry
  interface ResolvedPtUpstream {
    keyId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    upstreamName: string;
    upstreamBaseUrl: string;
    providerId: string;
    serializedBody: string;
  }
  const resolvedPtUpstreams: ResolvedPtUpstream[] = [];

  for (const { route, provider, model: routeModel } of routes) {
    if (!isNativePassthroughProvider(clientFormat, provider.apiFormat)) continue;
    if (body.stream === true && provider.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
      continue;
    }

    const providerModelId = route.providerModelId ?? routeModel.modelId;

    for (const upstream of await resolveUpstreamCandidates(provider)) {
      const key = await pickKey(provider.id, upstream.id);
      if (!key) continue;
      try {
        const plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
        const mappedModelId = await resolveModelMapping(upstream.id, providerModelId);
        const effectiveBody =
          mappedModelId === modelId && providerModelId === modelId
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
        resolvedPtUpstreams.push({
          keyId: key.id,
          authHeaders,
          finalUrl,
          upstreamId: upstream.id,
          upstreamName: upstream.name,
          upstreamBaseUrl: upstream.baseUrl,
          providerId: provider.providerId,
          serializedBody: effectiveBody,
        });
      } catch {
        continue;
      }
    }
  }
  if (resolvedPtUpstreams.length === 0) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: "No compatible provider key configured for this model" },
      { modelId },
    );
  }

  const ptPreflightLimit = await checkConsumerSpendingLimits(consumer);
  if (ptPreflightLimit) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      ptPreflightLimit.statusCode,
      ptPreflightLimit.body,
      { modelId },
    );
  }

  // Forward provider-specific headers from the client (e.g. anthropic-version, anthropic-beta)
  // Client headers take precedence over buildProviderAuth defaults
  const passthroughHeaders = extractPassthroughHeaders(c);

  const ptLogEnabled = await isRequestLoggingEnabled();
  const isStreaming = body.stream === true;

  let ptSelected = resolvedPtUpstreams[0];
  let ptLastError: { status: number; message: string } | null = null;

  for (let pIdx = 0; pIdx < resolvedPtUpstreams.length && pIdx < MAX_UPSTREAM_ATTEMPTS; pIdx++) {
    ptSelected = resolvedPtUpstreams[pIdx];

    const meta: StreamRelayMeta = {
      keyId: ptSelected.keyId,
      providerId: ptSelected.providerId,
      modelId,
      upstreamId: ptSelected.upstreamId,
      upstreamName: ptSelected.upstreamName,
      upstreamBaseUrl: ptSelected.upstreamBaseUrl,
      requestId,
      start,
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
      requestBody: ptLogEnabled ? ptSelected.serializedBody : undefined,
    };

    try {
      const fetchStart = Date.now();
      const upstreamRes = await fetch(ptSelected.finalUrl, {
        method: c.req.method,
        headers: {
          "Content-Type": "application/json",
          ...ptSelected.authHeaders,
          ...passthroughHeaders,
        },
        body: c.req.method !== "GET" ? ptSelected.serializedBody : undefined,
        signal: AbortSignal.timeout(
          isStreaming
            ? resolveUpstreamFetchTimeoutMs(timeouts, {
                providerId: ptSelected.providerId,
                modelId,
              })
            : timeouts.streamMaxDurationMs,
        ),
      });
      gatewayUpstreamDuration.observe(
        { provider: ptSelected.providerId, route: "passthrough", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );

      // ── Streaming passthrough — parse SSE frames for usage + billing ──
      if (isStreaming && upstreamRes.ok && upstreamRes.body) {
        const billPt = ptSelected; // capture for closure
        const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
          await billConsumer({
            usage,
            latencyMs,
            consumer,
            keyId: billPt.keyId,
            providerId: billPt.providerId,
            modelId,
            upstreamId: billPt.upstreamId,
            upstreamName: billPt.upstreamName,
            upstreamBaseUrl: billPt.upstreamBaseUrl,
            inputPrice: model.inputPrice,
            outputPrice: model.outputPrice,
            requestId,
            statusCode: 200,
            requestBody: ptLogEnabled ? billPt.serializedBody : undefined,
            responseBody: rawResponse,
          });
        };

        return forwardPassthroughStream(c, upstreamRes, meta, onComplete, timeouts);
      }

      // Retryable error — try next upstream
      if (!upstreamRes.ok && RETRYABLE_STATUS.has(upstreamRes.status)) {
        markKeyFailure(ptSelected.keyId);
        const errBody = await upstreamRes.text().catch(() => "");
        ptLastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
        continue;
      }

      // ── Non-streaming passthrough — read JSON for usage + billing ──
      const latencyMs = Date.now() - start;
      const isJson = (upstreamRes.headers.get("content-type") ?? "").includes("application/json");
      let responseText: string | null = null;
      let usage: TokenUsage | null = null;

      if (isJson) {
        responseText = await upstreamRes.text();
        usage = extractPassthroughUsage(responseText);
      }

      if (upstreamRes.ok) {
        markKeySuccess(ptSelected.keyId);
      } else {
        markKeyFailure(ptSelected.keyId);
      }

      const billing = await billConsumer({
        usage,
        latencyMs,
        consumer,
        keyId: ptSelected.keyId,
        providerId: ptSelected.providerId,
        modelId,
        upstreamId: ptSelected.upstreamId,
        upstreamName: ptSelected.upstreamName,
        upstreamBaseUrl: ptSelected.upstreamBaseUrl,
        inputPrice: model.inputPrice,
        outputPrice: model.outputPrice,
        requestId,
        statusCode: upstreamRes.status,
        error:
          !upstreamRes.ok && responseText
            ? buildAccessLogErrorMessage(`Upstream returned ${upstreamRes.status}`, responseText)
            : !upstreamRes.ok
              ? `Upstream returned ${upstreamRes.status}`
              : undefined,
        requestBody: ptLogEnabled ? ptSelected.serializedBody : undefined,
        responseBody: ptLogEnabled ? (responseText ?? "") : undefined,
        rejectOnLimit: !isStreaming,
      });
      if (!billing.ok) {
        return respondWithConsumerError(
          c,
          consumer,
          requestId,
          start,
          billing.statusCode,
          billing.body,
          {
            keyId: ptSelected.keyId,
            providerId: ptSelected.providerId,
            modelId,
            upstreamId: ptSelected.upstreamId,
            upstreamName: ptSelected.upstreamName,
            upstreamBaseUrl: ptSelected.upstreamBaseUrl,
            requestBody: ptLogEnabled ? ptSelected.serializedBody : undefined,
            responseBody: ptLogEnabled ? (responseText ?? "") : undefined,
            estimatedCost: billing.costStr,
            upstreamCost: removeTailingZero(billing.upstreamCost, 6),
          },
        );
      }

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
      markKeyFailure(ptSelected.keyId);
      ptLastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
      continue;
    }
  }

  // All upstreams exhausted
  return respondWithConsumerError(
    c,
    consumer,
    requestId,
    start,
    ptLastError?.status || 502,
    { error: "All upstream candidates failed", detail: ptLastError?.message ?? "Unknown error" },
    {
      keyId: ptSelected.keyId,
      providerId: ptSelected.providerId,
      modelId,
      upstreamId: ptSelected.upstreamId,
      upstreamName: ptSelected.upstreamName,
      upstreamBaseUrl: ptSelected.upstreamBaseUrl,
      requestBody: ptLogEnabled ? ptSelected.serializedBody : undefined,
    },
  );
}

export {
  consumerAnthropicRelay as consumerAnthropicRelayRouter,
  consumerOpenAiRelay as consumerOpenAiRelayRouter,
};
