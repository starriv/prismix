/**
 * Consumer AI Relay route — same pipeline as relay.ts but authenticated via ska_ consumer keys.
 *
 * Adds: balance gate, model ACL, post-request billing (debit + transaction record).
 * Mounted at /api/gateway/ai/openai and /api/gateway/ai/anthropic
 * (consumerKeyAuthMiddleware applied via parent).
 */
import { type Context, Hono } from "hono";

import {
  type AnnouncementNoticePayload,
  buildCliNoticeStreamEvents,
  buildCliVisibleAnnouncementErrorPayload,
  canInjectCliTextNoticeIntoBody,
  findCliAnnouncementForConsumer,
  findModelErrorAnnouncement,
  formatCliAnnouncementText,
  injectCliNoticeIntoChatResponse,
  injectCliNoticeIntoClientResponse,
  markAnnouncementDelivered,
  type ModelErrorReason,
} from "@/server/lib/announcement-delivery-service";
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
import { lte, removeTailingZero } from "@/shared/number";

import {
  anthropicClientProtocolAdapter,
  estimateAnthropicInputTokens,
} from "../client-protocols/anthropic";
import { buildAccessLogErrorMessage, enqueueAiAccessLog } from "../lib/access-log";
import { billConsumer, checkConsumerSpendingLimits } from "../lib/billing";
import {
  canServeClientFormat,
  type ClientFormat,
  isNativePassthroughEndpoint,
} from "../lib/client-format";
import {
  markCredentialFailure,
  markCredentialSuccess,
  pickEndpointCredential,
} from "../lib/credential-balancer";
import { buildEndpointAuth } from "../lib/endpoint-auth";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import {
  canConsumerAccessModel,
  filterModelsForConsumer,
  isModelAllowedByConsumerKey,
} from "../lib/model-access";
import { resolveModelMapping } from "../lib/model-mapping-cache";
import { orderRoutesByPriorityAndWeight } from "../lib/model-routing";
import { extractPassthroughHeaders, isRequestLoggingEnabled } from "../lib/request-helpers";
import { notifyResourceDown } from "../lib/runtime-alerts";
import { safeParseGuardrailRules } from "../lib/safe-json";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "../lib/semantic-cache";
import {
  extractPassthroughUsage,
  fetchUpstream,
  forwardPassthroughStream,
  forwardStream,
  RETRYABLE_STATUS,
  type StreamCompleteCallback,
  type StreamOutputTransformer,
  type StreamRelayMeta,
} from "../lib/stream-proxy";
import {
  acquireUpstreamSlot,
  releaseUpstreamSlot,
  toConcurrencyLastError,
  type UpstreamConcurrencyLease,
} from "../lib/upstream-concurrency";
import { MAX_UPSTREAM_ATTEMPTS, resolveUpstreamCandidates } from "../lib/upstream-routing";
import { type ConsumerSession, getConsumerSession } from "../middleware/consumer-key-auth";
import { BEDROCK_STREAMING_SUPPORTED } from "../protocol-adapters/bedrock";
import { getAdapter } from "../protocol-adapters/registry";
import type { OpenAIChatBody, OpenAIChatResponse, TokenUsage } from "../protocol-adapters/types";

const AI_CREDENTIAL_DOMAIN_TAG = "ai-merchant-key";

const consumerOpenAiRelay = new Hono();
const consumerAnthropicRelay = new Hono();

interface ConsumerErrorExtras {
  endpointCredentialId?: number | null;
  endpointId?: string | null;
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
    endpointCredentialId: extras?.endpointCredentialId ?? null,
    consumerKeyId: consumer.consumerId,
    userId: consumer.userId,
    endpointId: extras?.endpointId ?? null,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUpstreamErrorPayload(
  statusCode: number,
  responseText: string,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall back to the gateway-shaped payload below.
  }
  return {
    error: `Upstream returned ${statusCode}`,
    detail: responseText.slice(0, 2000),
  };
}

function shouldInjectModelErrorNoticeFromUpstream(
  statusCode: number,
  responseText: string,
): boolean {
  if (statusCode === 403 || statusCode === 404 || statusCode === 410) return true;
  if (statusCode !== 400) return false;
  return /model|not[_ -]?found|not available|does not exist|no access|not supported|disabled/i.test(
    responseText,
  );
}

async function respondWithModelAnnouncementError(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  statusCode: number,
  payload: Record<string, unknown>,
  modelId: string,
  reason: ModelErrorReason,
  extras?: ConsumerErrorExtras,
): Promise<Response> {
  let notice = null;
  try {
    notice = await findModelErrorAnnouncement(modelId, reason);
  } catch (err) {
    log.gateway.warn(
      { err, requestId, consumerId: consumer.consumerId, modelId, reason },
      "Failed to resolve model-error announcement",
    );
  }
  return respondWithConsumerError(
    c,
    consumer,
    requestId,
    start,
    statusCode,
    buildCliVisibleAnnouncementErrorPayload(payload, notice),
    extras,
  );
}

async function respondWithUpstreamModelAnnouncementError(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  statusCode: number,
  responseText: string,
  modelId: string,
  reason: ModelErrorReason,
  extras?: ConsumerErrorExtras,
): Promise<Response> {
  let notice = null;
  try {
    notice = await findModelErrorAnnouncement(modelId, reason);
  } catch (err) {
    log.gateway.warn(
      { err, requestId, consumerId: consumer.consumerId, modelId, reason },
      "Failed to resolve upstream model-error announcement",
    );
  }

  const payload = buildCliVisibleAnnouncementErrorPayload(
    parseUpstreamErrorPayload(statusCode, responseText),
    notice,
  );
  return respondWithConsumerError(c, consumer, requestId, start, statusCode, payload, {
    ...extras,
    responseBody: extras?.responseBody ?? responseText,
  });
}

async function respondWithUpstreamExhaustedAnnouncementError(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  lastError: { status: number; message: string } | null,
  modelId: string,
  extras?: ConsumerErrorExtras,
): Promise<Response> {
  return respondWithModelAnnouncementError(
    c,
    consumer,
    requestId,
    start,
    lastError?.status || 502,
    {
      error: "All upstream candidates failed",
      detail: lastError?.message ?? "Unknown error",
    },
    modelId,
    "upstream_failed",
    extras,
  );
}

async function findCliAnnouncementNotice(
  consumer: ConsumerSession,
  requestId: string,
  body: Record<string, unknown>,
): Promise<AnnouncementNoticePayload | null> {
  if (!canInjectCliTextNoticeIntoBody(body)) return null;
  try {
    return await findCliAnnouncementForConsumer(consumer.consumerId);
  } catch (err) {
    log.gateway.warn(
      { err, requestId, consumerId: consumer.consumerId, modelId: body.model },
      "Failed to resolve CLI announcement",
    );
    return null;
  }
}

async function markCliAnnouncementDelivered(
  notice: AnnouncementNoticePayload | null,
  consumer: ConsumerSession,
): Promise<void> {
  if (!notice) return;
  await markAnnouncementDelivered(notice, consumer.consumerId);
}

async function listConsumerModels(consumer: ConsumerSession, clientFormat: ClientFormat) {
  const rows = await aiModelRepo.findAllEnabled(clientFormat);
  return filterModelsForConsumer(rows, consumer);
}

// ── GET /v1/models — OpenAI-compatible model catalog ────────────────

async function handleOpenAiModelsRoute(c: Context): Promise<Response> {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);

  try {
    const filtered = await listConsumerModels(consumer, "openai");
    const data = filtered.map((r) => ({
      id: r.model.modelId,
      object: "model" as const,
      created: Math.floor(new Date(r.model.createdAt).getTime() / 1000),
      owned_by: r.endpoint.endpointId,
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
}

consumerOpenAiRelay.get("/v1/models", handleOpenAiModelsRoute);

// ── GET /v1/models — Anthropic-compatible model catalog ─────────────

async function handleAnthropicModelsRoute(c: Context): Promise<Response> {
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
}

consumerAnthropicRelay.get("/v1/models", handleAnthropicModelsRoute);

// ── POST /v1/chat/completions ────────────────────────────────────────

async function handleOpenAiChatCompletionsRoute(c: Context): Promise<Response> {
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
}

consumerOpenAiRelay.post("/v1/chat/completions", handleOpenAiChatCompletionsRoute);

// ── POST /v1/messages — Anthropic client protocol via canonical chat ──

consumerAnthropicRelay.post("/v1/messages", handleAnthropicMessagesRoute);
consumerAnthropicRelay.post("/v1/messages/", handleAnthropicMessagesRoute);
consumerAnthropicRelay.post("/v1/messages/count_tokens", handleAnthropicCountTokensRoute);
consumerAnthropicRelay.post("/v1/messages/count_tokens/", handleAnthropicCountTokensRoute);

async function handleAnthropicMessagesRoute(c: Context): Promise<Response> {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  try {
    return await handleAnthropicMessages(c, consumer, requestId, start);
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in anthropic messages handler",
    );
    return respondWithConsumerError(c, consumer, requestId, start, 500, {
      error: "Internal Server Error",
    });
  }
}

async function handleAnthropicCountTokensRoute(c: Context): Promise<Response> {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  try {
    return await handleAnthropicCountTokens(c, consumer, requestId, start);
  } catch (err) {
    log.gateway.error(
      { err, requestId, consumerId: consumer.consumerId, userId: consumer.userId },
      "Unhandled error in anthropic count tokens handler",
    );
    return respondWithConsumerError(c, consumer, requestId, start, 500, {
      error: "Internal Server Error",
    });
  }
}

async function handleChatCompletions(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
): Promise<Response> {
  const parsed = await parseBody(c, aiRelayChatBody);
  if (!parsed.ok)
    return respondWithConsumerError(c, consumer, requestId, start, 400, { error: parsed.error });

  return handleCanonicalChatCompletions(c, consumer, requestId, start, {
    body: parsed.data,
    clientFormat: "openai",
    cacheScope: `consumer:${consumer.consumerId}:openai`,
    passthroughHeaders: extractPassthroughHeaders(c),
  });
}

async function handleAnthropicMessages(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return respondWithConsumerError(c, consumer, requestId, start, 400, {
      error: "Invalid JSON body",
    });
  }

  const converted = anthropicClientProtocolAdapter.transformRequest(raw);
  if (!converted.ok) {
    return respondWithConsumerError(c, consumer, requestId, start, converted.statusCode, {
      error: converted.error,
    });
  }

  return handleCanonicalChatCompletions(c, consumer, requestId, start, {
    body: converted.body,
    clientFormat: "anthropic",
    cacheScope: `consumer:${consumer.consumerId}:anthropic`,
    responseTransformer: (body, publicModel) =>
      anthropicClientProtocolAdapter.transformResponse({ ...body, model: publicModel }),
    createStreamOutputTransformer: (model) =>
      anthropicClientProtocolAdapter.createStreamTransformer(model),
  });
}

async function handleAnthropicCountTokens(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return respondWithConsumerError(c, consumer, requestId, start, 400, {
      error: "Invalid JSON body",
    });
  }

  const converted = anthropicClientProtocolAdapter.transformRequest(raw);
  if (!converted.ok) {
    return respondWithConsumerError(c, consumer, requestId, start, converted.statusCode, {
      error: converted.error,
    });
  }

  const { body } = converted;
  if (!isModelAllowedByConsumerKey(body.model, consumer.allowedModels)) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${body.model}" is not allowed for this key` },
      body.model,
      "not_allowed",
    );
  }

  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(body.model, "anthropic"),
  );
  if (routes.length === 0) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      404,
      { error: `Model "${body.model}" not found or disabled` },
      body.model,
      "not_found_or_disabled",
    );
  }

  const hasCompatibleRoute = routes.some(({ endpoint }) => {
    if (!canServeClientFormat("anthropic", endpoint.apiFormat)) return false;
    return Boolean(getAdapter(endpoint.apiFormat));
  });
  if (!hasCompatibleRoute) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: "No compatible endpoint route configured for this model" },
      body.model,
      "no_route",
    );
  }

  const modelAccess = await canConsumerAccessModel(consumer, routes[0].model);
  if (!modelAccess.allowed) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${body.model}" is not available for this user` },
      body.model,
      "not_allowed",
    );
  }

  return c.json({ input_tokens: estimateAnthropicInputTokens(body) });
}

interface CanonicalChatOptions {
  body: OpenAIChatBody;
  clientFormat: ClientFormat;
  cacheScope: string;
  passthroughHeaders?: Record<string, string>;
  responseTransformer?: (body: OpenAIChatResponse, publicModel: string) => unknown;
  createStreamOutputTransformer?: (model: string) => StreamOutputTransformer;
}

async function handleCanonicalChatCompletions(
  c: Context,
  consumer: ConsumerSession,
  requestId: string,
  start: number,
  options: CanonicalChatOptions,
): Promise<Response> {
  const timeouts = resolveTimeoutConfig(getGatewayConfigCached().timeouts);
  const {
    body,
    cacheScope,
    clientFormat,
    createStreamOutputTransformer,
    passthroughHeaders = {},
    responseTransformer,
  } = options;

  // -- 2. Model ACL check --
  if (!isModelAllowedByConsumerKey(body.model, consumer.allowedModels)) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${body.model}" is not allowed for this key` },
      body.model,
      "not_allowed",
    );
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
    await aiModelRouteRepo.findEnabledRoutesByModelId(body.model, clientFormat),
  );
  if (routes.length === 0) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      404,
      { error: `Model "${body.model}" not found or disabled` },
      body.model,
      "not_found_or_disabled",
    );
  }

  const modelAccess = await canConsumerAccessModel(consumer, routes[0].model);
  if (!modelAccess.allowed) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${body.model}" is not available for this user` },
      body.model,
      "not_allowed",
    );
  }

  // -- 6. Resolve key across all routes (multi-endpoint failover) --
  const model = routes[0].model;
  const isFreeModel = lte(model.inputPrice, "0") && lte(model.outputPrice, "0");
  if (!isFreeModel && lte(consumer.agentBalance, "0")) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      402,
      {
        error: "Agent balance exhausted. Please top up the pay-agent.",
      },
      { modelId: model.modelId },
    );
  }

  interface ResolvedUpstream {
    endpointCredentialId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    concurrencyScopeKey: string;
    upstreamName: string;
    upstreamBaseUrl: string;
    endpointId: string;
    serializedBody: string;
    adapter: ReturnType<typeof getAdapter>;
    concurrencyLimit: number | null;
    queueTimeoutMs: number;
  }
  const resolvedUpstreams: ResolvedUpstream[] = [];
  const routeDiagnostics: Array<{
    endpointId: string;
    apiFormat: string;
    routeId: number;
    endpointModelId: string;
    upstreamCandidates: number;
    missingKeys: number;
    authFailures: number;
    resolved: number;
    skipped?: string;
  }> = [];

  for (const { route, endpoint, model: routeModel } of routes) {
    const endpointModelId = route.endpointModelId ?? routeModel.modelId;

    if (!canServeClientFormat(clientFormat, endpoint.apiFormat)) {
      routeDiagnostics.push({
        endpointId: endpoint.endpointId,
        apiFormat: endpoint.apiFormat,
        routeId: route.id,
        endpointModelId,
        upstreamCandidates: 0,
        missingKeys: 0,
        authFailures: 0,
        resolved: 0,
        skipped: "incompatible-client-format",
      });
      continue;
    }

    if (body.stream && endpoint.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
      routeDiagnostics.push({
        endpointId: endpoint.endpointId,
        apiFormat: endpoint.apiFormat,
        routeId: route.id,
        endpointModelId,
        upstreamCandidates: 0,
        missingKeys: 0,
        authFailures: 0,
        resolved: 0,
        skipped: "bedrock-streaming-unsupported",
      });
      continue; // skip unsupported streaming routes
    }

    const adapter = getAdapter(endpoint.apiFormat);
    if (!adapter) {
      routeDiagnostics.push({
        endpointId: endpoint.endpointId,
        apiFormat: endpoint.apiFormat,
        routeId: route.id,
        endpointModelId,
        upstreamCandidates: 0,
        missingKeys: 0,
        authFailures: 0,
        resolved: 0,
        skipped: "missing-adapter",
      });
      continue;
    }

    const candidateBody = {
      ...body,
      model: endpointModelId,
      ...(body.stream ? { stream_options: { include_usage: true } } : {}),
    } as unknown as OpenAIChatBody;
    const transformedBody = adapter.transformRequest(candidateBody);
    const serializedBody = JSON.stringify(transformedBody);

    const upstreamCandidates = await resolveUpstreamCandidates(endpoint);
    const diagnostics = {
      endpointId: endpoint.endpointId,
      apiFormat: endpoint.apiFormat,
      routeId: route.id,
      endpointModelId,
      upstreamCandidates: upstreamCandidates.length,
      missingKeys: 0,
      authFailures: 0,
      resolved: 0,
    };
    routeDiagnostics.push(diagnostics);

    for (const upstream of upstreamCandidates) {
      const credential = await pickEndpointCredential(endpoint.id, upstream.id);
      if (!credential) {
        diagnostics.missingKeys++;
        continue;
      }
      try {
        const plainKey = decrypt(credential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
        const mappedModelId = await resolveModelMapping(upstream.id, endpointModelId);
        const needsRemap = mappedModelId !== endpointModelId;
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
        const { headers: authHeaders, url: finalUrl } = buildEndpointAuth(
          endpoint,
          plainKey,
          upstreamUrl,
          effectiveBody,
        );
        resolvedUpstreams.push({
          endpointCredentialId: credential.id,
          authHeaders,
          finalUrl,
          upstreamId: upstream.id,
          concurrencyScopeKey: upstream.concurrencyScopeKey,
          upstreamName: upstream.name,
          upstreamBaseUrl: upstream.baseUrl,
          endpointId: endpoint.endpointId,
          serializedBody: effectiveBody,
          adapter,
          concurrencyLimit: upstream.concurrencyLimit,
          queueTimeoutMs: upstream.queueTimeoutMs,
        });
        diagnostics.resolved++;
      } catch {
        diagnostics.authFailures++;
        continue;
      }
    }
  }
  if (resolvedUpstreams.length === 0) {
    log.gateway.warn(
      { requestId, modelId: model.modelId, clientFormat, routeDiagnostics },
      "No endpoint credential configured for any endpoint route",
    );
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: "No endpoint credential configured for any endpoint route" },
      model.modelId,
      "no_route",
      { modelId: model.modelId },
    );
  }

  // Start with first candidate; fallback to next on retryable failures
  let selected = resolvedUpstreams[0];

  // -- 7b. Check if request logging is enabled --
  const logEnabled = await isRequestLoggingEnabled();

  // -- 8. Pre-flight spending limit check (daily/monthly) --
  // Catches agents that have already exceeded their limits before we hit upstream.
  if (!isFreeModel) {
    const preflightLimit = await checkConsumerSpendingLimits(consumer);
    if (preflightLimit) {
      return respondWithConsumerError(
        c,
        consumer,
        requestId,
        start,
        preflightLimit.statusCode,
        preflightLimit.body,
        {
          endpointCredentialId: selected.endpointCredentialId,
          endpointId: selected.endpointId,
          modelId: model.modelId,
        },
      );
    }
  }

  const cliNotice = await findCliAnnouncementNotice(consumer, requestId, body);
  const cliNoticeText = cliNotice ? formatCliAnnouncementText(cliNotice) : null;

  // -- 9. Upstream fetch with fallback retry --
  // Try each resolved upstream in order; on retryable failure, advance to next.
  let lastError: { status: number; message: string } | null = null;

  for (let uIdx = 0; uIdx < resolvedUpstreams.length && uIdx < MAX_UPSTREAM_ATTEMPTS; uIdx++) {
    selected = resolvedUpstreams[uIdx];

    // Create fresh meta per iteration — shared reference would race with async stream callbacks
    const meta: StreamRelayMeta = {
      endpointCredentialId: selected.endpointCredentialId,
      endpointId: selected.endpointId,
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
          scope: cacheScope,
          model: model.modelId,
          endpointId: selected.endpointId,
          upstreamId: selected.upstreamId,
          upstreamBaseUrl: selected.upstreamBaseUrl,
          requestBody: selected.serializedBody,
        })
      : null;
    if (cacheKey) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        if (cliNoticeText) {
          const injected = injectCliNoticeIntoClientResponse(cached, cliNoticeText, clientFormat);
          if (injected) {
            await markCliAnnouncementDelivered(cliNotice, consumer);
            return c.json(injected);
          }
        }
        return c.json(cached);
      }
    }

    let concurrencyLease: UpstreamConcurrencyLease | null;
    try {
      concurrencyLease = await acquireUpstreamSlot({
        upstreamId: selected.upstreamId,
        concurrencyScopeKey: selected.concurrencyScopeKey,
        concurrencyLimit: selected.concurrencyLimit,
        queueTimeoutMs: selected.queueTimeoutMs,
        requestId,
        endpointId: selected.endpointId,
        modelId: model.modelId,
      });
    } catch (err) {
      lastError = toConcurrencyLastError(err);
      continue;
    }

    // -- 9a. Streaming path --
    if (body.stream) {
      let releaseInFinally = true;
      try {
        const streamingHeaders = { ...selected.authHeaders, ...passthroughHeaders };
        const upstreamFetchMs = resolveUpstreamFetchTimeoutMs(timeouts, {
          endpointId: selected.endpointId,
          modelId: model.modelId,
        });
        const upstreamRes = await fetchUpstream(
          selected.finalUrl,
          streamingHeaders,
          selected.serializedBody,
          upstreamFetchMs,
          {
            endpoint: selected.endpointId,
            route: "chat",
          },
        );
        if (!upstreamRes.ok) {
          if (RETRYABLE_STATUS.has(upstreamRes.status)) {
            markCredentialFailure(selected.endpointCredentialId);
            const errBody = await upstreamRes.text().catch(() => "");
            lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
            continue; // try next upstream
          }
          // Non-retryable — return immediately
          const errBody = await upstreamRes.text().catch(() => "");
          if (shouldInjectModelErrorNoticeFromUpstream(upstreamRes.status, errBody)) {
            return respondWithUpstreamModelAnnouncementError(
              c,
              consumer,
              requestId,
              start,
              upstreamRes.status,
              errBody,
              model.modelId,
              upstreamRes.status === 403 ? "not_allowed" : "not_found_or_disabled",
              {
                endpointCredentialId: selected.endpointCredentialId,
                endpointId: selected.endpointId,
                modelId: model.modelId,
                upstreamId: selected.upstreamId,
                upstreamName: selected.upstreamName,
                upstreamBaseUrl: selected.upstreamBaseUrl,
                requestBody: logEnabled ? selected.serializedBody : undefined,
              },
            );
          }
          return respondWithConsumerError(
            c,
            consumer,
            requestId,
            start,
            upstreamRes.status,
            { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
            {
              endpointCredentialId: selected.endpointCredentialId,
              endpointId: selected.endpointId,
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
        // Mark the CLI notice delivered only after the stream completes — marking
        // before forwardStream would burn the once-per-consumer delivery if the
        // write later fails. Follows the same lifecycle as billing.
        const cliNoticeForStream = cliNotice;
        const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
          await billConsumer({
            usage,
            latencyMs,
            consumer,
            endpointCredentialId: billSelected.endpointCredentialId,
            endpointId: billSelected.endpointId,
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
          await markCliAnnouncementDelivered(cliNoticeForStream, consumer);
        };

        const initialEvents = cliNoticeText
          ? (buildCliNoticeStreamEvents(model.modelId, cliNoticeText, clientFormat) ?? undefined)
          : undefined;

        const streamConcurrencyLease = concurrencyLease;
        releaseInFinally = false;
        return forwardStream(
          c,
          upstreamRes,
          selected.adapter!,
          meta,
          onComplete,
          timeouts,
          createStreamOutputTransformer?.(model.modelId),
          initialEvents,
          () => releaseUpstreamSlot(streamConcurrencyLease),
        );
      } catch (err) {
        if (!releaseInFinally) {
          await releaseUpstreamSlot(concurrencyLease).catch(() => {});
        }
        markCredentialFailure(selected.endpointCredentialId);
        lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
        continue; // try next upstream
      } finally {
        if (releaseInFinally) await releaseUpstreamSlot(concurrencyLease);
      }
    }

    // -- 9b. Non-streaming path --
    try {
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
          { endpoint: selected.endpointId, route: "chat", phase: "response" },
          (Date.now() - fetchStart) / 1000,
        );
      } catch (err) {
        markCredentialFailure(selected.endpointCredentialId);
        lastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
        continue; // try next upstream
      }

      if (!upstreamRes.ok) {
        if (RETRYABLE_STATUS.has(upstreamRes.status)) {
          markCredentialFailure(selected.endpointCredentialId);
          const errBody = await upstreamRes.text().catch(() => "");
          lastError = { status: upstreamRes.status, message: errBody.slice(0, 1000) };
          continue; // try next upstream
        }
        // Non-retryable — return immediately
        const errBody = await upstreamRes.text().catch(() => "");
        if (shouldInjectModelErrorNoticeFromUpstream(upstreamRes.status, errBody)) {
          return respondWithUpstreamModelAnnouncementError(
            c,
            consumer,
            requestId,
            start,
            upstreamRes.status,
            errBody,
            model.modelId,
            upstreamRes.status === 403 ? "not_allowed" : "not_found_or_disabled",
            {
              endpointCredentialId: selected.endpointCredentialId,
              endpointId: selected.endpointId,
              modelId: model.modelId,
              upstreamId: selected.upstreamId,
              upstreamName: selected.upstreamName,
              upstreamBaseUrl: selected.upstreamBaseUrl,
              requestBody: logEnabled ? selected.serializedBody : undefined,
            },
          );
        }
        return respondWithConsumerError(
          c,
          consumer,
          requestId,
          start,
          upstreamRes.status,
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          {
            endpointCredentialId: selected.endpointCredentialId,
            endpointId: selected.endpointId,
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
            endpointCredentialId: selected.endpointCredentialId,
            endpointId: selected.endpointId,
            modelId: model.modelId,
            upstreamId: selected.upstreamId,
            upstreamName: selected.upstreamName,
            upstreamBaseUrl: selected.upstreamBaseUrl,
            requestBody: logEnabled ? selected.serializedBody : undefined,
          },
        );
      }

      const canonicalResponse = selected.adapter!.transformResponse(responseBody);
      const transformed = responseTransformer
        ? responseTransformer(canonicalResponse, model.modelId)
        : canonicalResponse;
      const usage = selected.adapter!.extractUsage(responseBody);
      const latencyMs = Date.now() - start;
      markCredentialSuccess(selected.endpointCredentialId);

      // -- 10. Debit consumer + log usage --
      const billing = await billConsumer({
        usage,
        latencyMs,
        consumer,
        endpointCredentialId: selected.endpointCredentialId,
        endpointId: selected.endpointId,
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
            endpointCredentialId: selected.endpointCredentialId,
            endpointId: selected.endpointId,
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

      if (cliNoticeText) {
        const injectedCanonical = injectCliNoticeIntoChatResponse(canonicalResponse, cliNoticeText);
        if (injectedCanonical) {
          const injected = responseTransformer
            ? responseTransformer(injectedCanonical, model.modelId)
            : injectedCanonical;
          await markCliAnnouncementDelivered(cliNotice, consumer);
          return c.json(injected);
        }
      }

      return c.json(transformed);
    } finally {
      await releaseUpstreamSlot(concurrencyLease);
    }
  }

  // All upstreams exhausted — return last error
  if (lastError) {
    notifyResourceDown({
      route: "consumer-chat",
      requestId,
      endpointId: selected.endpointId,
      modelId: model.modelId,
      upstreamId: selected.upstreamId,
      upstreamName: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      status: lastError.status,
      detail: lastError.message,
    });
  }
  return respondWithUpstreamExhaustedAnnouncementError(
    c,
    consumer,
    requestId,
    start,
    lastError,
    model.modelId,
    {
      endpointCredentialId: selected.endpointCredentialId,
      endpointId: selected.endpointId,
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
  if (!isModelAllowedByConsumerKey(modelId, consumer.allowedModels)) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${modelId}" is not allowed for this key` },
      modelId,
      "not_allowed",
    );
  }

  const routes = orderRoutesByPriorityAndWeight(
    await aiModelRouteRepo.findEnabledRoutesByModelId(modelId, clientFormat),
  );
  if (routes.length === 0) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      404,
      { error: `Model "${modelId}" not found or disabled` },
      modelId,
      "not_found_or_disabled",
    );
  }

  const modelAccess = await canConsumerAccessModel(consumer, routes[0].model);
  if (!modelAccess.allowed) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: `Model "${modelId}" is not available for this user` },
      modelId,
      "not_allowed",
    );
  }

  const model = routes[0].model;
  const ptIsFreeModel = lte(model.inputPrice, "0") && lte(model.outputPrice, "0");
  if (!ptIsFreeModel && lte(consumer.agentBalance, "0")) {
    return respondWithConsumerError(
      c,
      consumer,
      requestId,
      start,
      402,
      {
        error: "Agent balance exhausted. Please top up the pay-agent.",
      },
      { modelId },
    );
  }
  const serializedBody = JSON.stringify(body);

  // Resolve all upstream candidates for fallback retry
  interface ResolvedPtUpstream {
    endpointCredentialId: number;
    authHeaders: Record<string, string>;
    finalUrl: string;
    upstreamId: number | null;
    concurrencyScopeKey: string;
    upstreamName: string;
    upstreamBaseUrl: string;
    endpointId: string;
    serializedBody: string;
    concurrencyLimit: number | null;
    queueTimeoutMs: number;
  }
  const resolvedPtUpstreams: ResolvedPtUpstream[] = [];

  for (const { route, endpoint, model: routeModel } of routes) {
    if (!isNativePassthroughEndpoint(clientFormat, endpoint.apiFormat)) continue;
    if (body.stream === true && endpoint.apiFormat === "bedrock" && !BEDROCK_STREAMING_SUPPORTED) {
      continue;
    }

    const endpointModelId = route.endpointModelId ?? routeModel.modelId;

    for (const upstream of await resolveUpstreamCandidates(endpoint)) {
      const credential = await pickEndpointCredential(endpoint.id, upstream.id);
      if (!credential) continue;
      try {
        const plainKey = decrypt(credential.encryptedKey, AI_CREDENTIAL_DOMAIN_TAG);
        const mappedModelId = await resolveModelMapping(upstream.id, endpointModelId);
        const effectiveBody =
          mappedModelId === modelId && endpointModelId === modelId
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
        resolvedPtUpstreams.push({
          endpointCredentialId: credential.id,
          authHeaders,
          finalUrl,
          upstreamId: upstream.id,
          concurrencyScopeKey: upstream.concurrencyScopeKey,
          upstreamName: upstream.name,
          upstreamBaseUrl: upstream.baseUrl,
          endpointId: endpoint.endpointId,
          serializedBody: effectiveBody,
          concurrencyLimit: upstream.concurrencyLimit,
          queueTimeoutMs: upstream.queueTimeoutMs,
        });
      } catch {
        continue;
      }
    }
  }
  if (resolvedPtUpstreams.length === 0) {
    return respondWithModelAnnouncementError(
      c,
      consumer,
      requestId,
      start,
      403,
      { error: "No compatible endpoint key configured for this model" },
      modelId,
      "no_route",
      { modelId },
    );
  }

  if (!ptIsFreeModel) {
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
  }

  // Resolve a CLI announcement for this consumer (best-effort text prelude).
  // Passthrough forwards native endpoint SSE verbatim, so streaming injection is
  // format-gated by buildCliNoticeStreamEvents (OpenAI only — Anthropic native
  // streams cannot accept an isolated delta without corrupting the SDK state
  // machine). Non-streaming responses inject via injectCliNoticeIntoClientResponse.
  const cliNotice = await findCliAnnouncementNotice(consumer, requestId, body);
  const cliNoticeText = cliNotice ? formatCliAnnouncementText(cliNotice) : null;

  // Forward endpoint-specific headers from the client (e.g. anthropic-version, anthropic-beta)
  // Client headers take precedence over buildEndpointAuth defaults
  const passthroughHeaders = extractPassthroughHeaders(c);

  const ptLogEnabled = await isRequestLoggingEnabled();
  const isStreaming = body.stream === true;

  let ptSelected = resolvedPtUpstreams[0];
  let ptLastError: { status: number; message: string } | null = null;

  for (let pIdx = 0; pIdx < resolvedPtUpstreams.length && pIdx < MAX_UPSTREAM_ATTEMPTS; pIdx++) {
    ptSelected = resolvedPtUpstreams[pIdx];

    const meta: StreamRelayMeta = {
      endpointCredentialId: ptSelected.endpointCredentialId,
      endpointId: ptSelected.endpointId,
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

    let concurrencyLease: UpstreamConcurrencyLease | null;
    let releaseInFinally = true;
    try {
      concurrencyLease = await acquireUpstreamSlot({
        upstreamId: ptSelected.upstreamId,
        concurrencyScopeKey: ptSelected.concurrencyScopeKey,
        concurrencyLimit: ptSelected.concurrencyLimit,
        queueTimeoutMs: ptSelected.queueTimeoutMs,
        requestId,
        endpointId: ptSelected.endpointId,
        modelId,
      });
    } catch (err) {
      ptLastError = toConcurrencyLastError(err);
      continue;
    }

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
                endpointId: ptSelected.endpointId,
                modelId,
              })
            : timeouts.streamMaxDurationMs,
        ),
      });
      gatewayUpstreamDuration.observe(
        { endpoint: ptSelected.endpointId, route: "passthrough", phase: "response" },
        (Date.now() - fetchStart) / 1000,
      );

      // ── Streaming passthrough — parse SSE frames for usage + billing ──
      if (isStreaming && upstreamRes.ok && upstreamRes.body) {
        const billPt = ptSelected; // capture for closure
        const cliNoticeForStream = cliNotice;
        const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
          await billConsumer({
            usage,
            latencyMs,
            consumer,
            endpointCredentialId: billPt.endpointCredentialId,
            endpointId: billPt.endpointId,
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
          await markCliAnnouncementDelivered(cliNoticeForStream, consumer);
        };

        const initialEvents = cliNoticeText
          ? (buildCliNoticeStreamEvents(modelId, cliNoticeText, clientFormat) ?? undefined)
          : undefined;

        const streamConcurrencyLease = concurrencyLease;
        releaseInFinally = false;
        return forwardPassthroughStream(
          c,
          upstreamRes,
          meta,
          onComplete,
          timeouts,
          initialEvents,
          () => releaseUpstreamSlot(streamConcurrencyLease),
        );
      }

      // Retryable error — try next upstream
      if (!upstreamRes.ok && RETRYABLE_STATUS.has(upstreamRes.status)) {
        markCredentialFailure(ptSelected.endpointCredentialId);
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
        markCredentialSuccess(ptSelected.endpointCredentialId);
      } else {
        markCredentialFailure(ptSelected.endpointCredentialId);
      }

      const billing = await billConsumer({
        usage,
        latencyMs,
        consumer,
        endpointCredentialId: ptSelected.endpointCredentialId,
        endpointId: ptSelected.endpointId,
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
            endpointCredentialId: ptSelected.endpointCredentialId,
            endpointId: ptSelected.endpointId,
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
        if (
          !["transfer-encoding", "content-encoding", "connection", "content-length"].includes(
            k.toLowerCase(),
          )
        ) {
          resHeaders.set(k, v);
        }
      });

      // Inject CLI notice into non-streaming JSON responses (both formats).
      // Mark delivered only after a successful inject — mirrors the canonical
      // non-streaming path. Non-JSON or failed-inject responses pass through.
      let responseBody: BodyInit | null = responseText !== null ? responseText : upstreamRes.body;
      if (cliNoticeText && upstreamRes.ok && isJson && responseText !== null) {
        try {
          const parsed: unknown = JSON.parse(responseText);
          const injected = injectCliNoticeIntoClientResponse(parsed, cliNoticeText, clientFormat);
          if (injected !== null) {
            responseBody = JSON.stringify(injected);
            await markCliAnnouncementDelivered(cliNotice, consumer);
          }
        } catch (err) {
          log.gateway.warn(
            { err, requestId, consumerId: consumer.consumerId, modelId },
            "Failed to inject CLI notice into passthrough response",
          );
        }
      }

      if (
        !upstreamRes.ok &&
        isJson &&
        responseText !== null &&
        shouldInjectModelErrorNoticeFromUpstream(upstreamRes.status, responseText)
      ) {
        try {
          const notice = await findModelErrorAnnouncement(
            modelId,
            upstreamRes.status === 403 ? "not_allowed" : "not_found_or_disabled",
          );
          if (notice) {
            responseBody = JSON.stringify(
              buildCliVisibleAnnouncementErrorPayload(
                parseUpstreamErrorPayload(upstreamRes.status, responseText),
                notice,
              ),
            );
          }
        } catch (err) {
          log.gateway.warn(
            { err, requestId, consumerId: consumer.consumerId, modelId },
            "Failed to inject model-error announcement into passthrough error response",
          );
        }
      }

      return new Response(responseBody, {
        status: upstreamRes.status,
        headers: resHeaders,
      });
    } catch (err) {
      if (!releaseInFinally) {
        await releaseUpstreamSlot(concurrencyLease).catch(() => {});
      }
      markCredentialFailure(ptSelected.endpointCredentialId);
      ptLastError = { status: 0, message: err instanceof Error ? err.message : String(err) };
      continue;
    } finally {
      if (releaseInFinally) await releaseUpstreamSlot(concurrencyLease);
    }
  }

  // All upstreams exhausted
  if (ptLastError) {
    notifyResourceDown({
      route: "consumer-passthrough",
      requestId,
      endpointId: ptSelected.endpointId,
      modelId,
      upstreamId: ptSelected.upstreamId,
      upstreamName: ptSelected.upstreamName,
      upstreamBaseUrl: ptSelected.upstreamBaseUrl,
      status: ptLastError.status,
      detail: ptLastError.message,
    });
  }
  return respondWithUpstreamExhaustedAnnouncementError(
    c,
    consumer,
    requestId,
    start,
    ptLastError,
    modelId,
    {
      endpointCredentialId: ptSelected.endpointCredentialId,
      endpointId: ptSelected.endpointId,
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
