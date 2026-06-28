/**
 * AI Upstream Assignment repository — CRUD for `ai_upstream_assignments` junction table.
 *
 * Manages the M:N relationship between endpoints and global upstreams.
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

  /** All assignments for an endpoint, joined with global upstream, ordered by priority. */
  async findByEndpointId(endpointId: number): Promise<AssignmentWithUpstream[]> {
    const rows = await queryAll<JoinRow>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .innerJoin(aiUpstreams, eq(aiUpstreamAssignments.upstreamId, aiUpstreams.id))
        .where(eq(aiUpstreamAssignments.endpointId, endpointId))
        .orderBy(asc(aiUpstreamAssignments.priority), asc(aiUpstreamAssignments.id)),
    );

    return rows.map(toAssignmentWithUpstream);
  },

  /** Enabled assignments for an endpoint (both assignment and upstream must be enabled + !autoDisabled). */
  async findEnabledByEndpointId(endpointId: number): Promise<AssignmentWithUpstream[]> {
    const rows = await queryAll<JoinRow>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .innerJoin(aiUpstreams, eq(aiUpstreamAssignments.upstreamId, aiUpstreams.id))
        .where(
          and(
            eq(aiUpstreamAssignments.endpointId, endpointId),
            eq(aiUpstreamAssignments.enabled, true),
            eq(aiUpstreams.enabled, true),
            eq(aiUpstreams.autoDisabled, false),
          ),
        )
        .orderBy(asc(aiUpstreamAssignments.priority), asc(aiUpstreamAssignments.id)),
    );

    return rows.map(toAssignmentWithUpstream);
  },

  /** Check for duplicate assignment (same endpoint + upstream). */
  async findByEndpointAndUpstreamId(
    endpointId: number,
    upstreamId: number,
  ): Promise<AiUpstreamAssignment | undefined> {
    return queryOne(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(
          and(
            eq(aiUpstreamAssignments.endpointId, endpointId),
            eq(aiUpstreamAssignments.upstreamId, upstreamId),
          ),
        ),
    );
  },

  /** All assignments for a global upstream (across all endpoints). */
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

  /** Count assignments per endpoint for a batch of endpoint IDs. */
  async countByEndpointIds(endpointIds: number[]): Promise<Map<number, number>> {
    if (endpointIds.length === 0) return new Map();
    const rows = await queryAll<AiUpstreamAssignment>(
      db
        .select()
        .from(aiUpstreamAssignments)
        .where(inArray(aiUpstreamAssignments.endpointId, endpointIds)),
    );

    const counts = new Map<number, number>();
    for (const row of rows) {
      counts.set(row.endpointId, (counts.get(row.endpointId) ?? 0) + 1);
    }
    return counts;
  },

  async create(data: NewAiUpstreamAssignment): Promise<AiUpstreamAssignment> {
    return returningOne(db.insert(aiUpstreamAssignments).values(data));
  },

  async update(
    id: number,
    data: Partial<Omit<AiUpstreamAssignment, "id" | "endpointId" | "upstreamId" | "createdAt">>,
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
