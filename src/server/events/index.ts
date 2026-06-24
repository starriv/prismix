/**
 * EventBus barrel — Redis Pub/Sub cross-instance event bus.
 *
 * Redis (REDIS_URL) is mandatory. Creates a RedisEventBus for cross-instance
 * SSE broadcast and local event dispatch.
 *
 * Registers all consumers on startup. Business code uses emit() only.
 */
import { log } from "@/server/lib/logger";
import { getRedis } from "@/server/lib/redis";

import { registerInfraConsumers } from "./consumers/infra";
import { registerNotificationConsumer } from "./consumers/notification";
import { registerSseConsumer } from "./consumers/sse";
import { registerWebhookConsumer } from "./consumers/webhook";
import type { EventBus } from "./event-bus";
import { createEvent } from "./event-bus";
import type { DomainEventType } from "./registry";

// ── Singleton ────────────────────────────────────────────────────────

let _bus: EventBus | null = null;

/** Initialize the event bus and register all consumers. Call once from bootstrap. */
export async function initEventBus(): Promise<EventBus> {
  const redis = getRedis();

  const { RedisEventBus } = await import("./redis-event-bus");
  _bus = new RedisEventBus(redis);
  log.event.info("EventBus: Redis Pub/Sub (cross-instance)");

  // Register consumers with appropriate scopes
  registerSseConsumer(_bus); // broadcast — needs to run on all instances
  registerNotificationConsumer(_bus); // local — runs only on emitting instance
  registerWebhookConsumer(_bus); // local — webhook delivery on emitting instance only

  // Cross-instance invalidation consumers (broadcast)
  registerInfraConsumers(_bus);

  return _bus;
}

/** Get the active EventBus instance. Throws if not initialized. */
export function getEventBus(): EventBus {
  if (!_bus) throw new Error("EventBus not initialized — call initEventBus() first");
  return _bus;
}

/**
 * Convenience: emit a domain event on the global bus.
 *
 * Usage:
 *   emit(DOMAIN_EVENT_TYPES.TOPUP_CONFIRMED, "user:42", { amount, txHash, ... });
 */
export function emit(
  type: DomainEventType,
  scope: string | null,
  data: Record<string, unknown> = {},
): void {
  if (!_bus) return; // Silently skip if bus not yet initialized (startup race)
  _bus.emit(createEvent(type, scope, data));
}

/** Graceful shutdown. */
export async function closeEventBus(): Promise<void> {
  await _bus?.close();
  _bus = null;
}

// Re-exports
export { createEvent } from "./event-bus";
export type { ConsumerScope, DomainEvent, EventBus, EventHandler } from "./event-bus";
export { DOMAIN_EVENT_GROUPS, DOMAIN_EVENT_TYPES } from "./registry";
export type { DomainEventDefinition, DomainEventGroup, DomainEventType } from "./registry";
