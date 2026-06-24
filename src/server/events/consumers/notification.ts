/**
 * Notification consumer — routes domain events to the notification dispatcher.
 *
 * Registered notification events define which domain events can be routed to channels.
 */
import { emitNotification } from "@/server/messaging/notifications/dispatcher";
import {
  buildNotificationPayload,
  listNotificationSubscriptions,
} from "@/server/messaging/notifications/events";

import type { EventBus } from "../event-bus";

export function registerNotificationConsumer(bus: EventBus): void {
  for (const pattern of listNotificationSubscriptions()) {
    // Scope: LOCAL — notifications must execute only once, on the emitting instance.
    bus.on(pattern, async (event) => {
      const payload = buildNotificationPayload(event);
      if (!payload) return;

      await emitNotification(payload.event, payload);
    });
  }
}
