/**
 * AI Model Route repository — CRUD for `ai_model_routes` junction table.
 * Routes link models to endpoints with priority-based failover.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  type AiModel,
  type AiModelRoute,
  aiModelRoutes,
  aiModels,
  type AiSupplierConnection,
  aiSupplierConnections,
  aiSuppliers,
  db,
  exec,
  execWithChanges,
  type NewAiModelRoute,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

import type { SupplierConnectionWithSupplier } from "./ai-endpoint-repo";

export interface RouteWithEndpoint {
  route: AiModelRoute;
  endpoint: SupplierConnectionWithSupplier;
}

export interface EnabledRouteResult {
  route: AiModelRoute;
  model: AiModel;
  endpoint: SupplierConnectionWithSupplier;
}

interface EnabledRouteRow {
  route: AiModelRoute;
  model: AiModel;
  endpoint: AiSupplierConnection;
  supplier: SupplierConnectionWithSupplier["supplier"];
}

export const aiModelRouteRepo = {
  /**
   * Find all enabled routes for a model slug, joining endpoints.
   * Sorted by priority ASC (lower = tried first), then weight DESC.
   * Used by relay logic for multi-endpoint failover.
   */
  async findEnabledRoutesByModelId(modelId: string): Promise<EnabledRouteResult[]> {
    const rows = await queryAll<EnabledRouteRow>(
      db
        .select({
          route: aiModelRoutes,
          model: aiModels,
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
        .from(aiModelRoutes)
        .innerJoin(aiModels, eq(aiModelRoutes.modelId, aiModels.id))
        .innerJoin(aiSupplierConnections, eq(aiModelRoutes.endpointId, aiSupplierConnections.id))
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .where(
          and(
            eq(aiModels.modelId, modelId),
            eq(aiModels.enabled, true),
            eq(aiModelRoutes.enabled, true),
            eq(aiSupplierConnections.enabled, true),
            eq(aiSupplierConnections.autoDisabled, false),
            eq(aiSuppliers.enabled, true),
          ),
        )
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );

    return rows.map((row) => ({
      route: row.route,
      model: row.model,
      endpoint: { ...row.endpoint, supplier: row.supplier },
    }));
  },

  /**
   * Find all enabled routes across ALL models in a single query.
   * Same join + filters + ordering as findEnabledRoutesByModelId but without the modelId filter.
   * Used by aiModelRepo.findAllEnabled to avoid N+1 per-model route lookups.
   */
  async findAllEnabledRoutes(): Promise<EnabledRouteResult[]> {
    const rows = await queryAll<EnabledRouteRow>(
      db
        .select({
          route: aiModelRoutes,
          model: aiModels,
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
        .from(aiModelRoutes)
        .innerJoin(aiModels, eq(aiModelRoutes.modelId, aiModels.id))
        .innerJoin(aiSupplierConnections, eq(aiModelRoutes.endpointId, aiSupplierConnections.id))
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .where(
          and(
            eq(aiModels.enabled, true),
            eq(aiModelRoutes.enabled, true),
            eq(aiSupplierConnections.enabled, true),
            eq(aiSupplierConnections.autoDisabled, false),
            eq(aiSuppliers.enabled, true),
          ),
        )
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );

    return rows.map((row) => ({
      route: row.route,
      model: row.model,
      endpoint: { ...row.endpoint, supplier: row.supplier },
    }));
  },
  async findByModelPk(modelPk: number): Promise<RouteWithEndpoint[]> {
    const rows = await queryAll<EnabledRouteRow>(
      db
        .select({
          route: aiModelRoutes,
          model: aiModels,
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
        .from(aiModelRoutes)
        .innerJoin(aiModels, eq(aiModelRoutes.modelId, aiModels.id))
        .innerJoin(aiSupplierConnections, eq(aiModelRoutes.endpointId, aiSupplierConnections.id))
        .innerJoin(aiSuppliers, eq(aiSupplierConnections.supplierId, aiSuppliers.id))
        .where(eq(aiModelRoutes.modelId, modelPk))
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );

    return rows.map((row) => ({
      route: row.route,
      endpoint: { ...row.endpoint, supplier: row.supplier },
    }));
  },

  /** Find all routes for an endpoint — for endpoint detail counts. */
  async findByEndpointId(endpointId: number): Promise<AiModelRoute[]> {
    return queryAll(
      db.select().from(aiModelRoutes).where(eq(aiModelRoutes.endpointId, endpointId)),
    );
  },

  /** Check if a route exists for this model+endpoint pair. */
  async findByModelAndEndpoint(
    modelPk: number,
    endpointId: number,
  ): Promise<AiModelRoute | undefined> {
    return queryOne(
      db
        .select()
        .from(aiModelRoutes)
        .where(and(eq(aiModelRoutes.modelId, modelPk), eq(aiModelRoutes.endpointId, endpointId))),
    );
  },

  async create(data: NewAiModelRoute): Promise<AiModelRoute> {
    return returningOne(db.insert(aiModelRoutes).values(data));
  },

  async batchCreate(rows: NewAiModelRoute[]): Promise<AiModelRoute[]> {
    if (rows.length === 0) return [];
    return queryAll(db.insert(aiModelRoutes).values(rows).onConflictDoNothing().returning());
  },

  async update(id: number, data: Partial<AiModelRoute>): Promise<AiModelRoute | undefined> {
    return returningOne(
      db
        .update(aiModelRoutes)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiModelRoutes.id, id)),
    );
  },

  async updateForModel(
    modelPk: number,
    id: number,
    data: Partial<AiModelRoute>,
  ): Promise<AiModelRoute | undefined> {
    return returningOne(
      db
        .update(aiModelRoutes)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(aiModelRoutes.id, id), eq(aiModelRoutes.modelId, modelPk))),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiModelRoutes).where(eq(aiModelRoutes.id, id)));
  },

  async deleteForModel(modelPk: number, id: number): Promise<boolean> {
    const deleted = await execWithChanges(
      db
        .delete(aiModelRoutes)
        .where(and(eq(aiModelRoutes.id, id), eq(aiModelRoutes.modelId, modelPk))),
    );
    return deleted > 0;
  },

  async deleteByModelPk(modelPk: number): Promise<void> {
    await exec(db.delete(aiModelRoutes).where(eq(aiModelRoutes.modelId, modelPk)));
  },

  async batchDeleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await exec(db.delete(aiModelRoutes).where(inArray(aiModelRoutes.id, ids)));
  },
};
