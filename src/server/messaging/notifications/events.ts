import type { DomainEvent } from "@/server/events/event-bus";
import {
  type DomainEventDefinition,
  getDomainEventDefinition,
  isNotificationEventDefinition,
  listDomainEventDefinitions,
} from "@/server/events/registry";

import type { NotificationPayload } from "./channel";

export interface NotificationEventOption {
  type: string;
  labelKey: string;
  descriptionKey?: string;
}

export interface NotificationEventGroup {
  key: string;
  labelKey: string;
  descriptionKey?: string;
  events: NotificationEventOption[];
}

export type NotificationEventPayload = Omit<NotificationPayload, "timestamp">;

export function listNotificationEventTypes(): string[] {
  return listDomainEventDefinitions()
    .filter(isNotificationEventDefinition)
    .map((definition) => definition.type);
}

export function listNotificationEventGroups(): NotificationEventGroup[] {
  const groups = new Map<string, NotificationEventGroup>();

  for (const definition of listDomainEventDefinitions().filter(isNotificationEventDefinition)) {
    const group = groups.get(definition.group) ?? {
      key: definition.group,
      labelKey: `notif.group.${definition.group}`,
      events: [],
    };
    group.events.push(toNotificationEventOption(definition));
    groups.set(definition.group, group);
  }

  return [...groups.values()];
}

export function listNotificationSubscriptions(): string[] {
  const subscriptions = new Set<string>();
  for (const definition of listDomainEventDefinitions().filter(isNotificationEventDefinition)) {
    for (const subscription of definition.notification?.subscriptions ?? [definition.type]) {
      subscriptions.add(subscription);
    }
  }
  return [...subscriptions];
}

export function buildNotificationPayload(event: DomainEvent): NotificationEventPayload | null {
  const definition = getDomainEventDefinition(event.type);
  if (!definition || !isNotificationEventDefinition(definition)) return null;

  const payload = definition.notification?.buildPayload?.(event) ?? {
    title: defaultTitle(event.type),
    body: JSON.stringify(event.data),
    metadata: event.data,
  };

  return {
    event: definition.type,
    ...payload,
    metadata: payload.metadata ?? event.data,
  };
}

function defaultTitle(type: string): string {
  const [domain, action] = type.split(".");
  if (!domain || !action) return type;
  return `${domain}: ${action}`;
}

function toNotificationEventOption(definition: DomainEventDefinition): NotificationEventOption {
  return {
    type: definition.type,
    labelKey: definition.labelKey ?? definition.type,
    descriptionKey: definition.descriptionKey,
  };
}
