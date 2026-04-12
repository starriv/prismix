/**
 * Webhook delivery engine — signing, HTTP delivery, retry calculation.
 */
import crypto from "crypto";

import { truncate } from "lodash-es";

import { log } from "@/server/lib/logger";
import { checkDnsRebinding } from "@/server/lib/ssrf";

// ── Constants ────────────────────────────────────────────────────────

export const WEBHOOK_SECRET_DOMAIN_TAG = "webhook-endpoint-secret";

const MAX_RESPONSE_BODY_LENGTH = 4096;

/** Retry delays in ms: 5s, 30s, 2min, 15min, 1h */
const RETRY_DELAYS = [5_000, 30_000, 120_000, 900_000, 3_600_000];

/** Consecutive failures to auto-disable an endpoint. */
export const FAILURE_THRESHOLD = 100;

/** Private IP patterns — block SSRF. */
const PRIVATE_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
];

// ── Secret generation ────────────────────────────────────────────────

/** Generate a webhook signing secret: whsec_ + 32 random bytes base64url. */
export function generateSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

// ── Event ID ─────────────────────────────────────────────────────────

/** Generate a unique event ID: evt_ + UUID v4. */
export function generateEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

/**
 * Generate a deterministic event ID for idempotent webhook delivery.
 * Format: evt_{eventType}_{endpointId}_{timestamp}
 * Same domain event + same endpoint + same second → same ID → dedup via UNIQUE index.
 */
export function generateDeterministicEventId(
  eventType: string,
  endpointId: number,
  timestamp: number,
): string {
  const input = `${eventType}:${endpointId}:${timestamp}`;
  const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `evt_${hash}`;
}

// ── Signing ──────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 * Input: "{eventId}.{timestamp}.{body}"
 * Returns: "v1={hex}"
 */
export function signPayload(
  eventId: string,
  timestamp: number,
  body: string,
  secret: string,
): string {
  const signInput = `${eventId}.${timestamp}.${body}`;
  const hex = crypto.createHmac("sha256", secret).update(signInput).digest("hex");
  return `v1=${hex}`;
}

// ── URL validation ───────────────────────────────────────────────────

/** Validate a webhook URL. Returns error message or null if valid. */
export function validateWebhookUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "URL must use http or https protocol";
    }
    for (const pattern of PRIVATE_PATTERNS) {
      if (pattern.test(url)) {
        return "URL must not point to private/internal addresses";
      }
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}

/**
 * Deep-validate a webhook URL including DNS resolution.
 * Catches DNS rebinding attacks where a public hostname resolves to a private IP.
 */
export async function validateWebhookUrlDeep(url: string): Promise<string | null> {
  const shallow = validateWebhookUrl(url);
  if (shallow) return shallow;
  return checkDnsRebinding(url);
}

// ── Retry calculation ────────────────────────────────────────────────

/**
 * Calculate the next retry delay in ms. Returns null if max retries exceeded.
 * attempts is 0-indexed (0 = first attempt just failed, 1 = second attempt failed, etc.)
 */
export function calculateNextRetry(attempts: number): number | null {
  if (attempts >= RETRY_DELAYS.length) return null;
  return RETRY_DELAYS[attempts];
}

// ── HTTP delivery ────────────────────────────────────────────────────

export interface DeliveryResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  latencyMs: number;
  error: string | null;
}

/**
 * Deliver a webhook payload to a URL via HTTP POST.
 * Returns result with response details (does NOT throw).
 */
export async function deliverWebhook(
  url: string,
  body: string,
  eventId: string,
  eventType: string,
  secret: string,
): Promise<DeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(eventId, timestamp, body, secret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Prismix-Webhook/1.0",
    "X-Webhook-Id": eventId,
    "X-Webhook-Timestamp": String(timestamp),
    "X-Webhook-Signature": signature,
    "X-Webhook-Event": eventType,
  };

  // DNS rebinding check — re-validate at delivery time to catch hostname→private IP changes
  const dnsError = await checkDnsRebinding(url);
  if (dnsError) {
    log.webhook.warn({ url, eventId, dnsError }, "Webhook SSRF blocked at delivery time");
    return {
      success: false,
      responseStatus: null,
      responseBody: null,
      latencyMs: 0,
      error: `SSRF blocked: ${dnsError}`,
    };
  }

  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    let responseBody: string | null = null;
    try {
      const raw = await res.text();
      responseBody = truncate(raw, {
        length: MAX_RESPONSE_BODY_LENGTH,
        omission: "...[truncated]",
      });
    } catch {
      // ignore body read errors
    }

    if (res.ok) {
      return { success: true, responseStatus: res.status, responseBody, latencyMs, error: null };
    }

    return {
      success: false,
      responseStatus: res.status,
      responseBody,
      latencyMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    log.webhook.warn({ url, eventId, err: message, latencyMs }, "Webhook delivery failed");

    return {
      success: false,
      responseStatus: null,
      responseBody: null,
      latencyMs,
      error: message,
    };
  }
}
