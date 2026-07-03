/**
 * AI endpoint credential assignment repository.
 *
 * `ai_credentials` owns encrypted key material. This repository owns endpoint
 * and upstream-specific assignment state such as weight, enablement, and
 * last-used timestamps.
 */
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";

import { clampCooldownMs, type UpstreamQuotaSnapshot } from "@/server/ai/lib/upstream-rate-limits";
import {
  aiCredentials,
  type AiEndpointCredential,
  aiEndpointCredentials,
  db,
  exec,
  type NewAiEndpointCredential,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";
import { getRedis } from "@/server/lib/redis";

// ── Upstream quota + cooldown Redis keys (Phase B) ───────────────────
// Sibling module `upstream-concurrency.ts` uses the `ai:` prefix namespace;
// we follow the same convention. (`prismix:` is reserved for events/pub-sub.)

const QUOTA_KEY_PREFIX = "ai:upstream-quota:";
const COOLDOWN_KEY_PREFIX = "ai:upstream-cooldown:";

const QUOTA_TTL_MIN_MS = 5_000;
const QUOTA_TTL_MAX_MS = 300_000;
const QUOTA_TTL_DEFAULT_MS = 60_000;

function quotaKey(credentialId: string): string {
  return `${QUOTA_KEY_PREFIX}${credentialId}`;
}

function cooldownKey(credentialId: string): string {
  return `${COOLDOWN_KEY_PREFIX}${credentialId}`;
}

function resolveQuotaTtlMs(snapshot: UpstreamQuotaSnapshot): number {
  const now = Date.now();
  const candidates: number[] = [];
  if (snapshot.resetRequestsMs !== null && snapshot.resetRequestsMs > now) {
    candidates.push(snapshot.resetRequestsMs - now);
  }
  if (snapshot.resetTokensMs !== null && snapshot.resetTokensMs > now) {
    candidates.push(snapshot.resetTokensMs - now);
  }
  if (candidates.length === 0) return QUOTA_TTL_DEFAULT_MS;
  const maxReset = Math.max(...candidates);
  return Math.min(Math.max(maxReset, QUOTA_TTL_MIN_MS), QUOTA_TTL_MAX_MS);
}

export interface EndpointCredential extends AiEndpointCredential {
  credentialName: string;
  encryptedKey: string;
  keyHash: string;
  keyPrefix: string;
  ownerId: number | null;
  supplierId: number | null;
  credentialEnabled: boolean;
}

const endpointCredentialSelect = {
  id: aiEndpointCredentials.id,
  endpointId: aiEndpointCredentials.endpointId,
  upstreamId: aiEndpointCredentials.upstreamId,
  credentialId: aiEndpointCredentials.credentialId,
  name: aiEndpointCredentials.name,
  weight: aiEndpointCredentials.weight,
  enabled: aiEndpointCredentials.enabled,
  lastUsedAt: aiEndpointCredentials.lastUsedAt,
  updatedAt: aiEndpointCredentials.updatedAt,
  createdAt: aiEndpointCredentials.createdAt,
  credentialName: aiCredentials.name,
  encryptedKey: aiCredentials.encryptedKey,
  keyHash: aiCredentials.keyHash,
  keyPrefix: aiCredentials.keyPrefix,
  ownerId: aiCredentials.ownerId,
  supplierId: aiCredentials.supplierId,
  credentialEnabled: aiCredentials.enabled,
};

export const aiEndpointCredentialRepo = {
  async findAll(limit = 200, offset = 0): Promise<EndpointCredential[]> {
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .orderBy(desc(aiEndpointCredentials.id))
        .limit(limit)
        .offset(offset),
    );
  },

  async findByEndpointId(endpointId: number): Promise<EndpointCredential[]> {
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiEndpointCredentials.endpointId, endpointId))
        .orderBy(desc(aiEndpointCredentials.id)),
    );
  },

  async findByCredentialId(credentialId: number): Promise<EndpointCredential[]> {
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiEndpointCredentials.credentialId, credentialId))
        .orderBy(desc(aiEndpointCredentials.id)),
    );
  },

  async findByEndpointCredentialAndScope(
    endpointId: number,
    credentialId: number,
    upstreamId: number | null | undefined,
  ): Promise<EndpointCredential | undefined> {
    return queryOne(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.credentialId, credentialId),
            upstreamId == null
              ? isNull(aiEndpointCredentials.upstreamId)
              : eq(aiEndpointCredentials.upstreamId, upstreamId),
          ),
        ),
    );
  },

  async findById(id: number): Promise<EndpointCredential | undefined> {
    return queryOne(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiEndpointCredentials.id, id)),
    );
  },

  async findByIds(ids: number[]): Promise<EndpointCredential[]> {
    if (ids.length === 0) return [];
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(inArray(aiEndpointCredentials.id, ids)),
    );
  },

  async findAnyEnabledByEndpoint(endpointId: number): Promise<EndpointCredential | undefined> {
    return queryOne(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.enabled, true),
            eq(aiCredentials.enabled, true),
            isNull(aiEndpointCredentials.upstreamId),
          ),
        )
        .limit(1),
    );
  },

  async findAnyEnabledByUpstream(
    endpointId: number,
    upstreamId: number | null,
  ): Promise<EndpointCredential | undefined> {
    return queryOne(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.enabled, true),
            eq(aiCredentials.enabled, true),
            upstreamId == null
              ? isNull(aiEndpointCredentials.upstreamId)
              : eq(aiEndpointCredentials.upstreamId, upstreamId),
          ),
        )
        .limit(1),
    );
  },

  async create(data: NewAiEndpointCredential): Promise<AiEndpointCredential> {
    return returningOne(db.insert(aiEndpointCredentials).values(data));
  },

  async update(
    id: number,
    data: Partial<AiEndpointCredential>,
  ): Promise<AiEndpointCredential | undefined> {
    return returningOne(
      db
        .update(aiEndpointCredentials)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiEndpointCredentials.id, id)),
    );
  },

  async updateLastUsed(id: number): Promise<void> {
    const now = new Date();
    const row = await queryOne<{ credentialId: number }>(
      db
        .select({ credentialId: aiEndpointCredentials.credentialId })
        .from(aiEndpointCredentials)
        .where(eq(aiEndpointCredentials.id, id)),
    );

    await exec(
      db
        .update(aiEndpointCredentials)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(eq(aiEndpointCredentials.id, id)),
    );

    if (row) {
      await exec(
        db
          .update(aiCredentials)
          .set({ lastUsedAt: now, updatedAt: now })
          .where(eq(aiCredentials.id, row.credentialId)),
      );
    }
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiEndpointCredentials).where(eq(aiEndpointCredentials.id, id)));
  },

  async deleteByEndpointAndUpstream(endpointId: number, upstreamId: number): Promise<number> {
    const deleted = await queryAll(
      db
        .delete(aiEndpointCredentials)
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.upstreamId, upstreamId),
          ),
        )
        .returning(),
    );
    return deleted.length;
  },

  async findByOwnerId(
    ownerId: number,
    opts?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<EndpointCredential[]> {
    const limit = opts?.limit;
    const offset = opts?.offset ?? 0;

    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiCredentials.ownerId, ownerId))
        .orderBy(
          sql`${aiEndpointCredentials.lastUsedAt} DESC NULLS LAST`,
          desc(aiEndpointCredentials.id),
        )
        .limit(limit ?? 10_000)
        .offset(offset),
    );
  },

  async ownerStats(
    ownerId: number,
  ): Promise<{ totalCredentials: number; latestCallAt: string | null }> {
    const row = await queryOne<{
      totalCredentials: number;
      latestCallAt: Date | string | null;
    }>(
      db
        .select({
          totalCredentials: count(),
          latestCallAt: sql<Date | string | null>`MAX(${aiEndpointCredentials.lastUsedAt})`,
        })
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiCredentials.ownerId, ownerId)),
    );

    return {
      totalCredentials: Number(row?.totalCredentials ?? 0),
      latestCallAt:
        row?.latestCallAt instanceof Date
          ? row.latestCallAt.toISOString()
          : (row?.latestCallAt ?? null),
    };
  },

  async countByOwnerId(ownerId: number): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db
        .select({ total: count() })
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiCredentials.ownerId, ownerId)),
    );
    return row?.total ?? 0;
  },

  async setEnabledByOwnerId(ownerId: number, enabled: boolean): Promise<AiEndpointCredential[]> {
    const rows = await queryAll<{ id: number }>(
      db
        .select({ id: aiEndpointCredentials.id })
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiCredentials.ownerId, ownerId)),
    );
    if (rows.length === 0) return [];
    return queryAll(
      db
        .update(aiEndpointCredentials)
        .set({ enabled, updatedAt: new Date() })
        .where(
          inArray(
            aiEndpointCredentials.id,
            rows.map((row) => row.id),
          ),
        )
        .returning(),
    );
  },

  async deleteByOwnerId(ownerId: number): Promise<AiEndpointCredential[]> {
    const rows = await queryAll<{ id: number }>(
      db
        .select({ id: aiEndpointCredentials.id })
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(eq(aiCredentials.ownerId, ownerId)),
    );
    if (rows.length === 0) return [];
    return queryAll(
      db
        .delete(aiEndpointCredentials)
        .where(
          inArray(
            aiEndpointCredentials.id,
            rows.map((row) => row.id),
          ),
        )
        .returning(),
    );
  },

  async findEnabledByEndpoint(endpointId: number): Promise<EndpointCredential[]> {
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.enabled, true),
            eq(aiCredentials.enabled, true),
            gt(aiEndpointCredentials.weight, 0),
            isNull(aiEndpointCredentials.upstreamId),
          ),
        ),
    );
  },

  async findEnabledByUpstream(
    endpointId: number,
    upstreamId: number | null,
  ): Promise<EndpointCredential[]> {
    return queryAll(
      db
        .select(endpointCredentialSelect)
        .from(aiEndpointCredentials)
        .innerJoin(aiCredentials, eq(aiEndpointCredentials.credentialId, aiCredentials.id))
        .where(
          and(
            eq(aiEndpointCredentials.endpointId, endpointId),
            eq(aiEndpointCredentials.enabled, true),
            eq(aiCredentials.enabled, true),
            gt(aiEndpointCredentials.weight, 0),
            upstreamId == null
              ? isNull(aiEndpointCredentials.upstreamId)
              : eq(aiEndpointCredentials.upstreamId, upstreamId),
          ),
        ),
    );
  },

  async countByUpstreamIds(
    upstreamIds: number[],
  ): Promise<Array<{ upstreamId: number; totalCredentials: number; enabledCredentials: number }>> {
    if (upstreamIds.length === 0) return [];

    const rows = await queryAll<{
      upstreamId: number | null;
      totalCredentials: number;
      enabledCredentials: number;
    }>(
      db
        .select({
          upstreamId: aiEndpointCredentials.upstreamId,
          totalCredentials: count(),
          enabledCredentials: sql<number>`SUM(CASE WHEN ${aiEndpointCredentials.enabled} = true THEN 1 ELSE 0 END)`,
        })
        .from(aiEndpointCredentials)
        .where(inArray(aiEndpointCredentials.upstreamId, upstreamIds))
        .groupBy(aiEndpointCredentials.upstreamId),
    );

    return rows
      .filter(
        (
          row,
        ): row is {
          upstreamId: number;
          totalCredentials: number;
          enabledCredentials: number;
        } => row.upstreamId != null,
      )
      .map((row) => ({
        upstreamId: row.upstreamId,
        totalCredentials: Number(row.totalCredentials ?? 0),
        enabledCredentials: Number(row.enabledCredentials ?? 0),
      }));
  },

  async countByEndpointIds(
    endpointIds: number[],
  ): Promise<Array<{ endpointId: number; totalCredentials: number; enabledCredentials: number }>> {
    if (endpointIds.length === 0) return [];

    const rows = await queryAll<{
      endpointId: number | null;
      totalCredentials: number;
      enabledCredentials: number;
    }>(
      db
        .select({
          endpointId: aiEndpointCredentials.endpointId,
          totalCredentials: count(),
          enabledCredentials: sql<number>`SUM(CASE WHEN ${aiEndpointCredentials.enabled} = true THEN 1 ELSE 0 END)`,
        })
        .from(aiEndpointCredentials)
        .where(inArray(aiEndpointCredentials.endpointId, endpointIds))
        .groupBy(aiEndpointCredentials.endpointId),
    );

    return rows
      .filter(
        (
          row,
        ): row is {
          endpointId: number;
          totalCredentials: number;
          enabledCredentials: number;
        } => row.endpointId != null,
      )
      .map((row) => ({
        endpointId: row.endpointId,
        totalCredentials: Number(row.totalCredentials ?? 0),
        enabledCredentials: Number(row.enabledCredentials ?? 0),
      }));
  },

  // ── Upstream quota snapshot + cooldown (Redis-backed) ────────────────
  //
  // These methods ONLY touch Redis. Prometheus gauges are set synchronously
  // at the call site (`upstream-quota-capture.ts`) to avoid double writes
  // and to keep repo methods pure (Redis-only side effect).
  //
  // Errors propagate — callers wrap with `.catch()` (see capture* helpers).

  async updateQuotaSnapshot(snapshot: UpstreamQuotaSnapshot): Promise<void> {
    const ttlMs = resolveQuotaTtlMs(snapshot);
    await getRedis().set(quotaKey(snapshot.credentialId), JSON.stringify(snapshot), "PX", ttlMs);
  },

  async getQuotaSnapshot(credentialId: string): Promise<UpstreamQuotaSnapshot | null> {
    const raw = await getRedis().get(quotaKey(credentialId));
    if (raw == null) return null;
    return JSON.parse(raw) as UpstreamQuotaSnapshot;
  },

  async markCooldown(credentialId: string, _provider: string, ms: number): Promise<void> {
    const clampedMs = clampCooldownMs(ms);
    // `NX`: only set if not exists. We never shorten an existing cooldown.
    // A new 429 with a shorter retry-after won't override a longer one in
    // flight — safety first. If the key already exists, SET returns null
    // and we silently skip.
    await getRedis().set(cooldownKey(credentialId), "1", "PX", clampedMs, "NX");
  },

  async clearCooldown(credentialId: string, _provider: string): Promise<void> {
    await getRedis().del(cooldownKey(credentialId));
  },

  async isCoolingDown(credentialId: string, _provider: string): Promise<boolean> {
    const exists = await getRedis().exists(cooldownKey(credentialId));
    return exists > 0;
  },
};
