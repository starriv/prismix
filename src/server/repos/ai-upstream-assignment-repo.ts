/**
 * AI Upstream Assignment repository — CRUD for `ai_upstream_assignments` junction table.
 *
 * Manages the M:N relationship between providers and global upstreams.
 * Assignment-level fields: priority, weight, enabled.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  type AiUpstream,
  type AiUpstreamAssignment,
  aiUpstreamAssignments,
  aiUpstreams,
  db,
  exec,
  type NewAiUpstreamAssignment,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

/** Assignment row joined with its global upstream entity. */
export type AssignmentWithUpstream = AiUpstreamAssignment & { upstream: AiUpstream };

/** Join result shape from Drizzle innerJoin. */
type JoinRow = { ai_upstream_assignments: AiUpstreamAssignment; ai_upstreams: AiUpstream };

function toAssignmentWithUpstream(row: JoinRow): AssignmentWithUpstream {
  return { ...row.ai_upstream_assignments, upstream: row.ai_upstreams };
}

export const aiUpstreamAssignmentRepo = {
  async findById(id: number): Promise<AiUpstreamAssignment | undefined> {
    return queryOne(
      db.select().from(aiUpstreamAssignments).where(eq(aiUpstreamAssignments.id, id)),
    );
  },

  /** All assignments for a provider, joined with global upstream, ordered by priority. */
  async findByProviderId(providerId: number): Promise<AssignmentWithUpstream[]> {
    const rows = await queryAll<JoinRow>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .innerJoin(aiUpstreams, eq(aiUpstreamAssignments.upstreamId, aiUpstreams.id))
        .where(eq(aiUpstreamAssignments.providerId, providerId))
        .orderBy(asc(aiUpstreamAssignments.priority), asc(aiUpstreamAssignments.id)),
    );

    return rows.map(toAssignmentWithUpstream);
  },

  /** Enabled assignments for a provider (both assignment and upstream must be enabled). */
  async findEnabledByProviderId(providerId: number): Promise<AssignmentWithUpstream[]> {
    const rows = await queryAll<JoinRow>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .innerJoin(aiUpstreams, eq(aiUpstreamAssignments.upstreamId, aiUpstreams.id))
        .where(
          and(
            eq(aiUpstreamAssignments.providerId, providerId),
            eq(aiUpstreamAssignments.enabled, true),
            eq(aiUpstreams.enabled, true),
          ),
        )
        .orderBy(asc(aiUpstreamAssignments.priority), asc(aiUpstreamAssignments.id)),
    );

    return rows.map(toAssignmentWithUpstream);
  },

  /** Check for duplicate assignment (same provider + upstream). */
  async findByProviderAndUpstreamId(
    providerId: number,
    upstreamId: number,
  ): Promise<AiUpstreamAssignment | undefined> {
    return queryOne(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(
          and(
            eq(aiUpstreamAssignments.providerId, providerId),
            eq(aiUpstreamAssignments.upstreamId, upstreamId),
          ),
        ),
    );
  },

  /** All assignments for a global upstream (across all providers). */
  async findByUpstreamId(upstreamId: number): Promise<AiUpstreamAssignment[]> {
    return queryAll(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(eq(aiUpstreamAssignments.upstreamId, upstreamId)),
    );
  },

  /** Count assignments per upstream for a batch of upstream IDs. */
  async countByUpstreamIds(upstreamIds: number[]): Promise<Map<number, number>> {
    if (upstreamIds.length === 0) return new Map();
    const rows = await queryAll<AiUpstreamAssignment>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(inArray(aiUpstreamAssignments.upstreamId, upstreamIds)),
    );

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.upstreamId, (counts.get(row.upstreamId) ?? 0) + 1);
    }
    return counts;
  },

  /** Count assignments per provider for a batch of provider IDs. */
  async countByProviderIds(providerIds: number[]): Promise<Map<number, number>> {
    if (providerIds.length === 0) return new Map();
    const rows = await queryAll<AiUpstreamAssignment>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(inArray(aiUpstreamAssignments.providerId, providerIds)),
    );

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.providerId, (counts.get(row.providerId) ?? 0) + 1);
    }
    return counts;
  },

  async create(data: NewAiUpstreamAssignment): Promise<AiUpstreamAssignment> {
    return returningOne(db.insert(aiUpstreamAssignments).values(data));
  },

  async update(
    id: number,
    data: Partial<Omit<AiUpstreamAssignment, "id" | "providerId" | "upstreamId" | "createdAt">>,
  ): Promise<AiUpstreamAssignment | undefined> {
    return returningOne(
      db
        .update(aiUpstreamAssignments)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiUpstreamAssignments.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiUpstreamAssignments).where(eq(aiUpstreamAssignments.id, id)));
  },
};
