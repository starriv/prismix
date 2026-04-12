/**
 * Fiat config repository — CRUD for the `fiat_configs` table.
 */
import { asc, eq } from "drizzle-orm";

import {
  db,
  exec,
  type FiatConfig,
  fiatConfigs,
  type NewFiatConfig,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const fiatConfigRepo = {
  async findAll(): Promise<FiatConfig[]> {
    return queryAll(db.select().from(fiatConfigs).orderBy(asc(fiatConfigs.sortOrder)));
  },

  /** Find only enabled configs — used by agent public API to show payment methods. */
  async findAllEnabled(): Promise<FiatConfig[]> {
    return queryAll(
      db
        .select()
        .from(fiatConfigs)
        .where(eq(fiatConfigs.enabled, true))
        .orderBy(asc(fiatConfigs.sortOrder)),
    );
  },

  async findById(id: number): Promise<FiatConfig | undefined> {
    return queryOne(db.select().from(fiatConfigs).where(eq(fiatConfigs.id, id)));
  },

  async create(data: NewFiatConfig): Promise<FiatConfig> {
    return returningOne(db.insert(fiatConfigs).values(data));
  },

  async update(id: number, data: Partial<FiatConfig>): Promise<FiatConfig | undefined> {
    return returningOne(
      db
        .update(fiatConfigs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(fiatConfigs.id, id)),
    );
  },

  /** Batch update sort order — receives ordered array of ids. */
  async reorder(orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await exec(
        db
          .update(fiatConfigs)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(eq(fiatConfigs.id, orderedIds[i])),
      );
    }
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(fiatConfigs).where(eq(fiatConfigs.id, id)));
  },
};
