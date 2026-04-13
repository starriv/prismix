/**
 * Relay Consumer Key repository — CRUD for consumer-facing API keys.
 * Balance is managed by the linked pay-agent; this repo has no balance ops.
 */
import { and, desc, eq, getTableColumns, ilike } from "drizzle-orm";

import {
  db,
  exec,
  type NewRelayConsumerKey,
  queryAll,
  queryOne,
  type RelayConsumerKey,
  relayConsumerKeys,
  returningOne,
  users,
} from "@/server/db";

const esc = (v: string) => v.replace(/[%_]/g, "\\$&");

/** Consumer key row with the owning user's status (null for orphan keys). */
export type ConsumerKeyWithUserStatus = RelayConsumerKey & {
  userStatus: number | null;
};

/** Consumer key row joined with user name for admin list view. */
export type ConsumerKeyWithUser = RelayConsumerKey & {
  userName: string | null;
};

export const relayConsumerKeyRepo = {
  async findAllOrdered(): Promise<RelayConsumerKey[]> {
    return queryAll(db.select().from(relayConsumerKeys).orderBy(desc(relayConsumerKeys.createdAt)));
  },

  async findFiltered(
    limit = 200,
    offset = 0,
    filters?: { prefix?: string },
  ): Promise<ConsumerKeyWithUser[]> {
    const conditions = [];
    if (filters?.prefix)
      conditions.push(ilike(relayConsumerKeys.apiKeyPrefix, `%${esc(filters.prefix)}%`));

    const qb = db
      .select({ ...getTableColumns(relayConsumerKeys), userName: users.name })
      .from(relayConsumerKeys)
      .leftJoin(users, eq(relayConsumerKeys.userId, users.id));
    if (conditions.length) qb.where(and(...conditions));
    return queryAll(qb.orderBy(desc(relayConsumerKeys.createdAt)).limit(limit).offset(offset));
  },

  async findByUserId(userId: number): Promise<RelayConsumerKey[]> {
    return queryAll(
      db
        .select()
        .from(relayConsumerKeys)
        .where(eq(relayConsumerKeys.userId, userId))
        .orderBy(desc(relayConsumerKeys.createdAt)),
    );
  },

  async findById(id: number): Promise<RelayConsumerKey | undefined> {
    return queryOne(db.select().from(relayConsumerKeys).where(eq(relayConsumerKeys.id, id)));
  },

  async findByIdAndUser(id: number, userId: number): Promise<RelayConsumerKey | undefined> {
    return queryOne(
      db
        .select()
        .from(relayConsumerKeys)
        .where(and(eq(relayConsumerKeys.id, id), eq(relayConsumerKeys.userId, userId))),
    );
  },

  async findByApiKeyHash(hash: string): Promise<ConsumerKeyWithUserStatus | undefined> {
    return queryOne(
      db
        .select({ ...getTableColumns(relayConsumerKeys), userStatus: users.status })
        .from(relayConsumerKeys)
        .leftJoin(users, eq(relayConsumerKeys.userId, users.id))
        .where(eq(relayConsumerKeys.apiKeyHash, hash)),
    );
  },

  async create(data: NewRelayConsumerKey): Promise<RelayConsumerKey> {
    return returningOne(db.insert(relayConsumerKeys).values(data));
  },

  async update(
    id: number,
    userId: number,
    data: Partial<RelayConsumerKey>,
  ): Promise<RelayConsumerKey | undefined> {
    return returningOne(
      db
        .update(relayConsumerKeys)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(relayConsumerKeys.id, id), eq(relayConsumerKeys.userId, userId))),
    );
  },

  async updateLastUsed(id: number): Promise<void> {
    await exec(
      db
        .update(relayConsumerKeys)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(relayConsumerKeys.id, id)),
    );
  },

  async updateStatus(id: number, status: string): Promise<void> {
    await exec(
      db
        .update(relayConsumerKeys)
        .set({ status, updatedAt: new Date() })
        .where(eq(relayConsumerKeys.id, id)),
    );
  },

  async delete(id: number, userId: number): Promise<void> {
    await exec(
      db
        .delete(relayConsumerKeys)
        .where(and(eq(relayConsumerKeys.id, id), eq(relayConsumerKeys.userId, userId))),
    );
  },
};
