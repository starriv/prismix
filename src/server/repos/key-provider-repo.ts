/**
 * Key Provider repository — CRUD + balance operations for the `key_providers` table.
 */
import { desc, eq, sql } from "drizzle-orm";

import {
  db,
  exec,
  type KeyProvider,
  keyProviders,
  type NewKeyProvider,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const keyProviderRepo = {
  async findAll(): Promise<KeyProvider[]> {
    return queryAll(db.select().from(keyProviders).orderBy(desc(keyProviders.createdAt)));
  },

  async findById(id: number): Promise<KeyProvider | undefined> {
    return queryOne(db.select().from(keyProviders).where(eq(keyProviders.id, id)));
  },

  async create(data: NewKeyProvider): Promise<KeyProvider> {
    return returningOne(db.insert(keyProviders).values(data));
  },

  async update(id: number, data: Partial<KeyProvider>): Promise<KeyProvider | undefined> {
    return returningOne(
      db
        .update(keyProviders)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(keyProviders.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(keyProviders).where(eq(keyProviders.id, id)));
  },

  /**
   * Atomic credit — increments the provider's pending settlement balance.
   * Returns the updated provider with new balance.
   */
  async creditBalance(id: number, amount: string): Promise<KeyProvider> {
    return returningOne(
      db
        .update(keyProviders)
        .set({
          balance: sql`CAST(CAST(${keyProviders.balance} AS NUMERIC) + CAST(${amount} AS NUMERIC) AS TEXT)`,
          updatedAt: new Date(),
        })
        .where(eq(keyProviders.id, id)),
    );
  },

  /**
   * Atomic debit — decrements balance only if sufficient funds exist.
   * Used for withdrawals/settlements.
   */
  async debitBalance(id: number, amount: string): Promise<KeyProvider | undefined> {
    return queryOne<KeyProvider>(
      db
        .update(keyProviders)
        .set({
          balance: sql`CAST(CAST(${keyProviders.balance} AS NUMERIC) - CAST(${amount} AS NUMERIC) AS TEXT)`,
          updatedAt: new Date(),
        })
        .where(
          sql`${keyProviders.id} = ${id} AND CAST(${keyProviders.balance} AS NUMERIC) >= CAST(${amount} AS NUMERIC)`,
        )
        .returning(),
    );
  },

  /** Find all active key providers. */
  async findAllActive(): Promise<KeyProvider[]> {
    return queryAll(
      db
        .select()
        .from(keyProviders)
        .where(eq(keyProviders.status, "active"))
        .orderBy(desc(keyProviders.createdAt)),
    );
  },
};
