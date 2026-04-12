import { Hono } from "hono";

import {
  getAuthProviderConfigCached,
  saveAuthProviderConfig,
} from "@/server/lib/auth-provider-config";
import {
  discoverSamlBody,
  updateAuthProvidersBody,
  updateGatewayConfigBody,
  updateNotificationProvidersBody,
} from "@/server/lib/body-schemas";
import {
  getGatewayConfigCached,
  initGatewayConfig,
  saveGatewayConfigSection,
} from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import {
  getNotificationProviderConfigCached,
  type NotificationProvidersConfig,
  saveNotificationProviderConfig,
} from "@/server/lib/notification-provider-config";
import { ok } from "@/server/lib/response";
import { parseBody } from "@/server/lib/validate";
import { getWriteQueueStats } from "@/server/lib/write-queue";
import { getRateLimiterStats } from "@/server/middleware/rate-limiter";

const router = new Hono();

// ── Auth Provider Config ─────────────────────────────────────────

// GET /auth-providers — current auth provider config (secrets masked)
router.get("/auth-providers", (c) => {
  const config = getAuthProviderConfigCached();
  // Mask secrets for API response
  const masked: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    const { clientSecret, certificate, ...rest } = val;
    masked[key] = {
      ...rest,
      clientSecret: clientSecret ? "****" : "",
      certificate: certificate ? "****" : "",
    };
  }
  return ok(c, masked);
});

// PUT /auth-providers — update auth provider config
router.put("/auth-providers", async (c) => {
  try {
    const parsed = await parseBody(c, updateAuthProvidersBody);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as Record<string, unknown>;
    const current = getAuthProviderConfigCached();

    // Merge: only update provided fields, preserve secrets if masked
    const updated = { ...current };
    for (const [key, val] of Object.entries(body)) {
      if (typeof val !== "object" || val === null) continue;
      const incoming = val as Record<string, unknown>;
      const existing = current[key] ?? { enabled: false };
      updated[key] = {
        ...existing,
        ...incoming,
        // If clientSecret is "****" or empty, keep existing value
        clientSecret:
          incoming.clientSecret && incoming.clientSecret !== "****"
            ? (incoming.clientSecret as string)
            : (existing.clientSecret ?? ""),
        // Same for SAML certificate
        certificate:
          incoming.certificate && incoming.certificate !== "****"
            ? (incoming.certificate as string)
            : (existing.certificate ?? ""),
      };
    }

    await saveAuthProviderConfig(updated);
    log.admin.info({ providers: Object.keys(updated) }, "Auth provider config updated");
    return ok(c, updated);
  } catch (e) {
    log.admin.error({ err: e }, "Failed to save auth provider config");
    return c.json({ error: "Failed to save auth provider config" }, 500);
  }
});

// POST /sso/discover-saml — fetch IdP metadata URL and extract config
router.post("/sso/discover-saml", async (c) => {
  try {
    const parsed = await parseBody(c, discoverSamlBody);
    if (!parsed.ok) return parsed.response;
    const { metadataUrl } = parsed.data;
    if (!metadataUrl?.startsWith("https://")) {
      return c.json({ error: "Metadata URL must start with https://" }, 400);
    }

    const res = await fetch(metadataUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return c.json({ error: `Failed to fetch metadata: HTTP ${res.status}` }, 502);
    }

    const xml = await res.text();

    // Parse entityID
    const entityIdMatch = xml.match(/entityID="([^"]+)"/);
    const entityId = entityIdMatch?.[1] ?? "";

    // Parse SSO URL (HTTP-Redirect or HTTP-POST binding)
    const ssoMatch =
      xml.match(/SingleSignOnService[^>]+Binding="[^"]*HTTP-Redirect"[^>]+Location="([^"]+)"/) ??
      xml.match(/SingleSignOnService[^>]+Location="([^"]+)"/);
    const ssoUrl = ssoMatch?.[1] ?? "";

    // Parse SLO URL
    const sloMatch = xml.match(/SingleLogoutService[^>]+Location="([^"]+)"/);
    const sloUrl = sloMatch?.[1] ?? "";

    // Parse X.509 certificate (first one found)
    const certMatch =
      xml.match(/<ds:X509Certificate>([^<]+)<\/ds:X509Certificate>/s) ??
      xml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/s);
    const certificate = certMatch?.[1]?.replace(/\s+/g, "") ?? "";

    return ok(c, { entityId, ssoUrl, sloUrl, certificate });
  } catch (e) {
    log.admin.error({ err: e }, "Failed to discover SAML metadata");
    return c.json({ error: "Failed to discover SAML metadata" }, 500);
  }
});

// ── Gateway Config ───────────────────────────────────────────────

// GET /gateway-config — full gateway config
router.get("/gateway-config", (c) => {
  return ok(c, getGatewayConfigCached());
});

// PUT /gateway-config — update one or more config sections
router.put("/gateway-config", async (c) => {
  try {
    const parsed = await parseBody(c, updateGatewayConfigBody);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    if (body.rateLimits) await saveGatewayConfigSection("rateLimits", body.rateLimits);
    if (body.circuitBreakers)
      await saveGatewayConfigSection("circuitBreakers", body.circuitBreakers);
    if (body.timeouts) await saveGatewayConfigSection("timeouts", body.timeouts);
    if (body.queue) await saveGatewayConfigSection("queue", body.queue);

    await initGatewayConfig();

    return ok(c, getGatewayConfigCached());
  } catch (e) {
    log.admin.error({ err: e }, "Failed to save gateway config");
    return c.json({ error: "Failed to save gateway config" }, 500);
  }
});

// GET /gateway-status — realtime status snapshot
router.get("/gateway-status", (c) => {
  return ok(c, {
    rateLimits: getRateLimiterStats(),
    queues: getWriteQueueStats(),
  });
});

// ── Notification Provider Config ─────────────────────────────────

const SECRET_FIELDS = ["smtpPass", "resendApiKey", "botToken", "apiToken"];

// GET /notification-providers — current config (secrets masked)
router.get("/notification-providers", (c) => {
  const config = getNotificationProviderConfigCached();
  // Deep clone and mask secrets
  const masked = JSON.parse(JSON.stringify(config)) as Record<string, Record<string, unknown>>;
  for (const channel of Object.values(masked)) {
    for (const field of SECRET_FIELDS) {
      if (typeof channel[field] === "string" && (channel[field] as string).length > 0) {
        channel[field] = "****";
      }
    }
  }
  return ok(c, masked);
});

// PUT /notification-providers — update config
router.put("/notification-providers", async (c) => {
  try {
    const parsed = await parseBody(c, updateNotificationProvidersBody);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data as Record<string, Record<string, unknown>>;
    const current = getNotificationProviderConfigCached();

    // Merge: preserve secrets if masked with "****"
    const updated = JSON.parse(JSON.stringify(current)) as NotificationProvidersConfig;
    for (const [key, incoming] of Object.entries(body)) {
      if (typeof incoming !== "object" || incoming === null) continue;
      const existing = (current as unknown as Record<string, Record<string, unknown>>)[key] ?? {};
      const merged = { ...existing, ...incoming };
      // Preserve existing secrets when "****" is sent back
      for (const field of SECRET_FIELDS) {
        if (merged[field] === "****" || merged[field] === "") {
          merged[field] = existing[field] ?? "";
        }
      }
      (updated as unknown as Record<string, unknown>)[key] = merged;
    }

    await saveNotificationProviderConfig(updated);
    log.admin.info({ channels: Object.keys(updated) }, "Notification provider config updated");
    return ok(c, { success: true });
  } catch (e) {
    log.admin.error({ err: e }, "Failed to save notification provider config");
    return c.json({ error: "Failed to save notification provider config" }, 500);
  }
});

export default router;
