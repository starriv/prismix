/**
 * Key Provider Transaction repository — revenue share ledger records.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";

import {
  db,
  type KeyProviderTransaction,
  keyProviderTransactions,
  type NewKeyProviderTransaction,
  queryAll,
  returningOne,
} from "@/server/db";

export const keyProviderTransactionRepo = {
  async insert(data: NewKeyProviderTransaction): Promise<KeyProviderTransaction> {
    return returningOne(db.insert(keyProviderTransactions).values(data));
  },

  async findByProviderId(
    providerId: number,
    limit = 50,
    offset = 0,
  ): Promise<KeyProviderTransaction[]> {
    return queryAll(
      db
        .select()
        .from(keyProviderTransactions)
        .where(eq(keyProviderTransactions.providerId, providerId))
        .orderBy(desc(keyProviderTransactions.createdAt))
        .limit(limit)
        .offset(offset),
    );
  },

  async summarizeRevenueShareByProviderAndKeyIds(
    providerId: number,
    keyIds: number[],
  ): Promise<Map<number, string>> {
    if (keyIds.length === 0) return new Map();

    const rows = await queryAll<{ keyId: number | null; totalRevenueShare: string | null }>(
      db
        .select({
          keyId: keyProviderTransactions.keyId,
          totalRevenueShare: sql<string>`COALESCE(SUM(CAST(${keyProviderTransactions.amount} AS NUMERIC)), 0)::text`,
        })
        .from(keyProviderTransactions)
        .where(
          sql`${keyProviderTransactions.providerId} = ${providerId} AND ${keyProviderTransactions.type} = 'revenue_share' AND ${inArray(keyProviderTransactions.keyId, keyIds)}`,
        )
        .groupBy(keyProviderTransactions.keyId),
    );

    return new Map(
      rows
        .filter(
          (row): row is { keyId: number; totalRevenueShare: string | null } => row.keyId != null,
        )
        .map((row) => [row.keyId, row.totalRevenueShare ?? "0"]),
    );
  },

  async totalRevenueShareByProviderId(providerId: number): Promise<string> {
    const row = await queryAll<{ totalRevenueShare: string | null }>(
      db
        .select({
          totalRevenueShare: sql<string>`COALESCE(SUM(CAST(${keyProviderTransactions.amount} AS NUMERIC)), 0)::text`,
        })
        .from(keyProviderTransactions)
        .where(
          sql`${keyProviderTransactions.providerId} = ${providerId} AND ${keyProviderTransactions.type} = 'revenue_share'`,
        )
        .limit(1),
    );

    return row[0]?.totalRevenueShare ?? "0";
  },
};
