/**
 * AI Provider Upstream repository — CRUD for `ai_provider_upstreams` table.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  type AiProviderUpstream,
  aiProviderUpstreams,
  db,
  exec,
  type NewAiProviderUpstream,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiProviderUpstreamRepo = {
  async findById(id: number): Promise<AiProviderUpstream | undefined> {
    return queryOne(db.select().from(aiProviderUpstreams).where(eq(aiProviderUpstreams.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiProviderUpstream[]> {
    if (ids.length === 0) return [];
    return queryAll(
      db.select().from(aiProviderUpstreams).where(inArray(aiProviderUpstreams.id, ids)),
    );
  },

  async findByProviderId(providerId: number): Promise<AiProviderUpstream[]> {
    return queryAll(
      db
        .select()
        .from(aiProviderUpstreams)
        .where(eq(aiProviderUpstreams.providerId, providerId))
        .orderBy(asc(aiProviderUpstreams.priority), asc(aiProviderUpstreams.id)),
    );
  },

  async findEnabledByProviderId(providerId: number): Promise<AiProviderUpstream[]> {
    return queryAll(
      db
        .select()
        .from(aiProviderUpstreams)
        .where(
          and(
            eq(aiProviderUpstreams.providerId, providerId),
            eq(aiProviderUpstreams.enabled, true),
          ),
        )
        .orderBy(asc(aiProviderUpstreams.priority), asc(aiProviderUpstreams.id)),
    );
  },

  async findByProviderAndUpstreamId(
    providerId: number,
    upstreamId: string,
  ): Promise<AiProviderUpstream | undefined> {
    return queryOne(
      db
        .select()
        .from(aiProviderUpstreams)
        .where(
          and(
            eq(aiProviderUpstreams.providerId, providerId),
            eq(aiProviderUpstreams.upstreamId, upstreamId),
          ),
        ),
    );
  },

  async create(data: NewAiProviderUpstream): Promise<AiProviderUpstream> {
    return returningOne(db.insert(aiProviderUpstreams).values(data));
  },

  async update(
    id: number,
    data: Partial<Omit<AiProviderUpstream, "id" | "providerId" | "createdAt">>,
  ): Promise<AiProviderUpstream | undefined> {
    return returningOne(
      db
        .update(aiProviderUpstreams)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiProviderUpstreams.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiProviderUpstreams).where(eq(aiProviderUpstreams.id, id)));
  },
};
