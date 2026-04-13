/**
 * Pay Agent repository — CRUD + balance operations for the `pay_agents` table.
 */
import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";

import {
  db,
  exec,
  type NewPayAgent,
  type PayAgent,
  payAgents,
  queryAll,
  queryOne,
  returningOne,
  users,
} from "@/server/db";

const esc = (v: string) => v.replace(/[%_]/g, "\\$&");

export type PayAgentWithOwner = PayAgent & { userId: number | null; userName: string | null };

export const payAgentRepo = {
  /**
   * Fetch all pay agents with optional filters.
   * Joins with users table to include owner info and enable userName filtering at DB level.
   */
  async findAll(
    limit = 200,
    offset = 0,
    filters?: { address?: string; userName?: string },
  ): Promise<PayAgentWithOwner[]> {
    const conditions = [];
    if (filters?.address) conditions.push(ilike(payAgents.address, `%${esc(filters.address)}%`));
    if (filters?.userName) conditions.push(ilike(users.name, `%${esc(filters.userName)}%`));

    const rows = await queryAll(
      db
        .select({
          id: payAgents.id,
          name: payAgents.name,
          description: payAgents.description,
          address: payAgents.address,
          privateKey: payAgents.privateKey,
          type: payAgents.type,
          balance: payAgents.balance,
          status: payAgents.status,
          perPayLimit: payAgents.perPayLimit,
          dailyLimit: payAgents.dailyLimit,
          monthlyLimit: payAgents.monthlyLimit,
          defaultMarkupPercent: payAgents.defaultMarkupPercent,
          lastSyncBlock: payAgents.lastSyncBlock,
          updatedAt: payAgents.updatedAt,
          createdAt: payAgents.createdAt,
          userId: users.id,
          userName: users.name,
        })
        .from(payAgents)
        .leftJoin(users, eq(users.agentId, payAgents.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(payAgents.createdAt))
        .limit(limit)
        .offset(offset),
    );

    return rows as PayAgentWithOwner[];
  },

  async findById(id: number): Promise<PayAgent | undefined> {
    return queryOne(db.select().from(payAgents).where(eq(payAgents.id, id)));
  },

  async create(data: NewPayAgent): Promise<PayAgent> {
    return returningOne(db.insert(payAgents).values(data));
  },

  async update(id: number, data: Partial<PayAgent>): Promise<PayAgent | undefined> {
    return returningOne(
      db
        .update(payAgents)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(payAgents.id, id)),
    );
  },

  /**
   * Atomic debit — decrements balance only if sufficient funds exist.
   * Returns the updated pay agent on success, undefined if insufficient balance.
   */
  async debitBalance(id: number, amount: string): Promise<PayAgent | undefined> {
    return queryOne<PayAgent>(
      db
        .update(payAgents)
        .set({
          balance: sql`CAST(CAST(${payAgents.balance} AS NUMERIC) - CAST(${amount} AS NUMERIC) AS TEXT)`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payAgents.id, id),
            sql`CAST(${payAgents.balance} AS NUMERIC) >= CAST(${amount} AS NUMERIC)`,
          ),
        )
        .returning(),
    );
  },

  /**
   * Atomic withdraw-all — sets balance to '0' and returns the previous balance.
   * Uses a CTE to capture the old balance before the UPDATE. No race condition.
   * Returns undefined if current balance is 0.
   */
  async debitAll(id: number): Promise<{ debitedAmount: string } | undefined> {
    const rows = await db.execute(
      sql`WITH old AS (
            SELECT id, balance AS debited_amount
            FROM pay_agents
            WHERE id = ${id} AND CAST(balance AS NUMERIC) > 0
            FOR UPDATE
          )
          UPDATE pay_agents
          SET balance = '0', updated_at = NOW()
          FROM old
          WHERE pay_agents.id = old.id
          RETURNING old.debited_amount`,
    );
    const row = rows.rows[0] as { debited_amount: string } | undefined;
    if (!row) return undefined;
    return { debitedAmount: row.debited_amount };
  },

  /**
   * Atomic credit — increments balance and auto-reactivates suspended agents.
   *
   * When an agent is auto-suspended due to balance exhaustion, crediting
   * restores it to "active" so the owner doesn't need a manual admin action.
   */
  async creditBalance(id: number, amount: string): Promise<PayAgent> {
    return returningOne(
      db
        .update(payAgents)
        .set({
          balance: sql`CAST(CAST(${payAgents.balance} AS NUMERIC) + CAST(${amount} AS NUMERIC) AS TEXT)`,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(payAgents.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(payAgents).where(eq(payAgents.id, id)));
  },

  /** Set balance to an absolute value (for on-chain sync). */
  async setBalance(id: number, balance: string): Promise<PayAgent | undefined> {
    return returningOne(
      db.update(payAgents).set({ balance, updatedAt: new Date() }).where(eq(payAgents.id, id)),
    );
  },

  /** Update the last synced block number. */
  async updateLastSyncBlock(id: number, blockNumber: number): Promise<void> {
    await exec(
      db
        .update(payAgents)
        .set({ lastSyncBlock: blockNumber, updatedAt: new Date() })
        .where(eq(payAgents.id, id)),
    );
  },

  /** Find all active pay agents (for sync job). */
  async findAllActive(): Promise<PayAgent[]> {
    return queryAll(db.select().from(payAgents).where(eq(payAgents.status, "active")));
  },

  /** Find all active pay agents that have a wallet address (for deposit scanning). */
  async findAllWithAddress(): Promise<PayAgent[]> {
    return queryAll(
      db
        .select()
        .from(payAgents)
        .where(and(eq(payAgents.status, "active"), isNotNull(payAgents.address))),
    );
  },
};
