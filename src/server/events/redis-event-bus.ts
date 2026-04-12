/**
 * RedisEventBus — cross-instance event bus via Redis Pub/Sub.
 *
 * Architecture:
 *   emit() -> run LOCAL handlers in-process + PUBLISH to Redis channel
 *   Redis subscriber -> receives events from OTHER instances -> run BROADCAST handlers only
 *
 * This ensures:
 *   - Notifications (local scope) execute exactly once — on the emitting instance
 *   - SSE push (broadcast scope) reaches all instances — browsers may be connected anywhere
 */
import type Redis from "ioredis";

import { log } from "@/server/lib/logger";

import type { ConsumerScope, DomainEvent, EventBus, EventHandler } from "./event-bus";

const CHANNEL = "prismix:events";

// ── Pattern-matched handler dispatch (inlined) ──────────────────────

interface HandlerEntry {
  handler: EventHandler;
  scope: ConsumerScope;
}

/**
 * Match an event type against a subscription pattern.
 * - "*"          matches everything
 * - "tx.*"       matches "tx.settled", "tx.settle-failed", etc.
 * - "tx.settled" matches only "tx.settled"
 */
export function matchPattern(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return type.startsWith(pattern.slice(0, -1)); // "tx." from "tx.*"
  }
  return pattern === type;
}

// ── RedisEventBus ───────────────────────────────────────────────────

export class RedisEventBus implements EventBus {
  private handlers = new Map<string, HandlerEntry[]>();
  private subscriber: Redis;
  private publisher: Redis;
  private closed = false;

  constructor(redis: Redis) {
    this.subscriber = redis.duplicate();
    this.publisher = redis;

    this.subscriber.subscribe(CHANNEL, (err) => {
      if (err) {
        log.event.error({ err }, "Failed to subscribe to Redis event channel");
      } else {
        log.event.info("Subscribed to Redis event channel");
      }
    });

    // On message from Redis — dispatch to BROADCAST handlers only
    // (events from OTHER instances; local handlers already ran on the emitter)
    this.subscriber.on("message", (_channel: string, message: string) => {
      if (this.closed) return;
      try {
        const event = JSON.parse(message) as DomainEvent;
        this.dispatch(event, "broadcast");
      } catch (err) {
        log.event.error({ err }, "Failed to parse Redis event message");
      }
    });
  }

  emit(event: DomainEvent): void {
    // 1. Run ALL local handlers (both local + broadcast scope) in-process
    this.dispatch(event, undefined);

    // 2. Publish to Redis so other instances run their BROADCAST handlers
    this.publisher.publish(CHANNEL, JSON.stringify(event)).catch((err) => {
      log.event.error({ err, eventType: event.type }, "Failed to publish event to Redis");
    });
  }

  on(pattern: string, handler: EventHandler, scope: ConsumerScope = "local"): void {
    const list = this.handlers.get(pattern) ?? [];
    list.push({ handler, scope });
    this.handlers.set(pattern, list);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.subscriber.unsubscribe(CHANNEL);
    await this.subscriber.quit();
    this.handlers.clear();
  }

  /** Dispatch event to matching handlers, optionally filtered by scope. */
  private dispatch(event: DomainEvent, scopeFilter: ConsumerScope | undefined): void {
    for (const [pattern, entries] of this.handlers) {
      if (matchPattern(pattern, event.type)) {
        for (const entry of entries) {
          if (scopeFilter && entry.scope !== scopeFilter) continue;
          queueMicrotask(() => {
            Promise.resolve(entry.handler(event)).catch((err) => {
              log.event.error({ err, eventType: event.type, pattern }, "Event consumer error");
            });
          });
        }
      }
    }
  }
}
