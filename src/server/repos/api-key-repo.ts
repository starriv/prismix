/**
 * API Key repository — CRUD + auth lookup for the `api_keys` table.
 */
import { and, count, desc, eq } from "drizzle-orm";

import {
  type ApiKey,
  apiKeys,
  db,
  exec,
  type NewApiKey,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const apiKeyRepo = {
  async findAll(): Promise<ApiKey[]> {
    return queryAll(db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)));
  },

  async findById(id: number): Promise<ApiKey | undefined> {
    return queryOne(db.select().from(apiKeys).where(eq(apiKeys.id, id)));
  },

  /** Lookup by secret hash — used by auth middleware. */
  async findByHash(secretHash: string): Promise<ApiKey | undefined> {
    return queryOne(db.select().from(apiKeys).where(eq(apiKeys.secretHash, secretHash)));
  },

  async create(data: NewApiKey): Promise<ApiKey> {
    return returningOne(db.insert(apiKeys).values(data));
  },

  async update(id: number, data: Partial<Pick<ApiKey, "name">>): Promise<ApiKey | undefined> {
    return returningOne(
      db
        .update(apiKeys)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(apiKeys.id, id)),
    );
  },

  /** Revoke a key — permanent, sets status + revokedAt. */
  async revoke(id: number): Promise<ApiKey | undefined> {
    return returningOne(
      db
        .update(apiKeys)
        .set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.status, "active"))),
    );
  },

  /** Rotate secret — replaces hash + prefix, keeps everything else. */
  async rotate(id: number, secretHash: string, secretPrefix: string): Promise<ApiKey | undefined> {
    return returningOne(
      db
        .update(apiKeys)
        .set({ secretHash, secretPrefix, updatedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.status, "active"))),
    );
  },

  /** Update last_used_at — called async from auth middleware. */
  async updateLastUsed(id: number): Promise<void> {
    await exec(
      db
        .update(apiKeys)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(apiKeys.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(apiKeys).where(eq(apiKeys.id, id)));
  },

  /** Count active keys — used for limit enforcement. */
  async count(): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(apiKeys).where(eq(apiKeys.status, "active")),
    );
    return row?.total ?? 0;
  },
};
