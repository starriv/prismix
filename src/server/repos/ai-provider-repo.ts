/**
 * AI Provider repository — CRUD for `ai_providers` table.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";

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

export type ProviderHealthStatus = "unknown" | "healthy" | "degraded" | "down";

export interface HealthPatch {
  healthStatus?: ProviderHealthStatus;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastError?: string | null;
  consecutiveFailures?: number;
  autoDisabled?: boolean;
}

export const aiProviderRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiProvider[]> {
    return queryAll(
      db.select().from(aiProviders).orderBy(asc(aiProviders.id)).limit(limit).offset(offset),
    );
  },

  /** All rows with enabled=true (includes auto-disabled). For admin UI + health check job. */
  async findAllEnabled(): Promise<AiProvider[]> {
    return queryAll(
      db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.enabled, true))
        .orderBy(asc(aiProviders.id)),
    );
  },

  /** All rows with enabled=true && !autoDisabled. For route layer / request path. */
  async findAllActive(): Promise<AiProvider[]> {
    return queryAll(
      db
        .select()
        .from(aiProviders)
        .where(and(eq(aiProviders.enabled, true), eq(aiProviders.autoDisabled, false)))
        .orderBy(asc(aiProviders.id)),
    );
  },

  /** All rows except admin-disabled (enabled=false && !autoDisabled). For health check job. */
  async findAllForHealthCheck(): Promise<AiProvider[]> {
    return queryAll(
      db
        .select()
        .from(aiProviders)
        .where(or(eq(aiProviders.enabled, true), eq(aiProviders.autoDisabled, true)))
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

  async updateHealth(id: number, patch: HealthPatch): Promise<void> {
    await exec(
      db
        .update(aiProviders)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(aiProviders.id, id)),
    );
  },

  async recordSuccess(id: number): Promise<void> {
    await exec(
      db
        .update(aiProviders)
        .set({
          healthStatus: "healthy",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, id)),
    );
  },

  async recordFailure(id: number, error: string): Promise<void> {
    const current = await queryOne<{ consecutiveFailures: number; autoDisabled: boolean }>(
      db
        .select({
          consecutiveFailures: aiProviders.consecutiveFailures,
          autoDisabled: aiProviders.autoDisabled,
        })
        .from(aiProviders)
        .where(eq(aiProviders.id, id)),
    );
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    await exec(
      db
        .update(aiProviders)
        .set({
          healthStatus: current?.autoDisabled ? "down" : "degraded",
          lastCheckedAt: new Date(),
          lastFailureAt: new Date(),
          lastError: truncate(error, 1000),
          consecutiveFailures: nextFailures,
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, id)),
    );
  },

  async markAutoDisabled(id: number, reason: string): Promise<void> {
    await exec(
      db
        .update(aiProviders)
        .set({
          autoDisabled: true,
          healthStatus: "down",
          lastError: truncate(reason, 1000),
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, id)),
    );
  },

  async markAutoReenabled(id: number): Promise<void> {
    await exec(
      db
        .update(aiProviders)
        .set({
          autoDisabled: false,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastError: null,
          lastSuccessAt: new Date(),
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiProviders.id, id)),
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
