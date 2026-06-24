/**
 * Notification config repository — CRUD for the `notification_configs` table.
 */
import { eq, sql } from "drizzle-orm";

import {
  db,
  exec,
  type NewNotificationConfig,
  type NotificationConfig,
  notificationConfigs,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const notificationConfigRepo = {
  async findAll(): Promise<NotificationConfig[]> {
    return queryAll(db.select().from(notificationConfigs));
  },

  async findById(id: number): Promise<NotificationConfig | undefined> {
    return queryOne(db.select().from(notificationConfigs).where(eq(notificationConfigs.id, id)));
  },

  /** Find all enabled, active configs that subscribe to a given event. */
  async findByEvent(event: string): Promise<NotificationConfig[]> {
    const all = await this.findAll();
    return all.filter((c) => {
      if (!c.enabled) return false;
      if (c.status !== "active") return false;
      try {
        const events = JSON.parse(c.events) as string[];
        return events.includes(event);
      } catch {
        return false;
      }
    });
  },

  async create(data: NewNotificationConfig): Promise<NotificationConfig> {
    return returningOne(db.insert(notificationConfigs).values(data));
  },

  async update(
    id: number,
    data: Partial<NotificationConfig>,
  ): Promise<NotificationConfig | undefined> {
    return returningOne(
      db
        .update(notificationConfigs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(notificationConfigs.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(notificationConfigs).where(eq(notificationConfigs.id, id)));
  },

  async deactivate(id: number, reason: string): Promise<void> {
    await exec(
      db
        .update(notificationConfigs)
        .set({
          status: "disabled",
          failureCount: sql`${notificationConfigs.failureCount} + 1`,
          lastFailureAt: new Date(),
          disabledReason: reason,
          disabledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notificationConfigs.id, id)),
    );
  },

  async reactivate(id: number): Promise<void> {
    await exec(
      db
        .update(notificationConfigs)
        .set({
          status: "active",
          disabledReason: null,
          disabledAt: null,
          failureCount: 0,
          lastFailureAt: null,
          updatedAt: new Date(),
        })
        .where(eq(notificationConfigs.id, id)),
    );
  },
};
