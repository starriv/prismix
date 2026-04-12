/**
 * Refresh token repository — CRUD for the `refresh_tokens` table.
 */
import { and, count, eq, lt } from "drizzle-orm";

import {
  db,
  exec,
  execWithChanges,
  type NewRefreshToken,
  queryOne,
  type RefreshToken,
  refreshTokens,
  returningOne,
} from "@/server/db";

export const refreshTokenRepo = {
  async create(data: NewRefreshToken): Promise<void> {
    await exec(db.insert(refreshTokens).values(data));
  },

  async findByHashAndRole(hash: string, role: "user" | "admin"): Promise<RefreshToken | undefined> {
    return queryOne(
      db
        .select()
        .from(refreshTokens)
        .where(and(eq(refreshTokens.tokenHash, hash), eq(refreshTokens.role, role))),
    );
  },

  /**
   * Atomic consume: DELETE ... RETURNING * — only one concurrent caller can succeed.
   * Prevents TOCTOU race in refresh token rotation.
   */
  async consumeByHashAndRole(
    hash: string,
    role: "user" | "admin",
  ): Promise<RefreshToken | undefined> {
    try {
      const row = await returningOne<RefreshToken>(
        db
          .delete(refreshTokens)
          .where(and(eq(refreshTokens.tokenHash, hash), eq(refreshTokens.role, role))),
      );
      return row;
    } catch {
      return undefined;
    }
  },

  async deleteById(id: number): Promise<void> {
    await exec(db.delete(refreshTokens).where(eq(refreshTokens.id, id)));
  },

  async deleteByHash(hash: string): Promise<void> {
    await exec(db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hash)));
  },

  async deleteByUser(userId: number, role: "user" | "admin"): Promise<void> {
    await exec(
      db
        .delete(refreshTokens)
        .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.role, role))),
    );
  },

  async cleanExpired(): Promise<number> {
    const now = new Date();
    return execWithChanges(db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now)));
  },

  async countByRole(role: "user" | "admin"): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(refreshTokens).where(eq(refreshTokens.role, role)),
    );
    return row?.total ?? 0;
  },
};
