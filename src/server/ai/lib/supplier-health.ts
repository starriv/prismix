/**
 * Supplier connectivity check — shared logic for health-check job + admin discover-models.
 *
 * Extracted from admin-ai-models.ts to avoid duplication between the periodic
 * health-check job and the admin "discover models" endpoint, both of which
 * ping a supplier's /models endpoint to verify connectivity.
 */
import { match } from "ts-pattern";

import type { AiProvider } from "@/server/db";

import { buildProviderAuth } from "./provider-auth";

export interface PingResult {
  ok: boolean;
  status: number;
  error?: string;
  latencyMs: number;
}

export interface PingEndpointOpts {
  provider: Pick<AiProvider, "authType" | "authConfig" | "apiFormat">;
  baseUrl: string;
  modelsEndpointOverride?: string | null;
  plainKey: string;
  timeoutMs?: number;
}

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

/** ok=true for any 2xx response; ok=false for 3xx/4xx/5xx/network errors. */
export async function pingEndpoint(opts: PingEndpointOpts): Promise<PingResult> {
  const { provider, baseUrl, modelsEndpointOverride, plainKey, timeoutMs = 10_000 } = opts;
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
    return {
      ok: false,
      status: res.status,
      error: `HTTP ${res.status}: ${body.slice(0, 200)}`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message, latencyMs };
  }
}
