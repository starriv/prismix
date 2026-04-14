/**
 * AI Provider repository — CRUD for `ai_providers` table.
 */
import { asc, eq, inArray } from "drizzle-orm";

import {
  type AiProvider,
  aiProviders,
  db,
  exec,
  type NewAiProvider,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiProviderRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiProvider[]> {
    return queryAll(
      db.select().from(aiProviders).orderBy(asc(aiProviders.id)).limit(limit).offset(offset),
    );
  },

  async findAllEnabled(): Promise<AiProvider[]> {
    return queryAll(
      db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.enabled, true))
        .orderBy(asc(aiProviders.id)),
    );
  },

  async findById(id: number): Promise<AiProvider | undefined> {
    return queryOne(db.select().from(aiProviders).where(eq(aiProviders.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiProvider[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiProviders).where(inArray(aiProviders.id, ids)));
  },

  async findByProviderId(providerId: string): Promise<AiProvider | undefined> {
    return queryOne(db.select().from(aiProviders).where(eq(aiProviders.providerId, providerId)));
  },

  async create(data: NewAiProvider): Promise<AiProvider> {
    return returningOne(db.insert(aiProviders).values(data));
  },

  async update(id: number, data: Partial<AiProvider>): Promise<AiProvider | undefined> {
    return returningOne(
      db
        .update(aiProviders)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiProviders.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiProviders).where(eq(aiProviders.id, id)));
  },

  /** Return only the load-balance strategy for the key balancer. */
  async findBalancerConfig(
    id: number,
  ): Promise<{ loadBalanceStrategy: string | null } | undefined> {
    return queryOne(
      db
        .select({ loadBalanceStrategy: aiProviders.loadBalanceStrategy })
        .from(aiProviders)
        .where(eq(aiProviders.id, id)),
    );
  },
};
