/**
 * Webhook EventBus consumer — dispatches domain events to webhook endpoints.
 *
 * Scope: "local" — runs only on the emitting instance to avoid duplicate deliveries.
 * Pattern: "*" — catches all domain events, filters by endpoint subscriptions.
 *
 * Idempotency: uses deterministic eventId (hash of eventType+endpointId+timestamp)
 * + UNIQUE index on webhook_deliveries.eventId to prevent duplicate deliveries.
 */
import type { EventBus } from "@/server/events/event-bus";
import { log } from "@/server/lib/logger";
import { enqueueJob } from "@/server/lib/write-queue";

export function registerWebhookConsumer(bus: EventBus): void {
  bus.on("*", async (event) => {
    try {
      const { webhookEndpointRepo } = await import("@/server/repos");
      const { webhookDeliveryRepo } = await import("@/server/repos");
      const { generateDeterministicEventId } = await import("@/server/messaging/webhooks");

      // Find all active endpoints that subscribe to this event type
      const endpoints = await webhookEndpointRepo.findActiveForEvent(event.type);

      if (endpoints.length === 0) return;

      for (const endpoint of endpoints) {
        const eventId = generateDeterministicEventId(event.type, endpoint.id, event.timestamp);
        const payload = JSON.stringify({
          id: eventId,
          type: event.type,
          created_at: event.timestamp,
          data: event.data,
        });

        // Insert delivery record — UNIQUE(eventId) prevents duplicate deliveries
        try {
          const delivery = await webhookDeliveryRepo.insert({
            endpointId: endpoint.id,
            eventId,
            eventType: event.type,
            payload,
            status: "pending",
            attempts: 0,
            createdAt: new Date(),
          });

          // Enqueue async delivery job
          enqueueJob("webhook-deliver", {
            deliveryId: delivery.id,
            endpointId: endpoint.id,
          });
        } catch (insertErr) {
          // UNIQUE constraint violation → duplicate delivery, skip silently
          if (insertErr instanceof Error && insertErr.message.includes("UNIQUE")) {
            log.webhook.debug({ eventId }, "Duplicate webhook delivery skipped");
            continue;
          }
          throw insertErr;
        }
      }
    } catch (err) {
      log.webhook.error({ err, eventType: event.type }, "Webhook consumer error");
    }
  });
}
