/**
 * Webhook notification channel — sends HTTP POST with optional HMAC signature.
 * No platform-level credentials needed; fully user-configured.
 */
import crypto from "crypto";

import { log } from "@/server/lib/logger";

import type { NotificationChannel, NotificationPayload } from "../channel";

/** Private IP / localhost check — reuse pattern from upstream URL validation */
const PRIVATE_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2\d|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/0\.0\.0\.0/,
  /^https?:\/\/\[::1\]/,
];

export class WebhookChannel implements NotificationChannel {
  readonly name = "webhook" as const;

  async send(
    target: string,
    payload: NotificationPayload,
    options?: { secret?: string },
  ): Promise<void> {
    const body = JSON.stringify({
      event: payload.event,
      title: payload.title,
      body: payload.body,
      metadata: payload.metadata,
      timestamp: payload.timestamp,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Prismix-Webhook/1.0",
    };

    // HMAC-SHA256 signature if secret is provided
    if (options?.secret) {
      const signature = crypto.createHmac("sha256", options.secret).update(body).digest("hex");
      headers["X-Prismix-Signature"] = signature;
    }

    const res = await fetch(target, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (!res.ok) {
      throw new Error(`Webhook returned ${res.status}`);
    }

    log.notification.info({ target, event: payload.event }, "Webhook delivered");
  }

  validateTarget(target: string): string | null {
    try {
      const url = new URL(target);
      if (!["http:", "https:"].includes(url.protocol)) {
        return "URL must use http or https protocol";
      }
      // Block private/internal addresses
      for (const pattern of PRIVATE_PATTERNS) {
        if (pattern.test(target)) {
          return "URL must not point to private/internal addresses";
        }
      }
      return null;
    } catch {
      return "Invalid URL format";
    }
  }
}
