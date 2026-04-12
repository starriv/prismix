/**
 * Periodic job: retry failed webhook deliveries.
 *
 * Scans for deliveries with status=pending and nextRetryAt <= now,
 * then uses CAS (compare-and-swap) to claim each delivery before enqueuing.
 * This prevents duplicate retry pickup in multi-instance deployments.
 */
import { log } from "@/server/lib/logger";
import { enqueueJob } from "@/server/lib/write-queue";

const INTERVAL_MS = 10_000; // 10 seconds

let timer: ReturnType<typeof setInterval> | null = null;

async function run() {
  try {
    const { webhookDeliveryRepo } = await import("@/server/repos");

    const pending = await webhookDeliveryRepo.findPendingRetries(new Date());
    if (pending.length === 0) return;

    let claimed = 0;
    for (const delivery of pending) {
      // CAS: atomically claim pending → processing (only one instance wins)
      const won = await webhookDeliveryRepo.claimForRetry(delivery.id);
      if (!won) continue;

      claimed++;
      enqueueJob("webhook-deliver", {
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
      });
    }

    if (claimed > 0) {
      log.webhook.info({ found: pending.length, claimed }, "Retrying webhook deliveries");
    }
  } catch (err) {
    log.webhook.error({ err }, "Failed to process webhook retries");
  }
}

/** Start the periodic retry job. Call once from bootstrap. */
export function initWebhookRetryJob(): void {
  timer = setInterval(run, INTERVAL_MS);
  log.webhook.info({ intervalMs: INTERVAL_MS }, "Webhook retry job started");
}

/** Stop the periodic retry job. Call on graceful shutdown. */
export function stopWebhookRetryJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
