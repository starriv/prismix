/**
 * AI Upstream Model Mapping repository — per-upstream model ID overrides.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  type AiUpstreamModelMapping,
  aiUpstreamModelMappings,
  db,
  exec,
  type NewAiUpstreamModelMapping,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiUpstreamModelMappingRepo = {
  async findByUpstreamId(upstreamId: number): Promise<AiUpstreamModelMapping[]> {
    return queryAll(
      db
        .select()
        .from(aiUpstreamModelMappings)
        .where(eq(aiUpstreamModelMappings.upstreamId, upstreamId)),
    );
  },

  async findByUpstreamIds(upstreamIds: number[]): Promise<AiUpstreamModelMapping[]> {
    if (upstreamIds.length === 0) return [];
    return queryAll(
      db
        .select()
        .from(aiUpstreamModelMappings)
        .where(inArray(aiUpstreamModelMappings.upstreamId, upstreamIds)),
    );
  },

  async findEnabledByUpstreamId(upstreamId: number): Promise<AiUpstreamModelMapping[]> {
    return queryAll(
      db
        .select()
        .from(aiUpstreamModelMappings)
        .where(
          and(
            eq(aiUpstreamModelMappings.upstreamId, upstreamId),
            eq(aiUpstreamModelMappings.enabled, true),
          ),
        ),
    );
  },

  async findById(id: number): Promise<AiUpstreamModelMapping | undefined> {
    return queryOne(
      db.select().from(aiUpstreamModelMappings).where(eq(aiUpstreamModelMappings.id, id)),
    );
  },

  async create(data: NewAiUpstreamModelMapping): Promise<AiUpstreamModelMapping> {
    return returningOne(db.insert(aiUpstreamModelMappings).values(data));
  },

  async update(
    id: number,
    data: Partial<Omit<AiUpstreamModelMapping, "id" | "createdAt">>,
  ): Promise<AiUpstreamModelMapping | undefined> {
    return returningOne(
      db
        .update(aiUpstreamModelMappings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiUpstreamModelMappings.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiUpstreamModelMappings).where(eq(aiUpstreamModelMappings.id, id)));
  },

  async deleteByUpstreamId(upstreamId: number): Promise<void> {
    await exec(
      db.delete(aiUpstreamModelMappings).where(eq(aiUpstreamModelMappings.upstreamId, upstreamId)),
    );
  },
};
