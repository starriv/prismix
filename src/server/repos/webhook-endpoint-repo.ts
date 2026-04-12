/**
 * Webhook endpoint repository — CRUD for the `webhook_endpoints` table.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";

import {
  db,
  exec,
  type NewWebhookEndpoint,
  queryAll,
  queryOne,
  returningOne,
  type WebhookEndpoint,
  webhookEndpoints,
} from "@/server/db";

export const webhookEndpointRepo = {
  async findAll(): Promise<WebhookEndpoint[]> {
    return queryAll(db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)));
  },

  /** Find all active endpoints matching an event type. */
  async findActiveForEvent(eventType: string): Promise<WebhookEndpoint[]> {
    const endpoints = await queryAll<WebhookEndpoint>(
      db.select().from(webhookEndpoints).where(eq(webhookEndpoints.status, "active")),
    );

    return endpoints.filter((ep) => {
      try {
        const events = JSON.parse(ep.events) as string[];
        return events.some((pattern) => matchEventPattern(pattern, eventType));
      } catch {
        return false;
      }
    });
  },

  async findById(id: number): Promise<WebhookEndpoint | undefined> {
    return queryOne(db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)));
  },

  async create(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
    return returningOne(db.insert(webhookEndpoints).values(data));
  },

  async update(
    id: number,
    data: Partial<Pick<WebhookEndpoint, "url" | "description" | "events" | "status">>,
  ): Promise<WebhookEndpoint | undefined> {
    return returningOne(
      db
        .update(webhookEndpoints)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id)),
    );
  },

  async updateSecret(id: number, secret: string): Promise<WebhookEndpoint | undefined> {
    return returningOne(
      db
        .update(webhookEndpoints)
        .set({ secret, updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)));
  },

  async count(): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(webhookEndpoints),
    );
    return row?.total ?? 0;
  },

  async incrementFailure(id: number): Promise<void> {
    await exec(
      db
        .update(webhookEndpoints)
        .set({
          failureCount: sql`${webhookEndpoints.failureCount} + 1`,
          lastFailureAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(webhookEndpoints.id, id)),
    );
  },

  async resetFailure(id: number): Promise<void> {
    await exec(
      db
        .update(webhookEndpoints)
        .set({ failureCount: 0, updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id)),
    );
  },

  async disable(id: number): Promise<void> {
    await exec(
      db
        .update(webhookEndpoints)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(eq(webhookEndpoints.id, id)),
    );
  },
};

/** Match an event subscription pattern against an event type. */
export function matchEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return eventType.startsWith(pattern.slice(0, -1));
  return pattern === eventType;
}
