/**
 * SSE consumer — routes domain events to browser SSE push.
 *
 * Scope: BROADCAST — runs on ALL instances because browsers may be
 * connected to any server instance behind a load balancer.
 */
import { emitBroadcastEvent, emitScopedEvent } from "@/server/lib/sse";

import type { EventBus } from "../event-bus";

export function registerSseConsumer(bus: EventBus): void {
  bus.on(
    "*",
    (event) => {
      const ssePayload = { type: event.type, data: event.data };
      if (event.scope) {
        emitScopedEvent(event.scope, ssePayload);
      } else {
        emitBroadcastEvent(ssePayload);
      }
    },
    "broadcast",
  );
}
