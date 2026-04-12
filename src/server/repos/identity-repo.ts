/**
 * Identity repository — CRUD for the `identities` table.
 *
 * Maps auth providers (siwe, credentials, google, github) to users.
 * A single user can have multiple linked identities.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  db,
  exec,
  identities,
  type Identity,
  type NewIdentity,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const identityRepo = {
  async findByProviderAndAccount(
    provider: string,
    providerAccountId: string,
    userRole: string = "user",
  ): Promise<Identity | undefined> {
    return queryOne(
      db
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.provider, provider),
            eq(identities.providerAccountId, providerAccountId.toLowerCase()),
            eq(identities.userRole, userRole),
          ),
        ),
    );
  },

  async findByUserId(userId: number, userRole: string = "user"): Promise<Identity[]> {
    return queryAll(
      db
        .select()
        .from(identities)
        .where(and(eq(identities.userId, userId), eq(identities.userRole, userRole))),
    );
  },

  async findByUserIds(userIds: number[], userRole: string = "user"): Promise<Identity[]> {
    if (userIds.length === 0) return [];
    return queryAll(
      db
        .select()
        .from(identities)
        .where(and(inArray(identities.userId, userIds), eq(identities.userRole, userRole))),
    );
  },

  async create(data: NewIdentity): Promise<Identity> {
    return returningOne(db.insert(identities).values(data));
  },

  async deleteByUserId(userId: number, userRole: string = "user"): Promise<void> {
    await exec(
      db
        .delete(identities)
        .where(and(eq(identities.userId, userId), eq(identities.userRole, userRole))),
    );
  },

  async deleteById(id: number): Promise<void> {
    await exec(db.delete(identities).where(eq(identities.id, id)));
  },

  async countByUserId(userId: number, userRole: string = "user"): Promise<number> {
    const rows = await queryAll(
      db
        .select()
        .from(identities)
        .where(and(eq(identities.userId, userId), eq(identities.userRole, userRole))),
    );
    return rows.length;
  },
};
