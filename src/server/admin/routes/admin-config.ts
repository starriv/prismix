import { Hono } from "hono";
import { z } from "zod";

import type { NotificationConfig } from "@/server/db";
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
import { decrypt, encrypt } from "@/server/lib/crypto";
import {
  getGatewayConfigCached,
  initGatewayConfig,
  resolveTimeoutConfig,
  saveGatewayConfigSection,
} from "@/server/lib/gateway-config";
import { log } from "@/server/lib/logger";
import {
  getChannelConfig,
  getNotificationProviderConfigCached,
  isChannelEnabled,
  type NotificationProvidersConfig,
  saveNotificationProviderConfig,
} from "@/server/lib/notification-provider-config";
import { ok } from "@/server/lib/response";
import { parseBody, parsePaginationLimit, parsePaginationOffset } from "@/server/lib/validate";
import { getWriteQueueStats } from "@/server/lib/write-queue";
import type { ChannelType, NotificationPayload } from "@/server/messaging/notifications";
import { getChannel, listChannels } from "@/server/messaging/notifications";
import {
  listNotificationEventGroups,
  listNotificationEventTypes,
} from "@/server/messaging/notifications/events";
import { getRateLimiterStats } from "@/server/middleware/rate-limiter";
import { notificationConfigRepo, notificationLogRepo } from "@/server/repos";

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
    if (body.timeouts)
      await saveGatewayConfigSection("timeouts", resolveTimeoutConfig(body.timeouts));
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
const NOTIFICATION_SECRET_DOMAIN_TAG = "notification-provider-config";

const notificationChannelSchema = z.enum(["email", "telegram", "webhook", "whatsapp"]);

const notificationEventsSchema = z
  .array(z.string().min(1))
  .min(1, "At least one event is required")
  .refine(
    (events) => events.every((event) => listNotificationEventTypes().includes(event)),
    "Unknown notification event",
  );

const createNotificationConfigBody = z.object({
  channel: notificationChannelSchema,
  label: z.string().max(100).default(""),
  target: z.string().min(1, "Target is required").max(500),
  secret: z.string().max(500).optional(),
  events: notificationEventsSchema,
  enabled: z.boolean().default(true),
});

const updateNotificationConfigBody = z.object({
  label: z.string().max(100).optional(),
  target: z.string().min(1, "Target is required").max(500).optional(),
  secret: z.string().max(500).optional(),
  events: notificationEventsSchema.optional(),
  enabled: z.boolean().optional(),
});

function parseNotificationEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((event): event is string => typeof event === "string")
      : [];
  } catch {
    return [];
  }
}

function serializeNotificationConfig(config: NotificationConfig) {
  return {
    ...config,
    secret: config.secret ? "****" : null,
    events: parseNotificationEvents(config.events),
  };
}

function encryptNotificationSecret(secret: string | undefined): string | null {
  if (!secret || secret === "****") return null;
  return encrypt(secret, NOTIFICATION_SECRET_DOMAIN_TAG);
}

function decryptNotificationSecret(secret: string | null): string | undefined {
  if (!secret) return undefined;
  try {
    return decrypt(secret, NOTIFICATION_SECRET_DOMAIN_TAG);
  } catch {
    return secret;
  }
}

function getAvailableNotificationChannels(): ChannelType[] {
  return listChannels()
    .map((channel) => channel.name)
    .filter((channel) => isChannelEnabled(channel));
}

function validateNotificationTarget(channel: ChannelType, target: string): string | null {
  const registered = getChannel(channel);
  if (!registered) return `Channel "${channel}" is not registered`;
  return registered.validateTarget(target);
}

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

// GET /notification-events — event registry + globally enabled channels
router.get("/notification-events", (c) => {
  return ok(c, {
    groups: listNotificationEventGroups(),
    enabledChannels: getAvailableNotificationChannels(),
  });
});

// GET /notification-configs — configured notification routes
router.get("/notification-configs", async (c) => {
  const configs = await notificationConfigRepo.findAll();
  return ok(c, configs.map(serializeNotificationConfig));
});

// POST /notification-configs — create notification route
router.post("/notification-configs", async (c) => {
  const parsed = await parseBody(c, createNotificationConfigBody);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const channel = body.channel as ChannelType;

  if (!getAvailableNotificationChannels().includes(channel)) {
    return c.json({ error: `Notification channel "${channel}" is not enabled` }, 400);
  }

  const targetError = validateNotificationTarget(channel, body.target);
  if (targetError) return c.json({ error: targetError }, 400);

  const created = await notificationConfigRepo.create({
    channel,
    label: body.label,
    target: body.target,
    secret: channel === "webhook" ? encryptNotificationSecret(body.secret) : null,
    events: JSON.stringify(body.events),
    enabled: body.enabled,
  });

  return ok(c, serializeNotificationConfig(created), 201);
});

// PUT /notification-configs/:id — update notification route
router.put("/notification-configs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const existing = await notificationConfigRepo.findById(id);
  if (!existing) return c.json({ error: "Notification config not found" }, 404);

  const parsed = await parseBody(c, updateNotificationConfigBody);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const channel = existing.channel as ChannelType;
  const updates: Partial<NotificationConfig> = {};

  if (body.label !== undefined) updates.label = body.label;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.events !== undefined) updates.events = JSON.stringify(body.events);

  if (body.target !== undefined) {
    const targetError = validateNotificationTarget(channel, body.target);
    if (targetError) return c.json({ error: targetError }, 400);
    updates.target = body.target;
  }

  if (body.secret !== undefined && body.secret !== "****") {
    updates.secret = channel === "webhook" ? encryptNotificationSecret(body.secret) : null;
  }

  const updated = await notificationConfigRepo.update(id, updates);
  if (!updated) return c.json({ error: "Notification config not found" }, 404);

  return ok(c, serializeNotificationConfig(updated));
});

// DELETE /notification-configs/:id — delete notification route
router.delete("/notification-configs/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const existing = await notificationConfigRepo.findById(id);
  if (!existing) return c.json({ error: "Notification config not found" }, 404);

  await notificationConfigRepo.delete(id);
  return ok(c, { success: true });
});

// POST /notification-configs/:id/test — send a test notification to one route
router.post("/notification-configs/:id/test", async (c) => {
  const id = Number(c.req.param("id"));
  if (Number.isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

  const config = await notificationConfigRepo.findById(id);
  if (!config) return c.json({ error: "Notification config not found" }, 404);

  const channel = config.channel as ChannelType;
  const registered = getChannel(channel);
  if (!registered) {
    return ok(c, { success: false, message: `Channel "${channel}" is not registered` });
  }
  if (!isChannelEnabled(channel)) {
    return ok(c, { success: false, message: `Channel "${channel}" is not enabled` });
  }

  const targetError = registered.validateTarget(config.target);
  if (targetError) return ok(c, { success: false, message: targetError });

  const payload: NotificationPayload = {
    event: "notification.test",
    title: "Prismix test notification",
    body: "This is a test notification from Prismix.",
    metadata: { configId: config.id },
    timestamp: Date.now(),
  };

  const logEntry = await notificationLogRepo.insert({
    configId: config.id,
    channel,
    event: payload.event,
    target: config.target,
    payload: JSON.stringify(payload),
    dedupeKey: `notification-test:${config.id}:${payload.timestamp}`,
    status: "pending",
    attempts: 0,
    createdAt: new Date(),
  });

  try {
    await registered.send(config.target, payload, {
      secret: decryptNotificationSecret(config.secret),
      providerConfig: getChannelConfig(channel),
    });
    await notificationLogRepo.updateStatus(logEntry.id, "sent", {
      attempts: 1,
      sentAt: new Date(),
    });
    return ok(c, { success: true, message: "Test notification sent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await notificationLogRepo.updateStatus(logEntry.id, "failed", {
      attempts: 1,
      lastError: message,
    });
    return ok(c, { success: false, message });
  }
});

// GET /notification-logs — notification delivery logs
router.get("/notification-logs", async (c) => {
  const event = c.req.query("event") || undefined;
  const channel = c.req.query("channel") || undefined;
  const status = c.req.query("status") || undefined;
  const limit = parsePaginationLimit(c.req.query("limit"));
  const offset = parsePaginationOffset(c.req.query("offset"));
  const filters = { event, channel, status };

  const [items, total] = await Promise.all([
    notificationLogRepo.list({ ...filters, limit, offset }),
    notificationLogRepo.count(filters),
  ]);

  return ok(c, { items, total });
});

export default router;
