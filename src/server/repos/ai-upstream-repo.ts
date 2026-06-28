/**
 * AI Upstream repository — CRUD for global `ai_upstreams` table.
 */
import { and, eq, inArray } from "drizzle-orm";

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

import type { EndpointHealthStatus, HealthPatch } from "./ai-endpoint-repo";

export type { EndpointHealthStatus, HealthPatch };

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

  async updateHealth(id: number, patch: HealthPatch): Promise<void> {
    await exec(
      db
        .update(aiUpstreams)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(aiUpstreams.id, id)),
    );
  },

  async recordSuccess(id: number): Promise<void> {
    await exec(
      db
        .update(aiUpstreams)
        .set({
          healthStatus: "healthy",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(aiUpstreams.id, id)),
    );
  },

  async recordFailure(id: number, error: string): Promise<void> {
    const current = await queryOne<{ consecutiveFailures: number; autoDisabled: boolean }>(
      db
        .select({
          consecutiveFailures: aiUpstreams.consecutiveFailures,
          autoDisabled: aiUpstreams.autoDisabled,
        })
        .from(aiUpstreams)
        .where(eq(aiUpstreams.id, id)),
    );
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    await exec(
      db
        .update(aiUpstreams)
        .set({
          healthStatus: current?.autoDisabled ? "down" : "degraded",
          lastCheckedAt: new Date(),
          lastFailureAt: new Date(),
          lastError: truncate(error, 1000),
          consecutiveFailures: nextFailures,
          updatedAt: new Date(),
        })
        .where(eq(aiUpstreams.id, id)),
    );
  },

  async markAutoDisabled(id: number, reason: string): Promise<void> {
    await exec(
      db
        .update(aiUpstreams)
        .set({
          autoDisabled: true,
          healthStatus: "down",
          lastError: truncate(reason, 1000),
          updatedAt: new Date(),
        })
        .where(eq(aiUpstreams.id, id)),
    );
  },

  async markAutoReenabled(id: number): Promise<void> {
    await exec(
      db
        .update(aiUpstreams)
        .set({
          autoDisabled: false,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastError: null,
          lastSuccessAt: new Date(),
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiUpstreams.id, id)),
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
