/**
 * Withdraw order repository — CRUD + status transitions for the `withdraw_orders` table.
 */
import { and, count, desc, eq, getTableColumns, ne } from "drizzle-orm";

import {
  db,
  exec,
  type NewWithdrawOrder,
  queryAll,
  queryOne,
  returningOne,
  users,
  type WithdrawOrder,
  withdrawOrders,
} from "@/server/db";

export type WithdrawOrderWithUser = WithdrawOrder & { userUuid: string | null };

export const withdrawOrderRepo = {
  async create(data: NewWithdrawOrder): Promise<WithdrawOrder> {
    return returningOne(db.insert(withdrawOrders).values(data));
  },

  async findById(id: number): Promise<WithdrawOrder | undefined> {
    return queryOne(db.select().from(withdrawOrders).where(eq(withdrawOrders.id, id)));
  },

  async findByIdAndUser(id: number, userId: number): Promise<WithdrawOrder | undefined> {
    return queryOne(
      db
        .select()
        .from(withdrawOrders)
        .where(and(eq(withdrawOrders.id, id), eq(withdrawOrders.userId, userId))),
    );
  },

  async findByUser(
    userId: number,
    opts?: { excludeStatus?: string; limit?: number; offset?: number },
  ): Promise<WithdrawOrder[]> {
    const conditions = [eq(withdrawOrders.userId, userId)];
    if (opts?.excludeStatus) conditions.push(ne(withdrawOrders.status, opts.excludeStatus));

    return queryAll(
      db
        .select()
        .from(withdrawOrders)
        .where(and(...conditions))
        .orderBy(desc(withdrawOrders.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0),
    );
  },

  async findAll(opts?: {
    status?: string;
    userUuid?: string;
    limit?: number;
    offset?: number;
  }): Promise<WithdrawOrderWithUser[]> {
    const conditions = [];
    if (opts?.status) conditions.push(eq(withdrawOrders.status, opts.status));
    if (opts?.userUuid) conditions.push(eq(users.uuid, opts.userUuid));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    return queryAll(
      db
        .select({ ...getTableColumns(withdrawOrders), userUuid: users.uuid })
        .from(withdrawOrders)
        .leftJoin(users, eq(withdrawOrders.userId, users.id))
        .where(whereClause)
        .orderBy(desc(withdrawOrders.createdAt))
        .limit(opts?.limit ?? 50)
        .offset(opts?.offset ?? 0),
    );
  },

  async findByAgent(agentId: number, limit?: number, offset?: number): Promise<WithdrawOrder[]> {
    return queryAll(
      db
        .select()
        .from(withdrawOrders)
        .where(eq(withdrawOrders.agentId, agentId))
        .orderBy(desc(withdrawOrders.createdAt))
        .limit(limit ?? 50)
        .offset(offset ?? 0),
    );
  },

  async updateStatus(
    id: number,
    status: string,
    opts?: { txHash?: string; failReason?: string; reviewedBy?: number },
  ): Promise<WithdrawOrder | undefined> {
    const now = new Date();
    return returningOne(
      db
        .update(withdrawOrders)
        .set({
          status,
          txHash: opts?.txHash,
          failReason: opts?.failReason,
          ...(opts?.reviewedBy != null && { reviewedBy: opts.reviewedBy, reviewedAt: now }),
          updatedAt: now,
        })
        .where(eq(withdrawOrders.id, id)),
    );
  },

  async count(status?: string): Promise<number> {
    const conditions = [];
    if (status) conditions.push(eq(withdrawOrders.status, status));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(withdrawOrders).where(whereClause),
    );
    return row?.total ?? 0;
  },

  async deleteByAgent(agentId: number): Promise<void> {
    await exec(db.delete(withdrawOrders).where(eq(withdrawOrders.agentId, agentId)));
  },
};
