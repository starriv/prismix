import type { DomainEvent } from "./event-bus";

export const DOMAIN_EVENT_TYPES = {
  TOPUP_REQUESTED: "topup.requested",
  TOPUP_CONFIRMED: "topup.confirmed",
  TOPUP_REJECTED: "topup.rejected",
  TOPUP_EXPIRED: "topup.expired",
  TX_LARGE_AMOUNT: "tx.large-amount",
  TX_DAILY_SUMMARY: "tx.daily-summary",
  ALERT_CIRCUIT_BREAKER: "alert.circuit-breaker",
  ALERT_UPSTREAM_TIMEOUT: "alert.upstream-timeout",
  ALERT_ERROR_SPIKE: "alert.error-spike",
  ALERT_RESOURCE_DOWN: "alert.resource-down",
  SUPPLIER_DISABLED: "supplier.disabled",
  SUPPLIER_REENABLED: "supplier.reenabled",
  SYSTEM_ANNOUNCEMENT: "system.announcement",
  CONFIG_GATEWAY_UPDATED: "config.gateway-updated",
  AI_UPSTREAM_CACHE_INVALIDATED: "ai.upstream-cache-invalidated",
  AI_KEY_POOL_INVALIDATED: "ai.key-pool-invalidated",
  AGENT_CREATED: "agent.created",
  AGENT_SUSPENDED: "agent.suspended",
  CONSUMER_KEY_DELETED: "consumer-key.deleted",
} as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES];

export const DOMAIN_EVENT_GROUPS = {
  TOPUP: "topup",
  TX: "tx",
  ALERT: "alert",
  SUPPLIER: "supplier",
  SYSTEM: "system",
  CONFIG: "config",
  AI: "ai",
  AGENT: "agent",
  CONSUMER_KEY: "consumer-key",
} as const;

export type DomainEventScope = "system" | "user" | "admin" | "mixed";

export interface DomainEventNotificationPayload {
  title: string;
  body: string;
  html?: string;
  metadata?: Record<string, unknown>;
}

export interface DomainEventNotificationOptions {
  /** Defaults to true when present. */
  enabled?: boolean;
  /**
   * Domain-event subscription patterns used by notification consumers.
   * Defaults to the event type.
   */
  subscriptions?: string[];
  /** Optional mapper from event data to notification content. */
  buildPayload?: (event: DomainEvent) => DomainEventNotificationPayload;
}

export interface DomainEventDefinition {
  /** Event type in <domain>.<action> format, e.g. topup.confirmed. */
  type: string;
  /** Admin/UI grouping key. */
  group: string;
  /** Optional i18n label key for admin UIs. */
  labelKey?: string;
  /** Optional i18n description key for admin UIs. */
  descriptionKey?: string;
  /** Event scope semantics. */
  scope: DomainEventScope;
  /** Schema version for future payload migrations. */
  version: number;
  /** Notification routing metadata. Omit or set enabled=false for non-notifiable events. */
  notification?: DomainEventNotificationOptions;
}

export interface DomainEventGroup {
  key: string;
  labelKey: string;
  descriptionKey?: string;
  events: string[];
}

const EVENT_NAME_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;
const definitions = new Map<string, DomainEventDefinition>();

export function registerDomainEvent(definition: DomainEventDefinition): void {
  if (!EVENT_NAME_RE.test(definition.type)) {
    throw new Error(`Invalid domain event type: ${definition.type}`);
  }
  if (definitions.has(definition.type)) {
    throw new Error(`Domain event already registered: ${definition.type}`);
  }
  definitions.set(definition.type, {
    ...definition,
    labelKey: definition.labelKey ?? defaultEventLabelKey(definition.type),
    descriptionKey: definition.descriptionKey ?? defaultEventDescriptionKey(definition.type),
  });
}

export function getDomainEventDefinition(type: string): DomainEventDefinition | undefined {
  return definitions.get(type);
}

export function listDomainEventDefinitions(): DomainEventDefinition[] {
  return [...definitions.values()];
}

export function listDomainEventTypes(): string[] {
  return [...definitions.keys()];
}

export function listDomainEventGroups(
  filter: (definition: DomainEventDefinition) => boolean = () => true,
): DomainEventGroup[] {
  const groups = new Map<string, string[]>();
  for (const definition of definitions.values()) {
    if (!filter(definition)) continue;
    const events = groups.get(definition.group) ?? [];
    events.push(definition.type);
    groups.set(definition.group, events);
  }
  return [...groups.entries()].map(([key, events]) => ({
    key,
    labelKey: defaultGroupLabelKey(key),
    events,
  }));
}

export function isNotificationEventDefinition(definition: DomainEventDefinition): boolean {
  return !!definition.notification && definition.notification.enabled !== false;
}

function eventI18nSuffix(type: string): string {
  return type.replace(/\./g, "-");
}

function defaultEventLabelKey(type: string): string {
  return `notif.event.${eventI18nSuffix(type)}`;
}

function defaultEventDescriptionKey(type: string): string {
  return `notif.event-desc.${eventI18nSuffix(type)}`;
}

function defaultGroupLabelKey(group: string): string {
  return `notif.group.${group}`;
}

function registerBuiltInEvents(): void {
  const notifyTopup = { subscriptions: ["topup.*"] };

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TOPUP_REQUESTED,
    group: DOMAIN_EVENT_GROUPS.TOPUP,
    scope: "user",
    version: 1,
    notification: notifyTopup,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TOPUP_CONFIRMED,
    group: DOMAIN_EVENT_GROUPS.TOPUP,
    scope: "user",
    version: 1,
    notification: {
      ...notifyTopup,
      buildPayload: (event) => {
        const amount = String(event.data.amount ?? "");
        const agentName = String(event.data.agentName ?? "Unknown");
        return {
          title: `Top-up confirmed: ${amount} USDC`,
          body: `Deposit for pay agent "${agentName}" (${amount} USDC) has been confirmed on-chain.`,
          metadata: event.data,
        };
      },
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TOPUP_REJECTED,
    group: DOMAIN_EVENT_GROUPS.TOPUP,
    scope: "user",
    version: 1,
    notification: notifyTopup,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TOPUP_EXPIRED,
    group: DOMAIN_EVENT_GROUPS.TOPUP,
    scope: "user",
    version: 1,
    notification: {
      ...notifyTopup,
      buildPayload: (event) => {
        const amount = String(event.data.amount ?? "");
        const agentName = String(event.data.agentName ?? "Unknown");
        return {
          title: `Top-up order expired: ${amount} USDC`,
          body: `Top-up request for pay agent "${agentName}" (${amount} USDC) has expired after 24 hours.`,
          metadata: event.data,
        };
      },
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TX_LARGE_AMOUNT,
    group: DOMAIN_EVENT_GROUPS.TX,
    scope: "system",
    version: 1,
    notification: {},
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.TX_DAILY_SUMMARY,
    group: DOMAIN_EVENT_GROUPS.TX,
    scope: "system",
    version: 1,
    notification: {},
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.ALERT_CIRCUIT_BREAKER,
    group: DOMAIN_EVENT_GROUPS.ALERT,
    scope: "system",
    version: 1,
    notification: {},
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.ALERT_UPSTREAM_TIMEOUT,
    group: DOMAIN_EVENT_GROUPS.ALERT,
    scope: "system",
    version: 1,
    notification: {},
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.ALERT_ERROR_SPIKE,
    group: DOMAIN_EVENT_GROUPS.ALERT,
    scope: "system",
    version: 1,
    notification: {},
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.ALERT_RESOURCE_DOWN,
    group: DOMAIN_EVENT_GROUPS.ALERT,
    scope: "system",
    version: 1,
    notification: {
      buildPayload: (event) => {
        const { title, body, ...metadata } = event.data;
        return {
          title: String(title ?? "Resource down"),
          body: String(body ?? JSON.stringify(event.data)),
          metadata,
        };
      },
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.SUPPLIER_DISABLED,
    group: DOMAIN_EVENT_GROUPS.SUPPLIER,
    scope: "system",
    version: 1,
    notification: {
      buildPayload: (event) => {
        const { title, body, ...metadata } = event.data;
        return {
          title: String(title ?? `Supplier disabled: ${event.data.name ?? "Unknown"}`),
          body: String(body ?? JSON.stringify(event.data)),
          metadata,
        };
      },
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.SUPPLIER_REENABLED,
    group: DOMAIN_EVENT_GROUPS.SUPPLIER,
    scope: "system",
    version: 1,
    notification: {
      buildPayload: (event) => {
        const { title, body, ...metadata } = event.data;
        return {
          title: String(title ?? `Supplier reenabled: ${event.data.name ?? "Unknown"}`),
          body: String(body ?? JSON.stringify(event.data)),
          metadata,
        };
      },
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.SYSTEM_ANNOUNCEMENT,
    group: DOMAIN_EVENT_GROUPS.SYSTEM,
    scope: "system",
    version: 1,
    notification: {
      buildPayload: (event) => ({
        title: (event.data.title as string) ?? "System Announcement",
        body: (event.data.body as string) ?? "",
        metadata: event.data,
      }),
    },
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.CONFIG_GATEWAY_UPDATED,
    group: DOMAIN_EVENT_GROUPS.CONFIG,
    scope: "system",
    version: 1,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.AI_UPSTREAM_CACHE_INVALIDATED,
    group: DOMAIN_EVENT_GROUPS.AI,
    scope: "system",
    version: 1,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.AI_KEY_POOL_INVALIDATED,
    group: DOMAIN_EVENT_GROUPS.AI,
    scope: "system",
    version: 1,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.AGENT_CREATED,
    group: DOMAIN_EVENT_GROUPS.AGENT,
    scope: "system",
    version: 1,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.AGENT_SUSPENDED,
    group: DOMAIN_EVENT_GROUPS.AGENT,
    scope: "system",
    version: 1,
  });

  registerDomainEvent({
    type: DOMAIN_EVENT_TYPES.CONSUMER_KEY_DELETED,
    group: DOMAIN_EVENT_GROUPS.CONSUMER_KEY,
    scope: "system",
    version: 1,
  });
}

registerBuiltInEvents();
