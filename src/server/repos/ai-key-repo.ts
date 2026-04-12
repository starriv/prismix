/**
 * AI Key repository — CRUD for `ai_keys` table.
 */
import { and, eq, gt } from "drizzle-orm";

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

  /**
   * Find any enabled key for a provider (for non-relay use like discover-models).
   * Does NOT participate in load balancing — use `pickKey()` from key-balancer for relay.
   */
  async findAnyEnabledByProvider(providerId: number): Promise<AiKey | undefined> {
    return queryOne(
      db
        .select()
        .from(aiKeys)
        .where(and(eq(aiKeys.providerId, providerId), eq(aiKeys.enabled, true)))
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
          and(eq(aiKeys.providerId, providerId), eq(aiKeys.enabled, true), gt(aiKeys.weight, 0)),
        ),
    );
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
