import { describe, expect, it } from "vitest";

import {
  DOMAIN_EVENT_TYPES,
  getDomainEventDefinition,
  listDomainEventGroups,
  listDomainEventTypes,
  registerDomainEvent,
} from "@/server/events/registry";
import {
  listNotificationEventGroups,
  listNotificationEventTypes,
  listNotificationSubscriptions,
} from "@/server/messaging/notifications/events";

describe("domain event registry", () => {
  it("registers every centralized event type constant", () => {
    expect(listDomainEventTypes().sort()).toEqual(Object.values(DOMAIN_EVENT_TYPES).sort());
  });

  it("exposes the notification events through the generic domain registry", () => {
    expect(listDomainEventTypes()).toEqual(expect.arrayContaining(listNotificationEventTypes()));
    expect(getDomainEventDefinition("topup.confirmed")).toMatchObject({
      type: "topup.confirmed",
      group: "topup",
      labelKey: "notif.event.topup-confirmed",
      descriptionKey: "notif.event-desc.topup-confirmed",
      scope: "user",
      version: 1,
    });
  });

  it("derives notification groups and subscriptions from domain event metadata", () => {
    const notificationGroups = listNotificationEventGroups();
    expect(
      notificationGroups.map((group) => ({
        key: group.key,
        labelKey: group.labelKey,
        events: group.events.map((event) => event.type),
      })),
    ).toEqual(
      listDomainEventGroups((definition) => !!definition.notification).map((group) => ({
        key: group.key,
        labelKey: group.labelKey,
        events: group.events,
      })),
    );
    expect(notificationGroups[0]?.events[0]).toMatchObject({
      type: "topup.requested",
      labelKey: "notif.event.topup-requested",
      descriptionKey: "notif.event-desc.topup-requested",
    });
    expect(listNotificationSubscriptions()).toContain("topup.*");
    expect(listNotificationSubscriptions()).toContain("supplier.disabled");
  });

  it("rejects duplicate and invalid event registrations", () => {
    expect(() =>
      registerDomainEvent({
        type: "topup.confirmed",
        group: "topup",
        scope: "user",
        version: 1,
      }),
    ).toThrow("already registered");

    expect(() =>
      registerDomainEvent({
        type: "bad-event-name",
        group: "bad",
        scope: "system",
        version: 1,
      }),
    ).toThrow("Invalid domain event type");
  });
});
