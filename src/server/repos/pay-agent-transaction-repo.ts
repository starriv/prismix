/**
 * Pay Agent transaction repository — ledger records for pay agent balance changes.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import {
  db,
  type NewPayAgentTransaction,
  type PayAgentTransaction,
  payAgentTransactions,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export interface PayAgentTransactionFilters {
  agentId?: number;
  agentIds?: number[];
  userId?: number;
  type?: string;
  source?: string;
}

export const payAgentTransactionRepo = {
  async insert(data: NewPayAgentTransaction): Promise<PayAgentTransaction> {
    return returningOne(db.insert(payAgentTransactions).values(data));
  },

  async findByAgentId(agentId: number, limit = 50, offset = 0): Promise<PayAgentTransaction[]> {
    return queryAll(
      db
        .select()
        .from(payAgentTransactions)
        .where(eq(payAgentTransactions.agentId, agentId))
        .orderBy(desc(payAgentTransactions.createdAt))
        .limit(limit)
        .offset(offset),
    );
  },

  async findFiltered(
    filters: PayAgentTransactionFilters,
    limit = 50,
    offset = 0,
  ): Promise<PayAgentTransaction[]> {
    const conditions = [];
    if (filters.agentId) conditions.push(eq(payAgentTransactions.agentId, filters.agentId));
    if (filters.agentIds?.length)
      conditions.push(inArray(payAgentTransactions.agentId, filters.agentIds));
    if (filters.userId) conditions.push(eq(payAgentTransactions.userId, filters.userId));
    if (filters.type) conditions.push(eq(payAgentTransactions.type, filters.type));
    if (filters.source) conditions.push(eq(payAgentTransactions.source, filters.source));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return queryAll(
      db
        .select()
        .from(payAgentTransactions)
        .where(whereClause)
        .orderBy(desc(payAgentTransactions.createdAt))
        .limit(limit)
        .offset(offset),
    );
  },

  async deleteByAgentId(agentId: number): Promise<void> {
    await db.delete(payAgentTransactions).where(eq(payAgentTransactions.agentId, agentId));
  },

  async findByTxHash(txHash: string): Promise<PayAgentTransaction | undefined> {
    return queryOne(
      db.select().from(payAgentTransactions).where(eq(payAgentTransactions.txHash, txHash)),
    );
  },

  async findByTxHashes(txHashes: string[]): Promise<PayAgentTransaction[]> {
    if (txHashes.length === 0) return [];
    return queryAll(
      db.select().from(payAgentTransactions).where(inArray(payAgentTransactions.txHash, txHashes)),
    );
  },

  /** Sum of spending (payments + AI usage) for a pay agent today (UTC day boundary). */
  async sumSpendingToday(agentId: number): Promise<string> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const row = await queryOne<{ total: string | null }>(
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${payAgentTransactions.amount} AS NUMERIC)), 0)`,
        })
        .from(payAgentTransactions)
        .where(
          and(
            eq(payAgentTransactions.agentId, agentId),
            sql`${payAgentTransactions.type} IN ('payment', 'ai_usage')`,
            gte(payAgentTransactions.createdAt, startOfDay),
          ),
        ),
    );
    return String(row?.total ?? "0");
  },

  /** Sum of spending (payments + AI usage) for a pay agent this month (UTC month boundary). */
  async sumSpendingThisMonth(agentId: number): Promise<string> {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const row = await queryOne<{ total: string | null }>(
      db
        .select({
          total: sql<string>`COALESCE(SUM(CAST(${payAgentTransactions.amount} AS NUMERIC)), 0)`,
        })
        .from(payAgentTransactions)
        .where(
          and(
            eq(payAgentTransactions.agentId, agentId),
            sql`${payAgentTransactions.type} IN ('payment', 'ai_usage')`,
            gte(payAgentTransactions.createdAt, startOfMonth),
          ),
        ),
    );
    return String(row?.total ?? "0");
  },
};
