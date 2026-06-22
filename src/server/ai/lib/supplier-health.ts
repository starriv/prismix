/**
 * Supplier connectivity check — shared logic for health-check job + admin discover-models.
 *
 * Extracted from admin-ai-models.ts to avoid duplication between the periodic
 * health-check job and the admin "discover models" endpoint, both of which
 * ping a supplier's /models endpoint to verify connectivity.
 */
import { match } from "ts-pattern";

import type { AiProvider } from "@/server/db";

import { anthropicAdapter } from "../providers/anthropic";
import { buildProviderAuth } from "./provider-auth";

export interface PingResult {
  ok: boolean;
  status: number;
  error?: string;
  latencyMs: number;
}

export interface PingEndpointOpts {
  provider: Pick<AiProvider, "authType" | "authConfig" | "apiFormat"> &
    Partial<Pick<AiProvider, "providerId">>;
  baseUrl: string;
  modelsEndpointOverride?: string | null;
  plainKey: string;
  anthropicProbeModelId?: string | null;
  timeoutMs?: number;
}

const ANTHROPIC_OFFICIAL_PROBE_MODEL = "claude-haiku-4-5";
const DEEPSEEK_ANTHROPIC_PROBE_MODEL = "deepseek-chat";

export function buildModelsUrl(
  provider: Pick<AiProvider, "apiFormat">,
  baseUrl: string,
  modelsEndpointOverride?: string | null,
): string {
  if (modelsEndpointOverride) return modelsEndpointOverride;

  const base = baseUrl.replace(/\/+$/, "");

  return match(provider.apiFormat)
    .with("bedrock", () => {
      const controlPlaneBase = base.replace("bedrock-runtime.", "bedrock.");
      return `${controlPlaneBase}/foundation-models`;
    })
    .with("gemini", () => `${base}/models`)
    .with("anthropic", () => `${base}/models`)
    .otherwise(() => (base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`));
}

function shouldFallbackToAnthropicMessageProbe(
  provider: Pick<AiProvider, "apiFormat">,
  result: PingResult,
  modelsEndpointOverride?: string | null,
): boolean {
  if (provider.apiFormat !== "anthropic") return false;
  if (modelsEndpointOverride) return false;
  return result.status === 400 || result.status === 404 || result.status === 405;
}

function defaultAnthropicProbeModel(
  provider: Partial<Pick<AiProvider, "providerId">>,
  baseUrl: string,
): string {
  const providerId = provider.providerId?.toLowerCase() ?? "";
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "api.deepseek.com" || providerId.includes("deepseek")) {
      return DEEPSEEK_ANTHROPIC_PROBE_MODEL;
    }
  } catch {
    if (providerId.includes("deepseek")) return DEEPSEEK_ANTHROPIC_PROBE_MODEL;
  }

  return ANTHROPIC_OFFICIAL_PROBE_MODEL;
}

async function pingAnthropicMessagesEndpoint(opts: {
  provider: PingEndpointOpts["provider"];
  baseUrl: string;
  plainKey: string;
  modelId: string;
  timeoutMs: number;
}): Promise<PingResult> {
  const { provider, baseUrl, plainKey, modelId, timeoutMs } = opts;
  const body = JSON.stringify(
    anthropicAdapter.transformRequest({
      model: modelId,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
  );
  const url = anthropicAdapter.buildUrl(baseUrl, {
    model: modelId,
    stream: false,
  });
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(provider, plainKey, url, body);

  const start = Date.now();
  try {
    const res = await fetch(finalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true, status: res.status, latencyMs };
    }

    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message, latencyMs };
  }
}

/** ok=true for any 2xx response; ok=false for 3xx/4xx/5xx/network errors. */
export async function pingEndpoint(opts: PingEndpointOpts): Promise<PingResult> {
  const {
    provider,
    baseUrl,
    modelsEndpointOverride,
    plainKey,
    anthropicProbeModelId,
    timeoutMs = 10_000,
  } = opts;
  const modelsUrl = buildModelsUrl(provider, baseUrl, modelsEndpointOverride);
  const { headers: authHeaders, url: finalUrl } = buildProviderAuth(provider, plainKey, modelsUrl);

  const start = Date.now();
  try {
    const res = await fetch(finalUrl, {
      headers: { "Content-Type": "application/json", ...authHeaders },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;

    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: true, status: res.status, latencyMs };
    }

    const body = await res.text().catch(() => "");
    const result = {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      latencyMs,
    };
    if (shouldFallbackToAnthropicMessageProbe(provider, result, modelsEndpointOverride)) {
      return pingAnthropicMessagesEndpoint({
        provider,
        baseUrl,
        plainKey,
        modelId: anthropicProbeModelId ?? defaultAnthropicProbeModel(provider, baseUrl),
        timeoutMs,
      });
    }
    return result;
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message, latencyMs };
  }
}
