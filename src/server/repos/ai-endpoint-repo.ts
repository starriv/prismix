/**
 * AI Endpoint repository — CRUD for protocol endpoints.
 *
 * Endpoints are concrete callable protocol surfaces under a real supplier.
 * Examples: `deepseek-openai`, `deepseek-anthropic`.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";

import {
  type AiEndpoint,
  aiEndpoints,
  aiSuppliers,
  db,
  exec,
  type NewAiEndpoint,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export type EndpointHealthStatus = "unknown" | "healthy" | "degraded" | "down";

export interface EndpointWithSupplier extends AiEndpoint {
  supplier: {
    id: number;
    supplierId: string;
    name: string;
    iconUrl: string | null;
    authType: string;
    authConfig: string;
    officialConcurrencyLimit: number | null;
    officialQueueTimeoutMs: number;
    enabled: boolean;
  };
}

export interface HealthPatch {
  healthStatus?: EndpointHealthStatus;
  lastCheckedAt?: Date;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastError?: string | null;
  consecutiveFailures?: number;
  autoDisabled?: boolean;
}

function flattenEndpointWithSupplier(row: {
  endpoint: AiEndpoint;
  supplier: EndpointWithSupplier["supplier"];
}): EndpointWithSupplier {
  return { ...row.endpoint, supplier: row.supplier };
}

export const aiEndpointRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiEndpoint[]> {
    return queryAll(
      db.select().from(aiEndpoints).orderBy(asc(aiEndpoints.id)).limit(limit).offset(offset),
    );
  },

  async findAllWithSupplier(limit = 200, offset = 0): Promise<EndpointWithSupplier[]> {
    const rows = await queryAll<{
      endpoint: AiEndpoint;
      supplier: EndpointWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiEndpoints,
          supplier: {
            id: aiSuppliers.id,
            supplierId: aiSuppliers.supplierId,
            name: aiSuppliers.name,
            iconUrl: aiSuppliers.iconUrl,
            authType: aiSuppliers.authType,
            authConfig: aiSuppliers.authConfig,
            officialConcurrencyLimit: aiSuppliers.officialConcurrencyLimit,
            officialQueueTimeoutMs: aiSuppliers.officialQueueTimeoutMs,
            enabled: aiSuppliers.enabled,
          },
        })
        .from(aiEndpoints)
        .innerJoin(aiSuppliers, eq(aiEndpoints.supplierId, aiSuppliers.id))
        .orderBy(asc(aiEndpoints.id))
        .limit(limit)
        .offset(offset),
    );
    return rows.map(flattenEndpointWithSupplier);
  },

  /** All endpoint rows with enabled=true (includes auto-disabled). */
  async findAllEnabled(): Promise<AiEndpoint[]> {
    return queryAll(
      db
        .select()
        .from(aiEndpoints)
        .where(eq(aiEndpoints.enabled, true))
        .orderBy(asc(aiEndpoints.id)),
    );
  },

  /** All rows with enabled=true && !autoDisabled. For request paths. */
  async findAllActive(): Promise<AiEndpoint[]> {
    return queryAll(
      db
        .select()
        .from(aiEndpoints)
        .where(and(eq(aiEndpoints.enabled, true), eq(aiEndpoints.autoDisabled, false)))
        .orderBy(asc(aiEndpoints.id)),
    );
  },

  /** All rows except admin-disabled endpoints, including supplier defaults. */
  async findAllForHealthCheckWithSupplier(): Promise<EndpointWithSupplier[]> {
    const rows = await queryAll<{
      endpoint: AiEndpoint;
      supplier: EndpointWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiEndpoints,
          supplier: {
            id: aiSuppliers.id,
            supplierId: aiSuppliers.supplierId,
            name: aiSuppliers.name,
            iconUrl: aiSuppliers.iconUrl,
            authType: aiSuppliers.authType,
            authConfig: aiSuppliers.authConfig,
            officialConcurrencyLimit: aiSuppliers.officialConcurrencyLimit,
            officialQueueTimeoutMs: aiSuppliers.officialQueueTimeoutMs,
            enabled: aiSuppliers.enabled,
          },
        })
        .from(aiEndpoints)
        .innerJoin(aiSuppliers, eq(aiEndpoints.supplierId, aiSuppliers.id))
        .where(or(eq(aiEndpoints.enabled, true), eq(aiEndpoints.autoDisabled, true)))
        .orderBy(asc(aiEndpoints.id)),
    );
    return rows.map(flattenEndpointWithSupplier);
  },

  async findById(id: number): Promise<AiEndpoint | undefined> {
    return queryOne(db.select().from(aiEndpoints).where(eq(aiEndpoints.id, id)));
  },

  async findWithSupplierById(id: number): Promise<EndpointWithSupplier | undefined> {
    const row = await queryOne<{
      endpoint: AiEndpoint;
      supplier: EndpointWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiEndpoints,
          supplier: {
            id: aiSuppliers.id,
            supplierId: aiSuppliers.supplierId,
            name: aiSuppliers.name,
            iconUrl: aiSuppliers.iconUrl,
            authType: aiSuppliers.authType,
            authConfig: aiSuppliers.authConfig,
            officialConcurrencyLimit: aiSuppliers.officialConcurrencyLimit,
            officialQueueTimeoutMs: aiSuppliers.officialQueueTimeoutMs,
            enabled: aiSuppliers.enabled,
          },
        })
        .from(aiEndpoints)
        .innerJoin(aiSuppliers, eq(aiEndpoints.supplierId, aiSuppliers.id))
        .where(eq(aiEndpoints.id, id)),
    );
    return row ? flattenEndpointWithSupplier(row) : undefined;
  },

  async findByIds(ids: number[]): Promise<AiEndpoint[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiEndpoints).where(inArray(aiEndpoints.id, ids)));
  },

  async findByEndpointId(endpointId: string): Promise<AiEndpoint | undefined> {
    return queryOne(db.select().from(aiEndpoints).where(eq(aiEndpoints.endpointId, endpointId)));
  },

  async findBySupplierId(supplierId: number): Promise<AiEndpoint[]> {
    return queryAll(
      db
        .select()
        .from(aiEndpoints)
        .where(eq(aiEndpoints.supplierId, supplierId))
        .orderBy(asc(aiEndpoints.id)),
    );
  },

  async create(data: NewAiEndpoint): Promise<AiEndpoint> {
    return returningOne(db.insert(aiEndpoints).values(data));
  },

  async update(id: number, data: Partial<AiEndpoint>): Promise<AiEndpoint | undefined> {
    return returningOne(
      db
        .update(aiEndpoints)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiEndpoints.id, id)),
    );
  },

  /**
   * Batch-update fields on all endpoints under a supplier that inherit the
   * given runtime mode (auth or concurrency). Returns the IDs of affected
   * endpoints for cache invalidation. Avoids N+1 queries when a supplier's
   * defaults change and many endpoints need to be synced.
   */
  async updateInheritedBySupplier(
    supplierId: number,
    mode: "auth" | "concurrency",
    sets: Partial<AiEndpoint>,
  ): Promise<number[]> {
    if (Object.keys(sets).length === 0) return [];
    const modeColumn = mode === "auth" ? aiEndpoints.authMode : aiEndpoints.concurrencyMode;
    const rows = await db
      .update(aiEndpoints)
      .set({ ...sets, updatedAt: new Date() })
      .where(and(eq(aiEndpoints.supplierId, supplierId), eq(modeColumn, "inherit")))
      .returning({ id: aiEndpoints.id });
    return rows.map((row: { id: number }) => row.id);
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiEndpoints).where(eq(aiEndpoints.id, id)));
  },

  /** Return only the load-balance strategy for the credential balancer. */
  async findBalancerConfig(
    id: number,
  ): Promise<{ loadBalanceStrategy: string | null } | undefined> {
    return queryOne(
      db
        .select({ loadBalanceStrategy: aiEndpoints.loadBalanceStrategy })
        .from(aiEndpoints)
        .where(eq(aiEndpoints.id, id)),
    );
  },

  async updateHealth(id: number, patch: HealthPatch): Promise<void> {
    await exec(
      db
        .update(aiEndpoints)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(aiEndpoints.id, id)),
    );
  },

  async recordSuccess(id: number): Promise<void> {
    await exec(
      db
        .update(aiEndpoints)
        .set({
          healthStatus: "healthy",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(aiEndpoints.id, id)),
    );
  },

  async recordFailure(id: number, error: string): Promise<void> {
    const current = await queryOne<{ consecutiveFailures: number; autoDisabled: boolean }>(
      db
        .select({
          consecutiveFailures: aiEndpoints.consecutiveFailures,
          autoDisabled: aiEndpoints.autoDisabled,
        })
        .from(aiEndpoints)
        .where(eq(aiEndpoints.id, id)),
    );
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    await exec(
      db
        .update(aiEndpoints)
        .set({
          healthStatus: current?.autoDisabled ? "down" : "degraded",
          lastCheckedAt: new Date(),
          lastFailureAt: new Date(),
          lastError: truncate(error, 1000),
          consecutiveFailures: nextFailures,
          updatedAt: new Date(),
        })
        .where(eq(aiEndpoints.id, id)),
    );
  },

  async markAutoDisabled(id: number, reason: string): Promise<void> {
    await exec(
      db
        .update(aiEndpoints)
        .set({
          autoDisabled: true,
          healthStatus: "down",
          lastError: truncate(reason, 1000),
          updatedAt: new Date(),
        })
        .where(eq(aiEndpoints.id, id)),
    );
  },

  async markAutoReenabled(id: number): Promise<void> {
    await exec(
      db
        .update(aiEndpoints)
        .set({
          autoDisabled: false,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastError: null,
          lastSuccessAt: new Date(),
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiEndpoints.id, id)),
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
