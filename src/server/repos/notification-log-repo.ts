/**
 * Notification log repository — CRUD for the `notification_logs` table.
 */
import { and, count, desc, eq } from "drizzle-orm";

import {
  db,
  exec,
  type NewNotificationLog,
  type NotificationLog,
  notificationLogs,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export interface NotificationLogFilters {
  event?: string;
  channel?: string;
  status?: string;
  limit: number;
  offset: number;
}

function buildNotificationLogConditions(
  filters?: Partial<Pick<NotificationLogFilters, "event" | "channel" | "status">>,
) {
  const conditions = [];
  if (filters?.event) conditions.push(eq(notificationLogs.event, filters.event));
  if (filters?.channel) conditions.push(eq(notificationLogs.channel, filters.channel));
  if (filters?.status) conditions.push(eq(notificationLogs.status, filters.status));
  return conditions;
}

export const notificationLogRepo = {
  async insert(data: NewNotificationLog): Promise<NotificationLog> {
    return returningOne(db.insert(notificationLogs).values(data));
  },

  async updateStatus(
    id: number,
    status: string,
    opts?: { lastError?: string; sentAt?: Date; attempts?: number },
  ): Promise<void> {
    await exec(
      db
        .update(notificationLogs)
        .set({
          status,
          lastError: opts?.lastError,
          sentAt: opts?.sentAt,
          attempts: opts?.attempts,
          updatedAt: new Date(),
        })
        .where(eq(notificationLogs.id, id)),
    );
  },

  async list(filters: NotificationLogFilters): Promise<NotificationLog[]> {
    const conditions = buildNotificationLogConditions(filters);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return queryAll(
      db
        .select()
        .from(notificationLogs)
        .where(whereClause)
        .orderBy(desc(notificationLogs.createdAt))
        .limit(filters.limit)
        .offset(filters.offset),
    );
  },

  async count(
    filters?: Partial<Pick<NotificationLogFilters, "event" | "channel" | "status">>,
  ): Promise<number> {
    const conditions = buildNotificationLogConditions(filters);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(notificationLogs).where(whereClause),
    );
    return row?.total ?? 0;
  },
};
