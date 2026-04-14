/**
 * AI Upstream repository — CRUD for global `ai_upstreams` table.
 */
import { eq, inArray } from "drizzle-orm";

import {
  type AiUpstream,
  aiUpstreams,
  db,
  exec,
  type NewAiUpstream,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiUpstreamRepo = {
  async findAll(): Promise<AiUpstream[]> {
    return queryAll(db.select().from(aiUpstreams));
  },

  async findById(id: number): Promise<AiUpstream | undefined> {
    return queryOne(db.select().from(aiUpstreams).where(eq(aiUpstreams.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiUpstream[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiUpstreams).where(inArray(aiUpstreams.id, ids)));
  },

  async findByUpstreamId(upstreamId: string): Promise<AiUpstream | undefined> {
    return queryOne(db.select().from(aiUpstreams).where(eq(aiUpstreams.upstreamId, upstreamId)));
  },

  async create(data: NewAiUpstream): Promise<AiUpstream> {
    return returningOne(db.insert(aiUpstreams).values(data));
  },

  async update(
    id: number,
    data: Partial<Omit<AiUpstream, "id" | "createdAt">>,
  ): Promise<AiUpstream | undefined> {
    return returningOne(
      db
        .update(aiUpstreams)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiUpstreams.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiUpstreams).where(eq(aiUpstreams.id, id)));
  },
};
