/**
 * Top-up order repository — CRUD + status transitions for the `top_up_orders` table.
 */
import { and, count, desc, eq, lt } from "drizzle-orm";

import {
  db,
  exec,
  type NewTopUpOrder,
  queryAll,
  queryOne,
  returningOne,
  type TopUpOrder,
  topUpOrders,
} from "@/server/db";

export const topupOrderRepo = {
  async findById(id: number): Promise<TopUpOrder | undefined> {
    return queryOne(db.select().from(topUpOrders).where(eq(topUpOrders.id, id)));
  },

  async findByIdAndAgent(id: number, agentId: number): Promise<TopUpOrder | undefined> {
    return queryOne(
      db
        .select()
        .from(topUpOrders)
        .where(and(eq(topUpOrders.id, id), eq(topUpOrders.agentId, agentId))),
    );
  },

  async findAll(opts?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<TopUpOrder[]> {
    const conditions = [];
    if (opts?.status) conditions.push(eq(topUpOrders.status, opts.status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return queryAll(
      db
        .select()
        .from(topUpOrders)
        .where(whereClause)
        .orderBy(desc(topUpOrders.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0),
    );
  },

  async findByAgent(
    agentId: number,
    opts?: { status?: string; limit?: number; offset?: number },
  ): Promise<TopUpOrder[]> {
    const conditions = [eq(topUpOrders.agentId, agentId)];
    if (opts?.status) conditions.push(eq(topUpOrders.status, opts.status));

    return queryAll(
      db
        .select()
        .from(topUpOrders)
        .where(and(...conditions))
        .orderBy(desc(topUpOrders.createdAt))
        .limit(opts?.limit ?? 20)
        .offset(opts?.offset ?? 0),
    );
  },

  async count(status?: string): Promise<number> {
    const conditions = [];
    if (status) conditions.push(eq(topUpOrders.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(topUpOrders).where(whereClause),
    );
    return row?.total ?? 0;
  },

  async create(data: NewTopUpOrder): Promise<TopUpOrder> {
    return returningOne(db.insert(topUpOrders).values(data));
  },

  /** Confirm a pending order — set status to confirmed + update fiat amount / note / txHash. */
  async confirm(
    id: number,
    opts?: { fiatAmount?: string; note?: string; txHash?: string },
  ): Promise<TopUpOrder | undefined> {
    return returningOne(
      db
        .update(topUpOrders)
        .set({
          status: "confirmed",
          fiatAmount: opts?.fiatAmount,
          adminNote: opts?.note,
          txHash: opts?.txHash,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(topUpOrders.id, id), eq(topUpOrders.status, "pending"))),
    );
  },

  /** Find the most recent pending crypto order for a given agent + network. */
  async findPendingByAgentAndNetwork(
    agentId: number,
    network: string,
  ): Promise<TopUpOrder | undefined> {
    return queryOne(
      db
        .select()
        .from(topUpOrders)
        .where(
          and(
            eq(topUpOrders.agentId, agentId),
            eq(topUpOrders.network, network),
            eq(topUpOrders.status, "pending"),
          ),
        )
        .orderBy(desc(topUpOrders.createdAt))
        .limit(1),
    );
  },

  async findLatestPendingByAgent(agentId: number): Promise<TopUpOrder | undefined> {
    return queryOne(
      db
        .select()
        .from(topUpOrders)
        .where(and(eq(topUpOrders.agentId, agentId), eq(topUpOrders.status, "pending")))
        .orderBy(desc(topUpOrders.createdAt))
        .limit(1),
    );
  },

  /** Reject a pending order. */
  async reject(id: number, note?: string): Promise<TopUpOrder | undefined> {
    return returningOne(
      db
        .update(topUpOrders)
        .set({
          status: "rejected",
          adminNote: note,
          updatedAt: new Date(),
        })
        .where(and(eq(topUpOrders.id, id), eq(topUpOrders.status, "pending"))),
    );
  },

  /** Expire all pending orders older than the cutoff timestamp. Returns expired orders. */
  async expirePending(cutoffMs: number): Promise<TopUpOrder[]> {
    const cutoffDate = new Date(cutoffMs);
    return queryAll(
      db
        .update(topUpOrders)
        .set({
          status: "expired",
          expiredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(topUpOrders.status, "pending"), lt(topUpOrders.createdAt, cutoffDate)))
        .returning(),
    );
  },

  async deleteByAgent(agentId: number): Promise<void> {
    await exec(db.delete(topUpOrders).where(eq(topUpOrders.agentId, agentId)));
  },
};
