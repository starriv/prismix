/**
 * EventBus — Strategy interface for domain event pub/sub.
 *
 * Business code calls emit() to publish events.
 * Consumers call on() to subscribe (supports wildcard patterns).
 *
 * Implementation: RedisEventBus (cross-instance via Redis Pub/Sub).
 */

export interface DomainEvent {
  /** Event type in <domain>.<action> format, e.g. "tx.settled", "alert.circuit-breaker" */
  type: string;
  /** Event scope — null for system-level / broadcast events */
  scope: string | null;
  /** Event payload */
  data: Record<string, unknown>;
  /** Unix timestamp (ms) */
  timestamp: number;
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Consumer scope — controls where handlers run in multi-instance deployments.
 *
 * - "local":     runs ONLY on the instance that emitted the event (notifications, audit).
 *                Prevents duplicate side-effects.
 * - "broadcast": runs on ALL instances (SSE push — browser may be connected to any instance).
 */
export type ConsumerScope = "local" | "broadcast";

export interface EventBus {
  /** Publish a domain event — fire-and-forget, never blocks the caller. */
  emit(event: DomainEvent): void;

  /**
   * Subscribe to events matching a pattern.
   * Supports: exact "tx.settled", wildcard "tx.*", catch-all "*".
   * @param scope - "local" (default) runs only on emitting instance; "broadcast" runs on all instances.
   */
  on(pattern: string, handler: EventHandler, scope?: ConsumerScope): void;

  /** Graceful shutdown — flush pending events. */
  close(): Promise<void>;
}

/** Helper to create a DomainEvent with timestamp auto-filled. */
export function createEvent(
  type: string,
  scope: string | null,
  data: Record<string, unknown> = {},
): DomainEvent {
  return { type, scope, data, timestamp: Date.now() };
}
