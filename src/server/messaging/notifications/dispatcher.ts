/**
 * Notification dispatcher — event-driven notification delivery.
 *
 * Business code calls emitNotification(). The dispatcher:
 * 1. Looks up notification_configs matching the event
 * 2. Filters by globally enabled channels
 * 3. Writes notification_logs (pending)
 * 4. Enqueues async delivery via write queue
 * 5. Updates log status on success/failure with retry (max 3 attempts)
 */
import crypto from "crypto";

import { log } from "@/server/lib/logger";
import { getChannelConfig, isChannelEnabled } from "@/server/lib/notification-provider-config";
import { enqueueJob, registerWriteHandler } from "@/server/lib/write-queue";
import { notificationConfigRepo, notificationLogRepo } from "@/server/repos";

import type { ChannelType, NotificationPayload } from "./channel";
import { getChannel } from "./registry";

const MAX_ATTEMPTS = 3;
const DOMAIN_TAG = "notification-provider-config";

/** Register the notification delivery job handler. Call from bootstrap. */
export function initNotificationQueue(): void {
  registerWriteHandler("notification-deliver", async (data) => {
    const { logId, channel, target, payload, encryptedSecret } = data as {
      logId: number;
      channel: ChannelType;
      target: string;
      payload: NotificationPayload;
      encryptedSecret: string | null;
    };
    await deliverWithRetry(logId, channel, target, payload, encryptedSecret).catch((err) => {
      log.notification.error({ err, logId, channel }, "Notification delivery failed completely");
    });
  });
}

/**
 * Emit a notification event to all matching notification configs.
 */
export async function emitNotification(
  event: string,
  data: { title: string; body: string; html?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  try {
    const configs = await notificationConfigRepo.findByEvent(event);
    if (configs.length === 0) {
      await emitDefaultSupplierTelegramNotification(event, data);
      return;
    }

    for (const config of configs) {
      const channel = config.channel as ChannelType;

      // Skip if channel not globally enabled
      if (!isChannelEnabled(channel)) continue;

      const payload: NotificationPayload = {
        event,
        title: data.title,
        body: data.body,
        html: data.html,
        metadata: data.metadata,
        timestamp: Date.now(),
      };

      // Deterministic dedupeKey: hash(event + configId + timestamp-second)
      const tsSecond = Math.floor(payload.timestamp / 1000);
      const dedupeInput = `${event}:${config.id}:${tsSecond}`;
      const dedupeKey = crypto.createHash("sha256").update(dedupeInput).digest("hex").slice(0, 32);

      // Write pending log — UNIQUE(dedupeKey) prevents duplicate notifications
      let logEntry;
      try {
        logEntry = await notificationLogRepo.insert({
          configId: config.id,
          channel,
          event,
          target: config.target,
          payload: JSON.stringify(payload),
          dedupeKey,
          status: "pending",
          attempts: 0,
          createdAt: new Date(),
        });
      } catch (insertErr) {
        if (insertErr instanceof Error && insertErr.message.includes("UNIQUE")) {
          log.notification.debug({ dedupeKey, event }, "Duplicate notification skipped");
          continue;
        }
        throw insertErr;
      }

      // Enqueue async delivery as a serializable job
      enqueueJob("notification-deliver", {
        logId: logEntry.id,
        channel,
        target: config.target,
        payload,
        encryptedSecret: config.secret,
      });
    }
  } catch (err) {
    log.notification.error({ err, event }, "Failed to emit notification");
  }
}

// ── Internal ────────────────────────────────────────────────────────

async function deliverWithRetry(
  logId: number,
  channelType: ChannelType,
  target: string,
  payload: NotificationPayload,
  encryptedSecret: string | null,
): Promise<void> {
  const ch = getChannel(channelType);
  if (!ch) {
    await notificationLogRepo.updateStatus(logId, "failed", {
      lastError: `Channel "${channelType}" not registered`,
      attempts: 1,
    });
    return;
  }

  const providerConfig = getChannelConfig(channelType);

  // Decrypt webhook secret if present
  let secret: string | undefined;
  if (encryptedSecret) {
    try {
      const { decrypt: dec } = await import("@/server/lib/crypto");
      secret = dec(encryptedSecret, DOMAIN_TAG);
    } catch {
      secret = encryptedSecret;
    }
  }

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await ch.send(target, payload, { secret, providerConfig });
      await notificationLogRepo.updateStatus(logId, "sent", {
        sentAt: new Date(),
        attempts: attempt,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.notification.warn(
        { logId, channel: channelType, attempt, error: lastError },
        "Notification delivery attempt failed",
      );

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }

  // All attempts exhausted
  await notificationLogRepo.updateStatus(logId, "failed", {
    lastError,
    attempts: MAX_ATTEMPTS,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitDefaultSupplierTelegramNotification(
  event: string,
  data: { title: string; body: string; html?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  if (!event.startsWith("supplier.")) return;
  if (!isChannelEnabled("telegram")) return;

  const providerConfig = getChannelConfig("telegram");
  const chatId = providerConfig.chatId;
  if (typeof chatId !== "string" || chatId.length === 0) return;

  const payload: NotificationPayload = {
    event,
    title: data.title,
    body: data.body,
    html: data.html,
    metadata: data.metadata,
    timestamp: Date.now(),
  };

  const tsSecond = Math.floor(payload.timestamp / 1000);
  const dedupeInput = `${event}:telegram-default:${chatId}:${tsSecond}`;
  const dedupeKey = crypto.createHash("sha256").update(dedupeInput).digest("hex").slice(0, 32);

  let logEntry;
  try {
    logEntry = await notificationLogRepo.insert({
      configId: null,
      channel: "telegram",
      event,
      target: chatId,
      payload: JSON.stringify(payload),
      dedupeKey,
      status: "pending",
      attempts: 0,
      createdAt: new Date(),
    });
  } catch (insertErr) {
    if (insertErr instanceof Error && insertErr.message.includes("UNIQUE")) {
      log.notification.debug({ dedupeKey, event }, "Duplicate notification skipped");
      return;
    }
    throw insertErr;
  }

  enqueueJob("notification-deliver", {
    logId: logEntry.id,
    channel: "telegram",
    target: chatId,
    payload,
    encryptedSecret: null,
  });
}
