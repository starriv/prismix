/**
 * AI Model Route repository — CRUD for `ai_model_routes` junction table.
 * Routes link models to endpoints with priority-based failover.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  type AiEndpoint,
  aiEndpoints,
  type AiModel,
  type AiModelRoute,
  aiModelRoutes,
  aiModels,
  aiSuppliers,
  db,
  exec,
  execWithChanges,
  type NewAiModelRoute,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

import type { ClientFormat } from "../ai/lib/client-format";

export interface RouteWithEndpoint {
  route: AiModelRoute;
  endpoint: AiEndpoint;
}

export interface EnabledRouteResult {
  route: AiModelRoute;
  model: AiModel;
  endpoint: AiEndpoint;
}

export const aiModelRouteRepo = {
  /**
   * Find all enabled routes for a model slug, joining endpoints.
   * Sorted by priority ASC (lower = tried first), then weight DESC.
   * Used by relay logic for multi-endpoint failover.
   */
  async findEnabledRoutesByModelId(
    modelId: string,
    clientFormat: ClientFormat = "openai",
  ): Promise<EnabledRouteResult[]> {
    return queryAll<EnabledRouteResult>(
      db
        .select({ route: aiModelRoutes, model: aiModels, endpoint: aiEndpoints })
        .from(aiModelRoutes)
        .innerJoin(aiModels, eq(aiModelRoutes.modelId, aiModels.id))
        .innerJoin(aiEndpoints, eq(aiModelRoutes.endpointId, aiEndpoints.id))
        .innerJoin(aiSuppliers, eq(aiEndpoints.supplierId, aiSuppliers.id))
        .where(
          and(
            eq(aiModels.modelId, modelId),
            eq(aiModels.clientFormat, clientFormat),
            eq(aiModels.enabled, true),
            eq(aiModelRoutes.enabled, true),
            eq(aiEndpoints.enabled, true),
            eq(aiEndpoints.autoDisabled, false),
            eq(aiSuppliers.enabled, true),
          ),
        )
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );
  },

  /** Find all routes for a model (by model PK) — for admin UI. */
  async findByModelPk(modelPk: number): Promise<RouteWithEndpoint[]> {
    return queryAll<RouteWithEndpoint>(
      db
        .select({ route: aiModelRoutes, endpoint: aiEndpoints })
        .from(aiModelRoutes)
        .innerJoin(aiEndpoints, eq(aiModelRoutes.endpointId, aiEndpoints.id))
        .where(eq(aiModelRoutes.modelId, modelPk))
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );
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
