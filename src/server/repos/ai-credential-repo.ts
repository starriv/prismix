/**
 * AI Credential repository — CRUD for real supplier API keys.
 *
 * NOTE: `keyHash` (SHA-256 of the raw API key) is computed on insert and stored
 * for audit/forensics, but is NOT queried by application logic. Migration 0016
 * dropped the global unique constraint to allow the same physical key under
 * different owners/names. Per-endpoint binding is handled by
 * `ai_endpoint_credentials`, which has its own composite unique indexes.
 */
import { count, desc, eq, inArray, sql } from "drizzle-orm";

import {
  type AiCredential,
  aiCredentials,
  db,
  exec,
  type NewAiCredential,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiCredentialRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiCredential[]> {
    return queryAll(
      db.select().from(aiCredentials).orderBy(desc(aiCredentials.id)).limit(limit).offset(offset),
    );
  },

  async findBySupplierId(supplierId: number): Promise<AiCredential[]> {
    return queryAll(
      db
        .select()
        .from(aiCredentials)
        .where(eq(aiCredentials.supplierId, supplierId))
        .orderBy(desc(aiCredentials.id)),
    );
  },

  async findById(id: number): Promise<AiCredential | undefined> {
    return queryOne(db.select().from(aiCredentials).where(eq(aiCredentials.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiCredential[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiCredentials).where(inArray(aiCredentials.id, ids)));
  },

  async findByOwnerId(
    ownerId: number,
    opts?: { limit?: number; offset?: number },
  ): Promise<AiCredential[]> {
    return queryAll(
      db
        .select()
        .from(aiCredentials)
        .where(eq(aiCredentials.ownerId, ownerId))
        .orderBy(sql`${aiCredentials.lastUsedAt} DESC NULLS LAST`, desc(aiCredentials.id))
        .limit(opts?.limit ?? 10_000)
        .offset(opts?.offset ?? 0),
    );
  },

  async create(data: NewAiCredential): Promise<AiCredential> {
    return returningOne(db.insert(aiCredentials).values(data));
  },

  async update(id: number, data: Partial<AiCredential>): Promise<AiCredential | undefined> {
    return returningOne(
      db
        .update(aiCredentials)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiCredentials.id, id)),
    );
  },

  async updateLastUsed(id: number): Promise<void> {
    await exec(
      db
        .update(aiCredentials)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(aiCredentials.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiCredentials).where(eq(aiCredentials.id, id)));
  },

  async ownerStats(
    ownerId: number,
  ): Promise<{ totalCredentials: number; latestCallAt: string | null }> {
    const row = await queryOne<{
      totalCredentials: number;
      latestCallAt: Date | string | null;
    }>(
      db
        .select({
          totalCredentials: count(),
          latestCallAt: sql<Date | string | null>`MAX(${aiCredentials.lastUsedAt})`,
        })
        .from(aiCredentials)
        .where(eq(aiCredentials.ownerId, ownerId)),
    );

    return {
      totalCredentials: Number(row?.totalCredentials ?? 0),
      latestCallAt:
        row?.latestCallAt instanceof Date
          ? row.latestCallAt.toISOString()
          : (row?.latestCallAt ?? null),
    };
  },

  async countByOwnerId(ownerId: number): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(aiCredentials).where(eq(aiCredentials.ownerId, ownerId)),
    );
    return row?.total ?? 0;
  },

  async setEnabledByOwnerId(ownerId: number, enabled: boolean): Promise<AiCredential[]> {
    return queryAll(
      db
        .update(aiCredentials)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(aiCredentials.ownerId, ownerId))
        .returning(),
    );
  },

  async deleteByOwnerId(ownerId: number): Promise<AiCredential[]> {
    return queryAll(db.delete(aiCredentials).where(eq(aiCredentials.ownerId, ownerId)).returning());
  },
};
