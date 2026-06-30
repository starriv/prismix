/**
 * Supplier connection repository behind the existing AI endpoint API.
 *
 * Connections are concrete callable protocol surfaces under a real supplier.
 * Examples: `deepseek-openai`, `deepseek-anthropic`.
 *
 * The `aiEndpointRepo` export name, route paths, and URL contract are
 * intentionally preserved for API stability; only the DB table was renamed
 * to `ai_supplier_connections`.
 */
import { and, asc, eq, inArray, or } from "drizzle-orm";

import {
  type AiSupplierConnection,
  aiSupplierConnections,
  aiSuppliers,
  db,
  exec,
  type NewAiSupplierConnection,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export type EndpointHealthStatus = "unknown" | "healthy" | "degraded" | "down";

export interface SupplierConnectionWithSupplier extends AiSupplierConnection {
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

function flattenSupplierConnectionWithSupplier(row: {
  endpoint: AiSupplierConnection;
  supplier: SupplierConnectionWithSupplier["supplier"];
}): SupplierConnectionWithSupplier {
  return { ...row.endpoint, supplier: row.supplier };
}

export const aiEndpointRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiSupplierConnection[]> {
    return queryAll(
      db
        .select()
        .from(aiSupplierConnections)
        .orderBy(asc(aiSupplierConnections.id))
        .limit(limit)
        .offset(offset),
    );
  },

  async findAllWithSupplier(limit = 200, offset = 0): Promise<SupplierConnectionWithSupplier[]> {
    const rows = await queryAll<{
      endpoint: AiSupplierConnection;
      supplier: SupplierConnectionWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiSupplierConnections,
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
        .from(aiSupplierConnections)
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .orderBy(asc(aiSupplierConnections.id))
        .limit(limit)
        .offset(offset),
    );
    return rows.map(flattenSupplierConnectionWithSupplier);
  },

  /** All endpoint rows with enabled=true (includes auto-disabled). */
  async findAllEnabled(): Promise<AiSupplierConnection[]> {
    return queryAll(
      db
        .select()
        .from(aiSupplierConnections)
        .where(eq(aiSupplierConnections.enabled, true))
        .orderBy(asc(aiSupplierConnections.id)),
    );
  },

  /** All rows with enabled=true && !autoDisabled. For request paths. */
  async findAllActive(): Promise<AiSupplierConnection[]> {
    return queryAll(
      db
        .select()
        .from(aiSupplierConnections)
        .where(
          and(
            eq(aiSupplierConnections.enabled, true),
            eq(aiSupplierConnections.autoDisabled, false),
          ),
        )
        .orderBy(asc(aiSupplierConnections.id)),
    );
  },

  /** All rows except admin-disabled endpoints, including supplier defaults. */
  async findAllForHealthCheckWithSupplier(): Promise<SupplierConnectionWithSupplier[]> {
    const rows = await queryAll<{
      endpoint: AiSupplierConnection;
      supplier: SupplierConnectionWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiSupplierConnections,
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
        .from(aiSupplierConnections)
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .where(
          or(eq(aiSupplierConnections.enabled, true), eq(aiSupplierConnections.autoDisabled, true)),
        )
        .orderBy(asc(aiSupplierConnections.id)),
    );
    return rows.map(flattenSupplierConnectionWithSupplier);
  },

  async findById(id: number): Promise<AiSupplierConnection | undefined> {
    return queryOne(
      db.select().from(aiSupplierConnections).where(eq(aiSupplierConnections.id, id)),
    );
  },

  async findWithSupplierById(id: number): Promise<SupplierConnectionWithSupplier | undefined> {
    const row = await queryOne<{
      endpoint: AiSupplierConnection;
      supplier: SupplierConnectionWithSupplier["supplier"];
    }>(
      db
        .select({
          endpoint: aiSupplierConnections,
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
        .from(aiSupplierConnections)
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .where(eq(aiSupplierConnections.id, id)),
    );
    return row ? flattenSupplierConnectionWithSupplier(row) : undefined;
  },

  async findByIds(ids: number[]): Promise<AiSupplierConnection[]> {
    if (ids.length === 0) return [];
    return queryAll(
      db.select().from(aiSupplierConnections).where(inArray(aiSupplierConnections.id, ids)),
    );
  },

  async findByEndpointId(endpointId: string): Promise<AiSupplierConnection | undefined> {
    return queryOne(
      db
        .select()
        .from(aiSupplierConnections)
        .where(eq(aiSupplierConnections.endpointId, endpointId)),
    );
  },

  async findBySupplierId(supplierId: number): Promise<AiSupplierConnection[]> {
    return queryAll(
      db
        .select()
        .from(aiSupplierConnections)
        .where(eq(aiSupplierConnections.supplierId, supplierId))
        .orderBy(asc(aiSupplierConnections.id)),
    );
  },

  async create(data: NewAiSupplierConnection): Promise<AiSupplierConnection> {
    return returningOne(db.insert(aiSupplierConnections).values(data));
  },

  async update(
    id: number,
    data: Partial<AiSupplierConnection>,
  ): Promise<AiSupplierConnection | undefined> {
    return returningOne(
      db
        .update(aiSupplierConnections)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiSupplierConnections.id, id)),
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
    sets: Partial<AiSupplierConnection>,
  ): Promise<number[]> {
    if (Object.keys(sets).length === 0) return [];
    const modeColumn =
      mode === "auth" ? aiSupplierConnections.authMode : aiSupplierConnections.concurrencyMode;
    const rows = await db
      .update(aiSupplierConnections)
      .set({ ...sets, updatedAt: new Date() })
      .where(and(eq(aiSupplierConnections.supplierId, supplierId), eq(modeColumn, "inherit")))
      .returning({ id: aiSupplierConnections.id });
    return rows.map((row: { id: number }) => row.id);
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiSupplierConnections).where(eq(aiSupplierConnections.id, id)));
  },

  /** Return only the load-balance strategy for the credential balancer. */
  async findBalancerConfig(
    id: number,
  ): Promise<{ loadBalanceStrategy: string | null } | undefined> {
    return queryOne(
      db
        .select({ loadBalanceStrategy: aiSupplierConnections.loadBalanceStrategy })
        .from(aiSupplierConnections)
        .where(eq(aiSupplierConnections.id, id)),
    );
  },

  async updateHealth(id: number, patch: HealthPatch): Promise<void> {
    await exec(
      db
        .update(aiSupplierConnections)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(aiSupplierConnections.id, id)),
    );
  },

  async recordSuccess(id: number): Promise<void> {
    await exec(
      db
        .update(aiSupplierConnections)
        .set({
          healthStatus: "healthy",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          consecutiveFailures: 0,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(aiSupplierConnections.id, id)),
    );
  },

  async recordFailure(id: number, error: string): Promise<void> {
    const current = await queryOne<{ consecutiveFailures: number; autoDisabled: boolean }>(
      db
        .select({
          consecutiveFailures: aiSupplierConnections.consecutiveFailures,
          autoDisabled: aiSupplierConnections.autoDisabled,
        })
        .from(aiSupplierConnections)
        .where(eq(aiSupplierConnections.id, id)),
    );
    const nextFailures = (current?.consecutiveFailures ?? 0) + 1;
    await exec(
      db
        .update(aiSupplierConnections)
        .set({
          healthStatus: current?.autoDisabled ? "down" : "degraded",
          lastCheckedAt: new Date(),
          lastFailureAt: new Date(),
          lastError: truncate(error, 1000),
          consecutiveFailures: nextFailures,
          updatedAt: new Date(),
        })
        .where(eq(aiSupplierConnections.id, id)),
    );
  },

  async markAutoDisabled(id: number, reason: string): Promise<void> {
    await exec(
      db
        .update(aiSupplierConnections)
        .set({
          autoDisabled: true,
          healthStatus: "down",
          lastError: truncate(reason, 1000),
          updatedAt: new Date(),
        })
        .where(eq(aiSupplierConnections.id, id)),
    );
  },

  async markAutoReenabled(id: number): Promise<void> {
    await exec(
      db
        .update(aiSupplierConnections)
        .set({
          autoDisabled: false,
          healthStatus: "healthy",
          consecutiveFailures: 0,
          lastError: null,
          lastSuccessAt: new Date(),
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiSupplierConnections.id, id)),
    );
  },
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
