/**
 * AI Relay route — proxies OpenAI-compatible chat completion requests to upstream endpoints.
 *
 * Mounted at /api/admin/ai/relay (adminAuthMiddleware applied via parent).
 * Supports: non-streaming + SSE streaming, model fallback chain, cost tracking.
 */
import { type Context, Hono } from "hono";

import type { AiEndpoint, AiModel } from "@/server/db";
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
import {
  markCredentialFailure,
  markCredentialSuccess,
  pickEndpointCredential,
} from "../lib/credential-balancer";
import { buildEndpointAuth } from "../lib/endpoint-auth";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { resolveModelMapping } from "../lib/model-mapping-cache";
import { orderRoutesByPriorityAndWeight } from "../lib/model-routing";
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
import {
  acquireUpstreamSlot,
  releaseUpstreamSlot,
  toConcurrencyLastError,
  type UpstreamConcurrencyLease,
} from "../lib/upstream-concurrency";
import { MAX_UPSTREAM_ATTEMPTS, resolveUpstreamCandidates } from "../lib/upstream-routing";
import { BEDROCK_STREAMING_SUPPORTED } from "../protocol-adapters/bedrock";
import { getAdapter } from "../protocol-adapters/registry";
import type { OpenAIChatBody, ProtocolAdapter } from "../protocol-adapters/types";

const AI_CREDENTIAL_DOMAIN_TAG = "ai-merchant-key";

const relay = new Hono();

interface RelayErrorExtras {
  endpointCredentialId?: number | null;
  endpointId?: string | null;
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
    endpointCredentialId: extras?.endpointCredentialId ?? null,
    endpointId: extras?.endpointId ?? null,
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
    owned_by: r.endpoint.endpointId,
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
    if (isUnsupportedStreamingCandidate(body.stream, candidate.endpoint.apiFormat)) {
      log.gateway.info(
        { endpoint: candidate.endpoint.endpointId, model: candidate.model.modelId, requestId },
        "Skipping unsupported Bedrock streaming fallback candidate",
      );
      continue;
    }

    // Pre-compute transformed body for this candidate (needed for SigV4 signing)
    // Inject stream_options at route level so OpenAI-compatible upstreams return usage in SSE chunks.
    const candidateBody = {
      ...body,
      model: candidate.endpointModelId,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAIChatBody;
    // Get adapter early to transform body before auth
    const adapter = getAdapter(candidate.endpoint.apiFormat);
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
        endpointCredentialId: keyMeta.endpointCredentialId,
        endpointId: candidate.endpoint.endpointId,
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
          endpointId: candidate.endpoint.endpointId,
          upstreamId: keyMeta.upstreamId,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          requestBody: attemptBody,
        });
        const cached = getCachedResponse(cacheKey);
        if (cached) {
          return c.json(cached);
        }
      }

      let concurrencyLease: UpstreamConcurrencyLease | null;
      try {
        concurrencyLease = await acquireUpstreamSlot({
          upstreamId: keyMeta.upstreamId,
          concurrencyScopeKey: keyMeta.concurrencyScopeKey,
          concurrencyLimit: keyMeta.concurrencyLimit,
          queueTimeoutMs: keyMeta.queueTimeoutMs,
          requestId,
          endpointId: candidate.endpoint.endpointId,
          modelId: candidate.model.modelId,
        });
      } catch (err) {
        lastError = toConcurrencyLastError(err);
        lastResourceDownAlert = null;
        continue;
      }

      if (body.stream) {
        let releaseInFinally = true;
        try {
          const upstreamFetchMs = resolveUpstreamFetchTimeoutMs(timeouts, {
            endpointId: candidate.endpoint.endpointId,
            modelId: candidate.model.modelId,
          });
          const upstreamRes = await fetchUpstream(
            finalUrl,
            { ...authHeaders, ...passthroughHeaders },
            attemptBody,
            upstreamFetchMs,
            { endpoint: candidate.endpoint.endpointId, route: "chat" },
          );
          if (upstreamRes.ok) {
            const streamConcurrencyLease = concurrencyLease;
            releaseInFinally = false;
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
              undefined,
              undefined,
              () => releaseUpstreamSlot(streamConcurrencyLease),
            );
          }
          if (RETRYABLE_STATUS.has(upstreamRes.status)) {
            markCredentialFailure(keyMeta.endpointCredentialId);
            const errBody = await upstreamRes.text().catch(() => "");
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            lastResourceDownAlert = {
              route: "admin-chat",
              requestId,
              endpointId: candidate.endpoint.endpointId,
              endpointName: candidate.endpoint.name,
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
              endpointCredentialId: keyMeta.endpointCredentialId,
              endpointId: candidate.endpoint.endpointId,
              modelId: candidate.model.modelId,
              upstreamId: keyMeta.upstreamId,
              upstreamName: keyMeta.upstreamName,
              upstreamBaseUrl: keyMeta.upstreamBaseUrl,
              requestBody: logEnabled ? attemptBody : undefined,
            },
          );
        } catch (err) {
          markCredentialFailure(keyMeta.endpointCredentialId);
          lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
          lastResourceDownAlert = {
            route: "admin-chat",
            requestId,
            endpointId: candidate.endpoint.endpointId,
            endpointName: candidate.endpoint.name,
            modelId: candidate.model.modelId,
            upstreamId: keyMeta.upstreamId,
            upstreamName: keyMeta.upstreamName,
            upstreamBaseUrl: keyMeta.upstreamBaseUrl,
            status: lastError.status,
            detail: lastError.message,
          };
          continue;
        } finally {
          if (releaseInFinally) await releaseUpstreamSlot(concurrencyLease);
        }
      }

      try {
        let upstreamRes: Response;
        try {
          const fetchStart = Date.now();
          upstreamRes = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
            body: attemptBody,
            signal: AbortSignal.timeout(timeouts.streamMaxDurationMs),
          });
          gatewayUpstreamDuration.observe(
            { endpoint: candidate.endpoint.endpointId, route: "chat", phase: "response" },
            (Date.now() - fetchStart) / 1000,
          );
        } catch (err) {
          markCredentialFailure(keyMeta.endpointCredentialId);
          lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
          lastResourceDownAlert = {
            route: "admin-chat",
            requestId,
            endpointId: candidate.endpoint.endpointId,
            endpointName: candidate.endpoint.name,
            modelId: candidate.model.modelId,
            upstreamId: keyMeta.upstreamId,
            upstreamName: keyMeta.upstreamName,
            upstreamBaseUrl: keyMeta.upstreamBaseUrl,
            status: lastError.status,
            detail: lastError.message,
          };
          continue;
        }

        if (!upstreamRes.ok) {
          const errBody = await upstreamRes.text().catch(() => "");
          if (RETRYABLE_STATUS.has(upstreamRes.status)) {
            markCredentialFailure(keyMeta.endpointCredentialId);
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            lastResourceDownAlert = {
              route: "admin-chat",
              requestId,
              endpointId: candidate.endpoint.endpointId,
              endpointName: candidate.endpoint.name,
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
              endpointCredentialId: keyMeta.endpointCredentialId,
              endpointId: candidate.endpoint.endpointId,
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
              endpointCredentialId: keyMeta.endpointCredentialId,
              endpointId: candidate.endpoint.endpointId,
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
        markCredentialSuccess(keyMeta.endpointCredentialId);

        const cost = calculateCost(usage, candidate.model);
        enqueueJob("ai-usage-log", {
          endpointCredentialId: keyMeta.endpointCredentialId,
          endpointId: candidate.endpoint.endpointId,
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

        enqueueJob("ai-endpoint-credential-touch", {
          endpointCredentialId: keyMeta.endpointCredentialId,
        });

        const cacheKey = buildCacheKey({
          scope: "admin",
          model: candidate.model.modelId,
          endpointId: candidate.endpoint.endpointId,
          upstreamId: keyMeta.upstreamId,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          requestBody: attemptBody,
        });
        setCachedResponse(cacheKey, transformed);

        return c.json(transformed);
      } catch (err) {
        markCredentialFailure(keyMeta.endpointCredentialId);
        lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
        lastResourceDownAlert = {
          route: "admin-chat",
          requestId,
          endpointId: candidate.endpoint.endpointId,
          endpointName: candidate.endpoint.name,
          modelId: candidate.model.modelId,
          upstreamId: keyMeta.upstreamId,
          upstreamName: keyMeta.upstreamName,
          upstreamBaseUrl: keyMeta.upstreamBaseUrl,
          status: lastError.status,
          detail: lastError.message,
        };
        continue;
      } finally {
        await releaseUpstreamSlot(concurrencyLease);
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
    lastError?.status || 502,
    { error: "All models failed", detail: lastError?.message ?? "No suitable key found" },
    {
      endpointId: candidates[0]?.endpoint.endpointId ?? null,
      modelId: candidates[0]?.model.modelId ?? body.model,
    },
  );
});

// ── ALL /v1/* — Generic passthrough proxy (must be LAST) ────────────
//
// Catch-all for any /v1/* endpoint not matched above (e.g. /v1/messages,
// /v1/embeddings). Forwards request as-is to the upstream endpoint.
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

  const { endpoint } = result;

  if (body.stream === true && endpoint.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
    return respondWithRelayError(
      c,
      requestId,
      start,
      400,
      { error: "Bedrock streaming is not supported yet" },
      { endpointId: endpoint.endpointId, modelId },
    );
  }

  interface ResolvedPassthroughAttempt {
    endpointCredentialId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    concurrencyScopeKey: string;
    upstreamName: string;
    upstreamBaseUrl: string;
    serializedBody: string;
    concurrencyLimit: number | null;
    queueTimeoutMs: number;
  }

  const resolvedAttempts: ResolvedPassthroughAttempt[] = [];
  const serializedBody = JSON.stringify(body);

  for (const upstream of await resolveUpstreamCandidates(endpoint)) {
    const credential = await pickEndpointCredential(endpoint.id, upstream.id);
    if (!credential) continue;

    try {
      const plainKey = decrypt(credential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
      const mappedModelId = await resolveModelMapping(upstream.id, modelId);
      const effectiveBody =
        mappedModelId === modelId
          ? serializedBody
          : JSON.stringify({ ...body, model: mappedModelId });
      const base = upstream.baseUrl.replace(/\/+$/, "");
      const upstreamUrl = base.endsWith("/v1") ? `${base}/${subPath}` : `${base}/v1/${subPath}`;
      const { headers: authHeaders, url: finalUrl } = buildEndpointAuth(
        endpoint,
        plainKey,
        upstreamUrl,
        effectiveBody,
      );
      resolvedAttempts.push({
        endpointCredentialId: credential.id,
        authHeaders,
        finalUrl,
        upstreamId: upstream.id,
        concurrencyScopeKey: upstream.concurrencyScopeKey,
        upstreamName: upstream.name,
        upstreamBaseUrl: upstream.baseUrl,
        serializedBody: effectiveBody,
        concurrencyLimit: upstream.concurrencyLimit,
        queueTimeoutMs: upstream.queueTimeoutMs,
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
      { error: "No endpoint credential configured for this endpoint" },
      { endpointId: endpoint.endpointId, modelId },
    );
  }

  const passthroughHeaders = extractPassthroughHeaders(c);
  const isStreaming = body.stream === true;
  let lastError: { status: number; message: string } | null = null;
  let selected = resolvedAttempts[0];

  for (let idx = 0; idx < resolvedAttempts.length && idx < MAX_UPSTREAM_ATTEMPTS; idx++) {
    selected = resolvedAttempts[idx];

    const meta: StreamRelayMeta = {
      endpointCredentialId: selected.endpointCredentialId,
      endpointId: endpoint.endpointId,
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

    let concurrencyLease: UpstreamConcurrencyLease | null;
    let releaseInFinally = true;
    try {
      concurrencyLease = await acquireUpstreamSlot({
        upstreamId: selected.upstreamId,
        concurrencyScopeKey: selected.concurrencyScopeKey,
        concurrencyLimit: selected.concurrencyLimit,
        queueTimeoutMs: selected.queueTimeoutMs,
        requestId,
        endpointId: endpoint.endpointId,
        modelId,
      });
    } catch (err) {
      lastError = toConcurrencyLastError(err);
      continue;
    }

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
                endpointId: endpoint.endpointId,
                modelId,
              })
            : timeouts.streamMaxDurationMs,
        ),
      });
      gatewayUpstreamDuration.observe(
        { endpoint: endpoint.endpointId, route: "passthrough", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );

      if (isStreaming && upstreamRes.ok && upstreamRes.body) {
        const streamConcurrencyLease = concurrencyLease;
        releaseInFinally = false;
        return forwardPassthroughStream(c, upstreamRes, meta, undefined, timeouts, undefined, () =>
          releaseUpstreamSlot(streamConcurrencyLease),
        );
      }

      if (!upstreamRes.ok && RETRYABLE_STATUS.has(upstreamRes.status)) {
        markCredentialFailure(selected.endpointCredentialId);
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
        markCredentialSuccess(selected.endpointCredentialId);
      } else if (upstreamRes.status === 429 || upstreamRes.status >= 500) {
        markCredentialFailure(selected.endpointCredentialId);
      }

      enqueueJob("ai-usage-log", {
        endpointCredentialId: selected.endpointCredentialId,
        endpointId: endpoint.endpointId,
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
      enqueueJob("ai-endpoint-credential-touch", {
        endpointCredentialId: selected.endpointCredentialId,
      });

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
      if (!releaseInFinally) {
        await releaseUpstreamSlot(concurrencyLease).catch(() => {});
      }
      markCredentialFailure(selected.endpointCredentialId);
      lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
    } finally {
      if (releaseInFinally) await releaseUpstreamSlot(concurrencyLease);
    }
  }

  if (lastError) {
    notifyResourceDown({
      route: "admin-passthrough",
      requestId,
      endpointId: endpoint.endpointId,
      endpointName: endpoint.name,
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
      endpointCredentialId: selected.endpointCredentialId,
      endpointId: endpoint.endpointId,
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
  endpoint: AiEndpoint;
  /** Actual model slug sent to the upstream endpoint (may differ from model.modelId). */
  endpointModelId: string;
}

interface KeyMeta {
  endpointCredentialId: number;
  upstreamId: number | null;
  concurrencyScopeKey: string;
  upstreamName: string;
  upstreamBaseUrl: string;
  concurrencyLimit: number | null;
  queueTimeoutMs: number;
}

interface ResolvedCandidate {
  adapter: ProtocolAdapter;
  finalUrl: string;
  authHeaders: Record<string, string>;
  keyMeta: KeyMeta;
  serializedBody: string;
  effectiveModelId: string;
}

/**
 * Build candidate list via model routes: each route maps a model to an endpoint.
 * Routes are sorted by priority ASC (from repo). After route-level candidates,
 * cross-model fallbacks (fallbackModelIds) are appended — each resolved through
 * their own routes.
 */
async function buildCandidateChain(modelId: string): Promise<Candidate[]> {
  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(modelId),
  );
  if (routes.length === 0) return [];

  // Append cross-model fallbacks (orthogonal to route-level failover)
  const primaryModel = routes[0].model;
  const primaryCandidates =
    (primaryModel.weight ?? 1) > 0
      ? routes.map((r) => ({
          model: r.model,
          endpoint: r.endpoint,
          endpointModelId: r.route.endpointModelId ?? r.model.modelId,
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
        await aiModelRouteRepo.findEnabledRoutesByModelId(fbModelId),
      );
      if (fbRoutes.length === 0) continue;

      const fallbackModel = fbRoutes[0].model;
      if ((fallbackModel.weight ?? 1) <= 0) continue;

      fallbackGroups.push({
        model: fallbackModel,
        candidates: fbRoutes.map((fbr) => ({
          model: fbr.model,
          endpoint: fbr.endpoint,
          endpointModelId: fbr.route.endpointModelId ?? fbr.model.modelId,
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
  adapter: ProtocolAdapter,
  stream: boolean,
  defaultSerializedBody: string,
  candidateBody: OpenAIChatBody,
): Promise<ResolvedCandidate[]> {
  const { endpoint } = candidate;
  const upstreams = await resolveUpstreamCandidates(endpoint);
  const resolved: ResolvedCandidate[] = [];

  for (const upstream of upstreams) {
    const credential = await pickEndpointCredential(endpoint.id, upstream.id);
    if (!credential) continue;

    let plainKey: string;
    try {
      plainKey = decrypt(credential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
    } catch (err) {
      log.gateway.error(
        { err, endpointCredentialId: credential.id },
        "Failed to decrypt AI credential",
      );
      continue;
    }

    const mappedModelId = await resolveModelMapping(upstream.id, candidate.endpointModelId);
    const needsRemap = mappedModelId !== candidate.endpointModelId;

    const effectiveBody = needsRemap
      ? JSON.stringify(adapter.transformRequest({ ...candidateBody, model: mappedModelId }))
      : defaultSerializedBody;

    const upstreamUrl = adapter.buildUrl(upstream.baseUrl, { model: mappedModelId, stream });
    const { headers: authHeaders, url: finalUrl } = buildEndpointAuth(
      endpoint,
      plainKey,
      upstreamUrl,
      effectiveBody,
    );

    resolved.push({
      adapter,
      finalUrl,
      authHeaders,
      keyMeta: {
        endpointCredentialId: credential.id,
        upstreamId: upstream.id,
        concurrencyScopeKey: upstream.concurrencyScopeKey,
        upstreamName: upstream.name,
        upstreamBaseUrl: upstream.baseUrl,
        concurrencyLimit: upstream.concurrencyLimit,
        queueTimeoutMs: upstream.queueTimeoutMs,
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
