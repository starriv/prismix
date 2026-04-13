/**
 * AI Key repository — CRUD for `ai_keys` table.
 */
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import {
  type AiKey,
  aiKeys,
  db,
  exec,
  type NewAiKey,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiKeyRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiKey[]> {
    return queryAll(db.select().from(aiKeys).limit(limit).offset(offset));
  },

  async findById(id: number): Promise<AiKey | undefined> {
    return queryOne(db.select().from(aiKeys).where(eq(aiKeys.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiKey[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiKeys).where(inArray(aiKeys.id, ids)));
  },

  /**
   * Find any enabled key for a provider (for non-relay use like discover-models).
   * Does NOT participate in load balancing — use `pickKey()` from key-balancer for relay.
   */
  async findAnyEnabledByProvider(providerId: number): Promise<AiKey | undefined> {
    return queryOne(
      db
        .select()
        .from(aiKeys)
        .where(
          and(
            eq(aiKeys.providerId, providerId),
            eq(aiKeys.enabled, true),
            isNull(aiKeys.upstreamId),
          ),
        )
        .limit(1),
    );
  },

  async findAnyEnabledByUpstream(
    providerId: number,
    upstreamId: number | null,
  ): Promise<AiKey | undefined> {
    return queryOne(
      db
        .select()
        .from(aiKeys)
        .where(
          and(
            eq(aiKeys.providerId, providerId),
            eq(aiKeys.enabled, true),
            upstreamId == null ? isNull(aiKeys.upstreamId) : eq(aiKeys.upstreamId, upstreamId),
          ),
        )
        .limit(1),
    );
  },

  async create(data: NewAiKey): Promise<AiKey> {
    return returningOne(db.insert(aiKeys).values(data));
  },

  async update(id: number, data: Partial<AiKey>): Promise<AiKey | undefined> {
    return returningOne(
      db
        .update(aiKeys)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiKeys.id, id)),
    );
  },

  async updateLastUsed(id: number): Promise<void> {
    await exec(
      db
        .update(aiKeys)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiKeys.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiKeys).where(eq(aiKeys.id, id)));
  },

  /** Find all keys owned by a key provider. */
  async findByOwnerId(ownerId: number): Promise<AiKey[]> {
    return queryAll(db.select().from(aiKeys).where(eq(aiKeys.ownerId, ownerId)));
  },

  async countByOwnerId(ownerId: number): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(aiKeys).where(eq(aiKeys.ownerId, ownerId)),
    );
    return row?.total ?? 0;
  },

  /** Delete all keys owned by a key provider. Returns deleted keys for pool invalidation. */
  async deleteByOwnerId(ownerId: number): Promise<AiKey[]> {
    return queryAll(db.delete(aiKeys).where(eq(aiKeys.ownerId, ownerId)).returning());
  },

  /** Find all enabled keys with weight > 0 for a provider (used by key-balancer pool). */
  async findEnabledByProvider(providerId: number): Promise<AiKey[]> {
    return queryAll(
      db
        .select()
        .from(aiKeys)
        .where(
          and(
            eq(aiKeys.providerId, providerId),
            eq(aiKeys.enabled, true),
            gt(aiKeys.weight, 0),
            isNull(aiKeys.upstreamId),
          ),
        ),
    );
  },

  async findEnabledByUpstream(providerId: number, upstreamId: number | null): Promise<AiKey[]> {
    return queryAll(
      db
        .select()
        .from(aiKeys)
        .where(
          and(
            eq(aiKeys.providerId, providerId),
            eq(aiKeys.enabled, true),
            gt(aiKeys.weight, 0),
            upstreamId == null ? isNull(aiKeys.upstreamId) : eq(aiKeys.upstreamId, upstreamId),
          ),
        ),
    );
  },

  async countByUpstreamIds(
    upstreamIds: number[],
  ): Promise<Array<{ upstreamId: number; totalKeys: number; enabledKeys: number }>> {
    if (upstreamIds.length === 0) return [];

    const rows = await queryAll<{
      upstreamId: number | null;
      totalKeys: number;
      enabledKeys: number;
    }>(
      db
        .select({
          upstreamId: aiKeys.upstreamId,
          totalKeys: count(),
          enabledKeys: sql<number>`SUM(CASE WHEN ${aiKeys.enabled} = true THEN 1 ELSE 0 END)`,
        })
        .from(aiKeys)
        .where(inArray(aiKeys.upstreamId, upstreamIds))
        .groupBy(aiKeys.upstreamId),
    );

    return rows
      .filter(
        (row): row is { upstreamId: number; totalKeys: number; enabledKeys: number } =>
          row.upstreamId != null,
      )
      .map((row) => ({
        upstreamId: row.upstreamId,
        totalKeys: Number(row.totalKeys ?? 0),
        enabledKeys: Number(row.enabledKeys ?? 0),
      }));
  },

  /** Bulk set enabled/disabled for all keys owned by a key provider. */
  async setEnabledByOwnerId(ownerId: number, enabled: boolean): Promise<AiKey[]> {
    return queryAll(
      db
        .update(aiKeys)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(aiKeys.ownerId, ownerId))
        .returning(),
    );
  },
};
