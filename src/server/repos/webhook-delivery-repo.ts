/**
 * Webhook delivery repository — insert + query for the `webhook_deliveries` table.
 */
import { and, count, desc, eq, lte } from "drizzle-orm";

import {
  db,
  exec,
  type NewWebhookDelivery,
  queryAll,
  queryOne,
  returningOne,
  webhookDeliveries,
  type WebhookDelivery,
} from "@/server/db";

export const webhookDeliveryRepo = {
  async insert(data: NewWebhookDelivery): Promise<WebhookDelivery> {
    return returningOne(db.insert(webhookDeliveries).values(data));
  },

  async findById(id: number): Promise<WebhookDelivery | undefined> {
    return queryOne(db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id)));
  },

  async updateStatus(
    id: number,
    status: string,
    opts?: {
      attempts?: number;
      nextRetryAt?: Date | null;
      responseStatus?: number | null;
      responseBody?: string | null;
      latencyMs?: number | null;
      lastError?: string | null;
    },
  ): Promise<void> {
    await exec(
      db
        .update(webhookDeliveries)
        .set({
          status,
          attempts: opts?.attempts,
          nextRetryAt: opts?.nextRetryAt,
          responseStatus: opts?.responseStatus,
          responseBody: opts?.responseBody,
          latencyMs: opts?.latencyMs,
          lastError: opts?.lastError,
          updatedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, id)),
    );
  },

  async listByEndpoint(
    endpointId: number,
    limit: number,
    offset: number,
  ): Promise<WebhookDelivery[]> {
    return queryAll(
      db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpointId))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(limit)
        .offset(offset),
    );
  },

  async countByEndpoint(endpointId: number): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db
        .select({ total: count() })
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.endpointId, endpointId)),
    );
    return row?.total ?? 0;
  },

  /** Find deliveries that need retry (status=pending, nextRetryAt <= now). */
  async findPendingRetries(now: Date): Promise<WebhookDelivery[]> {
    return queryAll(
      db
        .select()
        .from(webhookDeliveries)
        .where(
          and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextRetryAt, now)),
        )
        .limit(100),
    );
  },

  /**
   * CAS claim: atomically transition status from "pending" to "processing".
   * Returns true if the row was updated (i.e., this instance won the race).
   * Prevents duplicate retry pickup in multi-instance deployments.
   */
  async claimForRetry(id: number): Promise<boolean> {
    const result = await queryOne<{ updated: number }>(
      db
        .update(webhookDeliveries)
        .set({ status: "processing", updatedAt: new Date() })
        .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.status, "pending")))
        .returning({ updated: webhookDeliveries.id }),
    );
    return !!result;
  },

  async deleteByEndpoint(endpointId: number): Promise<void> {
    await exec(db.delete(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId)));
  },
};
