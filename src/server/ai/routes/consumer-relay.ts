/**
 * Consumer AI Relay route — same pipeline as relay.ts but authenticated via ska_ consumer keys.
 *
 * Adds: balance gate, model ACL, post-request billing (debit + transaction record).
 * Mounted at /api/gateway/ai/endpoint (consumerKeyAuthMiddleware applied via parent).
 */
import { Hono } from "hono";

import { emit } from "@/server/events";
import { aiRelayChatBody } from "@/server/lib/body-schemas";
import { decrypt } from "@/server/lib/crypto";
import { log } from "@/server/lib/logger";
import { parseBody } from "@/server/lib/validate";
import { enqueueJob } from "@/server/lib/write-queue";
import { getRequestId } from "@/server/middleware/request-id";
import {
  aiGuardrailConfigRepo,
  aiModelRepo,
  payAgentRepo,
  payAgentTransactionRepo,
} from "@/server/repos";
import { gt, removeTailingZero, safePlus } from "@/shared/number";

import { billConsumer, calculateConsumerCost } from "../lib/billing";
import { checkInputGuardrails, type GuardrailConfig } from "../lib/guardrails";
import { pickKey } from "../lib/key-balancer";
import { buildProviderAuth } from "../lib/provider-auth";
import { extractPassthroughHeaders, isRequestLoggingEnabled } from "../lib/request-helpers";
import { safeParseGuardrailRules } from "../lib/safe-json";
import { buildCacheKey, getCachedResponse, setCachedResponse } from "../lib/semantic-cache";
import {
  extractPassthroughUsage,
  fetchUpstream,
  forwardPassthroughStream,
  forwardStream,
  type StreamCompleteCallback,
  type StreamRelayMeta,
} from "../lib/stream-proxy";
import { getConsumerSession } from "../middleware/consumer-key-auth";
import { getAdapter } from "../providers/registry";
import type { OpenAIChatBody, TokenUsage } from "../providers/types";

const AI_KEY_DOMAIN_TAG = "ai-merchant-key";
const UPSTREAM_TIMEOUT_MS = 5 * 60 * 1000;

const consumerRelay = new Hono();

// ── GET /v1/models — OpenAI-compatible model catalog ────────────────

consumerRelay.get("/v1/models", async (c) => {
  const consumer = getConsumerSession(c);
  const rows = await aiModelRepo.findAllEnabled();

  // Filter by consumer's allowed models (if ACL is set)
  const filtered =
    consumer.allowedModels.length > 0
      ? rows.filter((r) =>
          consumer.allowedModels.some((pattern) =>
            pattern.endsWith("*")
              ? r.model.modelId.startsWith(pattern.slice(0, -1))
              : r.model.modelId === pattern,
          ),
        )
      : rows;

  const data = filtered.map((r) => ({
    id: r.model.modelId,
    object: "model" as const,
    created: Math.floor(new Date(r.model.createdAt).getTime() / 1000),
    owned_by: r.provider.providerId,
  }));
  return c.json({ object: "list", data });
});

// ── POST /v1/chat/completions ────────────────────────────────────────

consumerRelay.post("/v1/chat/completions", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();

  // -- 1. Validate request body --
  const parsed = await parseBody(c, aiRelayChatBody);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  // -- 2. Model ACL check --
  if (consumer.allowedModels.length > 0) {
    const allowed = consumer.allowedModels.some((pattern) => {
      if (pattern.endsWith("*")) return body.model.startsWith(pattern.slice(0, -1));
      return body.model === pattern;
    });
    if (!allowed) {
      return c.json({ error: `Model "${body.model}" is not allowed for this key` }, 403);
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
        return c.json({ error: result.reason ?? "Blocked by guardrails" }, 403);
      }
    }
  } catch (err) {
    log.gateway.warn({ err }, "Guardrail evaluation failed — proceeding without guardrails");
  }

  // -- 4. Resolve model --
  const primary = await aiModelRepo.findEnabledByModelId(body.model);
  if (!primary) {
    return c.json({ error: `Model "${body.model}" not found or disabled` }, 404);
  }

  // -- 5. Cache check (non-streaming) --
  // Cache hits are free — no consumer billing. This is intentional: identical
  // requests within the TTL window cost nothing, incentivising efficient usage.
  if (!body.stream) {
    const cacheKey = buildCacheKey(body.model, body.messages);
    const cached = getCachedResponse(cacheKey);
    if (cached) return c.json(cached);
  }

  // -- 6. Resolve key --
  const provider = primary.provider;
  const model = primary.model;

  const key = await pickKey(provider.id);
  if (!key) {
    return c.json({ error: `No API key configured for provider "${provider.name}"` }, 403);
  }

  let plainKey: string;
  try {
    plainKey = decrypt(key.encryptedKey, AI_KEY_DOMAIN_TAG);
  } catch {
    return c.json({ error: "Failed to decrypt provider key" }, 500);
  }

  const adapter = getAdapter(provider.apiFormat);
  if (!adapter) {
    return c.json({ error: `Unsupported provider format: ${provider.apiFormat}` }, 500);
  }

  // -- 7. Build upstream request --
  // Inject stream_options at route level (belt-and-suspenders with adapter.transformRequest)
  // so OpenAI-compatible providers return usage in SSE chunks regardless of client config.
  const candidateBody = {
    ...body,
    model: model.modelId,
    ...(body.stream ? { stream_options: { include_usage: true } } : {}),
  } as unknown as OpenAIChatBody;
  const transformedBody = adapter.transformRequest(candidateBody);
  const serializedBody = JSON.stringify(transformedBody);

  const upstreamUrl = adapter.buildUrl(provider.baseUrl, {
    model: model.modelId,
    stream: !!body.stream,
  });
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(
    provider,
    plainKey,
    upstreamUrl,
    serializedBody,
  );

  // -- 7b. Check if request logging is enabled --
  const logEnabled = await isRequestLoggingEnabled();

  const meta: StreamRelayMeta = {
    keyId: key.id,
    providerId: provider.providerId,
    modelId: model.modelId,
    requestId,
    start,
    inputPrice: model.inputPrice,
    outputPrice: model.outputPrice,
    requestBody: logEnabled ? serializedBody : undefined,
  };

  // -- 8. Pre-flight spending limit check (daily/monthly) --
  // Catches agents that have already exceeded their limits before we hit upstream.
  if (consumer.dailyLimit) {
    const spentToday = await payAgentTransactionRepo.sumSpendingToday(consumer.agentId);
    if (gt(spentToday, consumer.dailyLimit)) {
      return c.json(
        { error: "Daily spending limit exceeded", limit: consumer.dailyLimit, spent: spentToday },
        429,
      );
    }
  }
  if (consumer.monthlyLimit) {
    const spentMonth = await payAgentTransactionRepo.sumSpendingThisMonth(consumer.agentId);
    if (gt(spentMonth, consumer.monthlyLimit)) {
      return c.json(
        {
          error: "Monthly spending limit exceeded",
          limit: consumer.monthlyLimit,
          spent: spentMonth,
        },
        429,
      );
    }
  }

  // -- 9. Streaming path --
  if (body.stream) {
    try {
      const upstreamRes = await fetchUpstream(finalUrl, authHeaders, serializedBody);
      if (!upstreamRes.ok) {
        const errBody = await upstreamRes.text().catch(() => "");
        return c.json(
          { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
          upstreamRes.status as 400,
        );
      }

      // Post-stream consumer billing callback
      const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
        await billConsumer({
          usage,
          latencyMs,
          consumer,
          keyId: key.id,
          providerId: provider.providerId,
          modelId: model.modelId,
          inputPrice: model.inputPrice,
          outputPrice: model.outputPrice,
          requestId,
          statusCode: 200,
          requestBody: logEnabled ? serializedBody : undefined,
          responseBody: rawResponse,
        });
      };

      return forwardStream(c, upstreamRes, adapter, meta, onComplete);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Upstream request failed: ${message}` }, 502);
    }
  }

  // -- 9. Non-streaming path --
  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(finalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: serializedBody,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Upstream request failed: ${message}` }, 502);
  }

  if (!upstreamRes.ok) {
    const errBody = await upstreamRes.text().catch(() => "");
    return c.json(
      { error: `Upstream returned ${upstreamRes.status}`, detail: errBody.slice(0, 2000) },
      upstreamRes.status as 400,
    );
  }

  let responseBody: unknown;
  try {
    responseBody = await upstreamRes.json();
  } catch {
    return c.json({ error: "Failed to parse upstream response" }, 502);
  }

  const transformed = adapter.transformResponse(responseBody);
  const usage = adapter.extractUsage(responseBody);
  const latencyMs = Date.now() - start;

  // -- 10. Calculate cost and debit consumer --
  const { upstreamCost, costStr } = calculateConsumerCost(
    usage,
    model.inputPrice,
    model.outputPrice,
    consumer.markupPercent,
  );

  // Per-pay limit (non-streaming: reject before returning response)
  if (consumer.perPayLimit && gt(costStr, consumer.perPayLimit)) {
    return c.json(
      {
        error: "Request cost exceeds per-transaction limit",
        limit: consumer.perPayLimit,
        cost: costStr,
      },
      429,
    );
  }
  // Daily/monthly post-response check (cost may push over limit)
  if (consumer.dailyLimit) {
    const spentToday = await payAgentTransactionRepo.sumSpendingToday(consumer.agentId);
    if (gt(safePlus(spentToday, costStr), consumer.dailyLimit)) {
      return c.json(
        {
          error: "Request would exceed daily spending limit",
          limit: consumer.dailyLimit,
          spent: spentToday,
          cost: costStr,
        },
        429,
      );
    }
  }
  if (consumer.monthlyLimit) {
    const spentMonth = await payAgentTransactionRepo.sumSpendingThisMonth(consumer.agentId);
    if (gt(safePlus(spentMonth, costStr), consumer.monthlyLimit)) {
      return c.json(
        {
          error: "Request would exceed monthly spending limit",
          limit: consumer.monthlyLimit,
          spent: spentMonth,
          cost: costStr,
        },
        429,
      );
    }
  }

  if (gt(costStr, "0")) {
    const debited = await payAgentRepo.debitBalance(consumer.agentId, costStr);
    if (debited) {
      enqueueJob("agent-ai-txn", {
        agentId: consumer.agentId,
        userId: consumer.userId,
        type: "ai_usage",
        amount: costStr,
        balanceBefore: safePlus(debited.balance, costStr),
        balanceAfter: debited.balance,
        referenceType: "ai_usage",
        description: `AI: ${model.modelId} (${usage?.totalTokens ?? 0} tokens)`,
        source: "platform",
        consumerKeyId: consumer.consumerId,
        modelId: model.modelId,
        tokens: usage?.totalTokens ?? 0,
        requestId,
        upstreamCost: removeTailingZero(upstreamCost, 6),
        markupPercent: consumer.markupPercent,
        aiKeyId: key.id,
      } as Record<string, unknown>);
    } else {
      log.gateway.warn(
        { agentId: consumer.agentId, cost: costStr },
        "AI debit failed — suspending agent",
      );
      await payAgentRepo.update(consumer.agentId, { status: "suspended" });
      emit("agent.suspended", null, { agentId: consumer.agentId });
      return c.json({ error: "Agent balance exhausted. Please top up the pay-agent." }, 402);
    }
  }

  // -- 11. Log usage --
  enqueueJob("ai-usage-log", {
    keyId: key.id,
    consumerKeyId: consumer.consumerId,
    userId: consumer.userId,
    providerId: provider.providerId,
    modelId: model.modelId,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    estimatedCost: costStr,
    upstreamCost: removeTailingZero(upstreamCost, 6),
    markupPercent: consumer.markupPercent,
    latencyMs,
    statusCode: upstreamRes.status,
    requestId,
  } as Record<string, unknown>);

  // Request/response body logging (opt-in)
  if (logEnabled) {
    enqueueJob("ai-request-log", {
      requestId,
      consumerKeyId: consumer.consumerId,
      modelId: model.modelId,
      requestBody: serializedBody,
      responseBody: JSON.stringify(responseBody),
      createdAt: new Date().toISOString(),
    } as Record<string, unknown>);
  }

  // Cache
  if (!body.stream) {
    const cacheKey = buildCacheKey(model.modelId, body.messages);
    setCachedResponse(cacheKey, transformed);
  }

  // Touch consumer key + provider key last_used (LRU rotation)
  enqueueJob("consumer-key-touch", { consumerId: consumer.consumerId });
  enqueueJob("ai-key-touch", { keyId: key.id, keyType: "admin" });

  return c.json(transformed);
});

// ── ALL /v1/* — Generic passthrough proxy (must be LAST) ────────────

consumerRelay.all("/v1/*", async (c) => {
  const consumer = getConsumerSession(c);
  const requestId = getRequestId(c);
  const start = Date.now();
  const subPath = c.req.path.replace(/^.*\/v1\//, "");

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

  // Model ACL
  if (consumer.allowedModels.length > 0) {
    const allowed = consumer.allowedModels.some((pattern) =>
      pattern.endsWith("*") ? modelId.startsWith(pattern.slice(0, -1)) : modelId === pattern,
    );
    if (!allowed) {
      return c.json({ error: `Model "${modelId}" is not allowed for this key` }, 403);
    }
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

  // Forward provider-specific headers from the client (e.g. anthropic-version, anthropic-beta)
  // Client headers take precedence over buildProviderAuth defaults
  const passthroughHeaders = extractPassthroughHeaders(c);

  const ptLogEnabled = await isRequestLoggingEnabled();

  const meta: StreamRelayMeta = {
    keyId: key.id,
    providerId: provider.providerId,
    modelId,
    requestId,
    start,
    inputPrice: result.model.inputPrice,
    outputPrice: result.model.outputPrice,
    requestBody: ptLogEnabled ? serializedBody : undefined,
  };

  const isStreaming = body.stream === true;

  try {
    const upstreamRes = await fetch(finalUrl, {
      method: c.req.method,
      headers: { "Content-Type": "application/json", ...authHeaders, ...passthroughHeaders },
      body: c.req.method !== "GET" ? serializedBody : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // ── Streaming passthrough — parse SSE frames for usage + billing ──
    if (isStreaming && upstreamRes.ok && upstreamRes.body) {
      const onComplete: StreamCompleteCallback = async (usage, latencyMs, rawResponse) => {
        await billConsumer({
          usage,
          latencyMs,
          consumer,
          keyId: key.id,
          providerId: provider.providerId,
          modelId,
          inputPrice: result.model.inputPrice,
          outputPrice: result.model.outputPrice,
          requestId,
          statusCode: 200,
          requestBody: ptLogEnabled ? serializedBody : undefined,
          responseBody: rawResponse,
        });
      };

      return forwardPassthroughStream(c, upstreamRes, meta, onComplete);
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

    await billConsumer({
      usage,
      latencyMs,
      consumer,
      keyId: key.id,
      providerId: provider.providerId,
      modelId,
      inputPrice: result.model.inputPrice,
      outputPrice: result.model.outputPrice,
      requestId,
      statusCode: upstreamRes.status,
      requestBody: ptLogEnabled ? serializedBody : undefined,
      responseBody: ptLogEnabled ? (responseText ?? "") : undefined,
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
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Upstream request failed: ${message}` }, 502);
  }
});

export default consumerRelay;
