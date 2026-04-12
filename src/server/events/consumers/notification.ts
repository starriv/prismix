/**
 * Notification consumer — routes domain events to the notification dispatcher.
 *
 * Maps domain events to notification events and dispatches to configured channels.
 */
import { emitNotification } from "@/server/messaging/notifications/dispatcher";

import type { DomainEvent, EventBus } from "../event-bus";

/** Domain event → notification event mapping + content builder */
interface NotificationMapping {
  /** Notification event type (stored in notification_configs.events) */
  notifEvent: string;
  /** Build notification title from domain event data */
  title: (e: DomainEvent) => string;
  /** Build notification body from domain event data */
  body: (e: DomainEvent) => string;
}

const MAPPINGS: Record<string, NotificationMapping> = {
  // ── System events → notification ──
  "system.announcement": {
    notifEvent: "system.announcement",
    title: (e) => (e.data.title as string) ?? "System Announcement",
    body: (e) => (e.data.body as string) ?? "",
  },
};

/** Domain event patterns that should trigger notifications */
const SUBSCRIPTIONS = ["topup.*", "system.announcement"];

export function registerNotificationConsumer(bus: EventBus): void {
  for (const pattern of SUBSCRIPTIONS) {
    // Scope: LOCAL — notifications must execute only once, on the emitting instance.
    bus.on(pattern, async (event) => {
      // Topup events pass through directly
      if (event.type.startsWith("topup.")) {
        await emitNotification(event.type, {
          title: `Top-up: ${event.type.split(".")[1]}`,
          body: JSON.stringify(event.data),
          metadata: event.data,
        });
        return;
      }

      // Mapped events
      const mapping = MAPPINGS[event.type];
      if (!mapping) return;

      await emitNotification(mapping.notifEvent, {
        title: mapping.title(event),
        body: mapping.body(event),
        metadata: event.data,
      });
    });
  }
}
