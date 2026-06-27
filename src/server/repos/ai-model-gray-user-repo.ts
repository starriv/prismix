/**
 * AI model gray-release user repository.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { uniq } from "lodash-es";

import { aiModelGrayUsers, db, queryAll, queryOne, users } from "@/server/db";

export interface AiModelGrayUserSummary {
  id: number;
  uuid: string;
  name: string;
  email: string | null;
  address: string | null;
  status: number;
}

export const aiModelGrayUserRepo = {
  async findUsersByModelId(modelId: number): Promise<AiModelGrayUserSummary[]> {
    return queryAll<AiModelGrayUserSummary>(
      db
        .select({
          id: users.id,
          uuid: users.uuid,
          name: users.name,
          email: users.email,
          address: users.address,
          status: users.status,
        })
        .from(aiModelGrayUsers)
        .innerJoin(users, eq(aiModelGrayUsers.userId, users.id))
        .where(eq(aiModelGrayUsers.modelId, modelId))
        .orderBy(asc(users.id)),
    );
  },

  async findModelIdsForUser(userId: number): Promise<number[]> {
    const rows = await queryAll<{ modelId: number }>(
      db
        .select({ modelId: aiModelGrayUsers.modelId })
        .from(aiModelGrayUsers)
        .where(eq(aiModelGrayUsers.userId, userId)),
    );
    return rows.map((row) => row.modelId);
  },

  async findUserModelIds(userId: number, modelIds: number[]): Promise<Set<number>> {
    if (modelIds.length === 0) return new Set();
    const rows = await queryAll<{ modelId: number }>(
      db
        .select({ modelId: aiModelGrayUsers.modelId })
        .from(aiModelGrayUsers)
        .where(
          and(
            inArray(aiModelGrayUsers.modelId, uniq(modelIds)),
            eq(aiModelGrayUsers.userId, userId),
          ),
        ),
    );
    return new Set(rows.map((row) => row.modelId));
  },

  async isUserAllowedForModel(modelId: number, userId: number): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
      db
        .select({ id: aiModelGrayUsers.id })
        .from(aiModelGrayUsers)
        .where(and(eq(aiModelGrayUsers.modelId, modelId), eq(aiModelGrayUsers.userId, userId)))
        .limit(1),
    );
    return !!row;
  },

  async findUsersByModelIds(modelIds: number[]): Promise<Map<number, AiModelGrayUserSummary[]>> {
    if (modelIds.length === 0) return new Map();
    const rows = await queryAll<AiModelGrayUserSummary & { modelId: number }>(
      db
        .select({
          modelId: aiModelGrayUsers.modelId,
          id: users.id,
          uuid: users.uuid,
          name: users.name,
          email: users.email,
          address: users.address,
          status: users.status,
        })
        .from(aiModelGrayUsers)
        .innerJoin(users, eq(aiModelGrayUsers.userId, users.id))
        .where(inArray(aiModelGrayUsers.modelId, uniq(modelIds)))
        .orderBy(asc(users.id)),
    );
    const result = new Map<number, AiModelGrayUserSummary[]>();
    for (const { modelId, ...user } of rows) {
      const arr = result.get(modelId) ?? [];
      arr.push(user);
      result.set(modelId, arr);
    }
    return result;
  },

  async replaceForModel(modelId: number, userIds: number[]): Promise<void> {
    const uniqueUserIds = uniq(userIds);

    await db.transaction(async (tx: typeof db) => {
      await tx.delete(aiModelGrayUsers).where(eq(aiModelGrayUsers.modelId, modelId));
      if (uniqueUserIds.length === 0) return;
      await tx
        .insert(aiModelGrayUsers)
        .values(uniqueUserIds.map((userId) => ({ modelId, userId })))
        .onConflictDoNothing();
    });
  },
};
