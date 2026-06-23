/**
 * Relay Consumer Key repository — CRUD for consumer-facing API keys.
 * Balance is managed by the linked pay-agent; this repo has no balance ops.
 */
import { and, count, desc, eq, getTableColumns, ilike } from "drizzle-orm";

import {
  db,
  exec,
  type NewRelayConsumerKey,
  queryAll,
  queryOne,
  type RelayConsumerKey,
  type RelayConsumerKeyBlacklist,
  relayConsumerKeyBlacklist,
  relayConsumerKeys,
  returningOne,
  users,
} from "@/server/db";

const esc = (v: string) => v.replace(/[%_]/g, "\\$&");

type ConsumerKeyFilters = { prefix?: string; userUuid?: string };

function buildConsumerKeyFilterConditions(filters?: ConsumerKeyFilters) {
  const conditions = [];
  if (filters?.prefix)
    conditions.push(ilike(relayConsumerKeys.apiKeyPrefix, `%${esc(filters.prefix)}%`));
  if (filters?.userUuid) conditions.push(ilike(users.uuid, `%${esc(filters.userUuid)}%`));
  return conditions;
}

/** Consumer key row with the owning user's status (null for orphan keys). */
export type ConsumerKeyWithUserStatus = RelayConsumerKey & {
  userStatus: number | null;
};

/** Consumer key row joined with user name for admin list view. */
export type ConsumerKeyWithUser = RelayConsumerKey & {
  userName: string | null;
  userUuid: string | null;
};

/** Lightweight shape for lookup / options endpoints. */
export type ConsumerKeyOption = { id: number; name: string; apiKeyPrefix: string };

export const relayConsumerKeyRepo = {
  /** All keys as lightweight options (id + name + prefix). No secrets, no pagination. */
  async findAllOptions(): Promise<ConsumerKeyOption[]> {
    return queryAll(
      db
        .select({
          id: relayConsumerKeys.id,
          name: relayConsumerKeys.name,
          apiKeyPrefix: relayConsumerKeys.apiKeyPrefix,
        })
        .from(relayConsumerKeys)
        .orderBy(desc(relayConsumerKeys.createdAt)),
    );
  },

  async findAllOrdered(): Promise<RelayConsumerKey[]> {
    return queryAll(db.select().from(relayConsumerKeys).orderBy(desc(relayConsumerKeys.createdAt)));
  },

  async findFiltered(
    limit = 200,
    offset = 0,
    filters?: ConsumerKeyFilters,
  ): Promise<ConsumerKeyWithUser[]> {
    const conditions = buildConsumerKeyFilterConditions(filters);

    const qb = db
      .select({ ...getTableColumns(relayConsumerKeys), userName: users.name, userUuid: users.uuid })
      .from(relayConsumerKeys)
      .leftJoin(users, eq(relayConsumerKeys.userId, users.id));
    if (conditions.length) qb.where(and(...conditions));
    return queryAll(qb.orderBy(desc(relayConsumerKeys.createdAt)).limit(limit).offset(offset));
  },

  async countFiltered(filters?: ConsumerKeyFilters): Promise<number> {
    const conditions = buildConsumerKeyFilterConditions(filters);
    const row = await queryOne<{ total: number }>(
      db
        .select({ total: count() })
        .from(relayConsumerKeys)
        .leftJoin(users, eq(relayConsumerKeys.userId, users.id))
        .where(conditions.length ? and(...conditions) : undefined),
    );
    return row?.total ?? 0;
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

  async findBlacklistedByApiKeyHash(hash: string): Promise<RelayConsumerKeyBlacklist | undefined> {
    return queryOne(
      db
        .select()
        .from(relayConsumerKeyBlacklist)
        .where(eq(relayConsumerKeyBlacklist.apiKeyHash, hash)),
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

  async blacklistAndDelete(
    key: Pick<
      RelayConsumerKey,
      "id" | "userId" | "agentId" | "name" | "apiKeyHash" | "apiKeyPrefix"
    >,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- db is Proxy<any>, Drizzle cannot infer tx type
    await db.transaction(async (tx: any) => {
      await tx.insert(relayConsumerKeyBlacklist).values({
        relayConsumerKeyId: key.id,
        userId: key.userId,
        agentId: key.agentId,
        name: key.name,
        apiKeyHash: key.apiKeyHash,
        apiKeyPrefix: key.apiKeyPrefix,
      });

      await tx.delete(relayConsumerKeys).where(eq(relayConsumerKeys.id, key.id));
    });
  },
};
