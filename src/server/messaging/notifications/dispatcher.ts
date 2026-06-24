/**
 * Notification dispatcher — event-driven notification delivery.
 *
 * Notification consumers call emitNotification(). The dispatcher:
 * 1. Looks up notification_configs matching the event
 * 2. Filters by globally enabled channels
 * 3. Writes notification_logs (pending)
 * 4. Enqueues async delivery via write queue
 * 5. Updates log status on success/failure with retry (max 3 attempts)
 */
import crypto from "crypto";

import { AppError, ChannelDeactivatedError, RateLimitError } from "@/server/lib/errors";
import { log } from "@/server/lib/logger";
import { getChannelConfig, isChannelEnabled } from "@/server/lib/notification-provider-config";
import { enqueueJob, registerWriteHandler } from "@/server/lib/write-queue";
import { notificationConfigRepo, notificationLogRepo } from "@/server/repos";

import type { ChannelType, NotificationPayload } from "./channel";
import { getChannel } from "./registry";

const MAX_ATTEMPTS = 3;
const MAX_RATE_LIMIT_DELAY_MS = 5 * 60 * 1000;
const DOMAIN_TAG = "notification-provider-config";

interface NotificationDeliveryJob extends Record<string, unknown> {
  logId: number;
  channel: ChannelType;
  target: string;
  payload: NotificationPayload;
  encryptedSecret: string | null;
  configId?: number | null;
  attempt?: number;
}

/** Register the notification delivery job handler. Call from bootstrap. */
export function initNotificationQueue(): void {
  registerWriteHandler("notification-deliver", async (data) => {
    const job = data as unknown as NotificationDeliveryJob;
    await deliverWithRetry(job).catch((err) => {
      log.notification.error(
        { err, logId: job.logId, channel: job.channel },
        "Notification delivery failed completely",
      );
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
    if (configs.length === 0) return;

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
      const job: NotificationDeliveryJob = {
        logId: logEntry.id,
        channel,
        target: config.target,
        payload,
        encryptedSecret: config.secret,
        configId: config.id,
      };
      enqueueJob("notification-deliver", job);
    }
  } catch (err) {
    log.notification.error({ err, event }, "Failed to emit notification");
  }
}

// ── Internal ────────────────────────────────────────────────────────

async function deliverWithRetry(job: NotificationDeliveryJob): Promise<void> {
  const { logId, channel: channelType, target, payload, encryptedSecret } = job;
  const configId = job.configId ?? null;
  const startAttempt = normalizeAttempt(job.attempt);
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
  for (let attempt = startAttempt; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await ch.send(target, payload, { secret, providerConfig });
      await notificationLogRepo.updateStatus(logId, "sent", {
        sentAt: new Date(),
        attempts: attempt,
      });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);

      if (err instanceof RateLimitError) {
        const retryDelayMs = getRateLimitRetryDelayMs(err.retryAfterMs, attempt);
        log.notification.warn(
          {
            logId,
            channel: channelType,
            attempt,
            retryAfterMs: retryDelayMs,
          },
          "Rate limited, scheduling delayed retry",
        );
        if (attempt < MAX_ATTEMPTS) {
          enqueueJob(
            "notification-deliver",
            {
              ...job,
              configId,
              attempt: attempt + 1,
            },
            { delayMs: retryDelayMs },
          );
          await notificationLogRepo.updateStatus(logId, "pending", {
            lastError: `RATE_LIMITED: ${lastError}`,
            attempts: attempt,
          });
          return;
        }
        continue;
      }

      if (err instanceof ChannelDeactivatedError) {
        log.notification.warn(
          { logId, channel: channelType, target: err.target, reason: lastError },
          "Channel target permanently unavailable — deactivating config",
        );
        if (configId !== null) {
          await notificationConfigRepo.deactivate(configId, lastError).catch((deactErr) => {
            log.notification.error({ err: deactErr, configId }, "Failed to deactivate config");
          });
        }
        await notificationLogRepo.updateStatus(logId, "failed", {
          lastError: `DEACTIVATED: ${lastError}`,
          attempts: attempt,
        });
        return;
      }

      if (err instanceof AppError && err.status === 400) {
        log.notification.warn(
          { logId, channel: channelType, attempt, error: lastError },
          "Permanent bad request — not retrying",
        );
        await notificationLogRepo.updateStatus(logId, "failed", {
          lastError: `PERMANENT: ${lastError}`,
          attempts: attempt,
        });
        return;
      }

      log.notification.warn(
        { logId, channel: channelType, attempt, error: lastError },
        "Notification delivery attempt failed",
      );

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

function normalizeAttempt(attempt: number | undefined): number {
  if (attempt === undefined || !Number.isInteger(attempt) || attempt < 1) return 1;
  return Math.min(attempt, MAX_ATTEMPTS);
}

function getRateLimitRetryDelayMs(retryAfterMs: number | undefined, attempt: number): number {
  const fallbackMs = 1000 * 2 ** (attempt - 1);
  const requestedMs = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : fallbackMs;
  return Math.min(requestedMs, MAX_RATE_LIMIT_DELAY_MS);
}
