import { initBlockchainConfig } from "@/blockchain/config";
import { initAiRelay } from "@/server/ai";
import { initDb } from "@/server/db";
import { initSupplierHealthCheckJob } from "@/server/jobs/check-supplier-health";
import { initLimitedFreeModelExpiryJob } from "@/server/jobs/expire-limited-free-models";
import { initLiteLLMPricingJob } from "@/server/jobs/refresh-litellm-pricing";
import { initDepositScanQueue } from "@/server/jobs/scan-topup-deposit";
import { initWebhookRetryJob } from "@/server/messaging/jobs/retry-webhook-deliveries";
import { initNotificationQueue } from "@/server/messaging/notifications/dispatcher";
// register all notification channels (email, telegram, webhook)
import "@/server/messaging/notifications/index";

// register auth strategies (siwe, credentials, google, github)
import "../auth/index";
import { initEventBus } from "../events";
import { initTopupExpiryJob } from "../jobs/expire-topup-orders";
import { initAuthProviderConfig } from "./auth-provider-config";
import { getGatewayConfigCached, initGatewayConfig } from "./gateway-config";
import { cleanExpiredRefreshTokens, initJwtSecret } from "./jwt";
import { log } from "./logger";
import { initNotificationProviderConfig } from "./notification-provider-config";
import { initRedis } from "./redis";
import { initWriteQueue, registerWriteHandler } from "./write-queue";

function initApiKeyTouchQueue(): void {
  registerWriteHandler("api-key-touch", async (data) => {
    const { apiKeyRepo } = await import("@/server/repos");
    await apiKeyRepo.updateLastUsed(data.apiKeyId as number);
  });
}

function initWebhookDeliveryHandler(): void {
  registerWriteHandler("webhook-deliver", async (data) => {
    const { webhookDeliveryRepo, webhookEndpointRepo } = await import("@/server/repos");
    const { deliverWebhook, calculateNextRetry, FAILURE_THRESHOLD, WEBHOOK_SECRET_DOMAIN_TAG } =
      await import("@/server/messaging/webhooks");
    const { decrypt } = await import("@/server/lib/crypto");

    const deliveryId = data.deliveryId as number;
    const endpointId = data.endpointId as number;

    const delivery = await webhookDeliveryRepo.findById(deliveryId);
    const endpoint = await webhookEndpointRepo.findById(endpointId);
    if (!delivery || !endpoint) return;

    // Decrypt the secret for signing
    let secret: string;
    try {
      secret = decrypt(endpoint.secret, WEBHOOK_SECRET_DOMAIN_TAG);
    } catch {
      log.webhook.error({ endpointId }, "Failed to decrypt webhook secret");
      await webhookDeliveryRepo.updateStatus(deliveryId, "failed", {
        lastError: "Secret decryption failed",
        attempts: delivery.attempts + 1,
      });
      return;
    }

    const result = await deliverWebhook(
      endpoint.url,
      delivery.payload,
      delivery.eventId,
      delivery.eventType,
      secret,
    );

    const newAttempts = delivery.attempts + 1;

    if (result.success) {
      await webhookDeliveryRepo.updateStatus(deliveryId, "success", {
        attempts: newAttempts,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        latencyMs: result.latencyMs,
      });
      await webhookEndpointRepo.resetFailure(endpointId);
    } else {
      const retryDelay = calculateNextRetry(delivery.attempts);
      const nextRetryAt = retryDelay ? new Date(Date.now() + retryDelay) : null;
      const finalStatus = retryDelay ? "pending" : "failed";

      await webhookDeliveryRepo.updateStatus(deliveryId, finalStatus, {
        attempts: newAttempts,
        nextRetryAt,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        latencyMs: result.latencyMs,
        lastError: result.error,
      });
      await webhookEndpointRepo.incrementFailure(endpointId);

      // Auto-disable endpoint after too many consecutive failures
      const ep = await webhookEndpointRepo.findById(endpointId);
      if (ep && ep.failureCount >= FAILURE_THRESHOLD) {
        await webhookEndpointRepo.disable(endpointId);
        log.webhook.warn(
          { endpointId, url: ep.url },
          "Webhook endpoint auto-disabled after consecutive failures",
        );
      }
    }
  });
}

export async function bootstrap() {
  // Initialize database (lazy — creates PG pool + runs first-deploy migrations)
  await initDb();

  // Initialize JWT secret (must be before any auth operation)
  initJwtSecret();

  // Connect to Redis (mandatory — required by cache, queue, rate-limit, events)
  await initRedis();

  // Initialize blockchain config (chain config, USDC addresses, DB-backed settings)
  await initBlockchainConfig();

  // Load gateway config into memory cache (rate limits, queue depths)
  await initGatewayConfig();
  const gwConfig = getGatewayConfigCached();
  log.bootstrap.info({ rateLimits: gwConfig.rateLimits.length }, "Gateway config loaded");

  // Clean up expired refresh tokens from previous runs
  const cleaned = await cleanExpiredRefreshTokens();
  if (cleaned > 0) {
    log.bootstrap.info({ cleaned }, "Cleaned expired refresh tokens");
  }

  // Load auth provider config (which login methods are enabled)
  await initAuthProviderConfig();

  // Load notification provider config (which channels are enabled)
  await initNotificationProviderConfig();

  // Initialize job queues (must come after gateway config for maxDepth)
  await initWriteQueue();
  initNotificationQueue();
  initApiKeyTouchQueue();
  initWebhookDeliveryHandler();
  initAiRelay();
  initLiteLLMPricingJob();

  // Initialize event bus + register consumers (SSE, notification, webhook)
  await initEventBus();

  // Start periodic jobs
  initTopupExpiryJob();
  initWebhookRetryJob();
  await initDepositScanQueue();
  await initSupplierHealthCheckJob();
  await initLimitedFreeModelExpiryJob();
}
