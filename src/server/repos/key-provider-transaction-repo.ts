/**
 * Key Provider Transaction repository — revenue share ledger records.
 */
import { desc, eq } from "drizzle-orm";

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
};
