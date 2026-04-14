/**
 * Fiat config repository — CRUD for the `fiat_configs` table.
 */
import { asc, eq, inArray } from "drizzle-orm";

import {
  db,
  exec,
  type FiatConfig,
  fiatConfigs,
  type NewFiatConfig,
  queryAll,
  queryOne,
  returningOne,
  transaction,
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

  /** Batch fetch by ids — single query instead of N separate lookups. */
  async findByIds(ids: number[]): Promise<FiatConfig[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(fiatConfigs).where(inArray(fiatConfigs.id, ids)));
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
    await transaction(async (tx: any) => {
      const now = new Date();
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(fiatConfigs)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(fiatConfigs.id, orderedIds[i]));
      }
    });
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(fiatConfigs).where(eq(fiatConfigs.id, id)));
  },
};
