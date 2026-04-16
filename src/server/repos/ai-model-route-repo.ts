/**
 * AI Model Route repository — CRUD for `ai_model_routes` junction table.
 * Routes link models to providers with priority-based failover.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  type AiModel,
  type AiModelRoute,
  aiModelRoutes,
  aiModels,
  type AiProvider,
  aiProviders,
  db,
  exec,
  execWithChanges,
  type NewAiModelRoute,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export interface RouteWithProvider {
  route: AiModelRoute;
  provider: AiProvider;
}

export interface EnabledRouteResult {
  route: AiModelRoute;
  model: AiModel;
  provider: AiProvider;
}

export const aiModelRouteRepo = {
  /**
   * Find all enabled routes for a model slug, joining providers.
   * Sorted by priority ASC (lower = tried first), then weight DESC.
   * Used by relay logic for multi-provider failover.
   */
  async findEnabledRoutesByModelId(modelId: string): Promise<EnabledRouteResult[]> {
    return queryAll<EnabledRouteResult>(
      db
        .select({ route: aiModelRoutes, model: aiModels, provider: aiProviders })
        .from(aiModelRoutes)
        .innerJoin(aiModels, eq(aiModelRoutes.modelId, aiModels.id))
        .innerJoin(aiProviders, eq(aiModelRoutes.providerId, aiProviders.id))
        .where(
          and(
            eq(aiModels.modelId, modelId),
            eq(aiModels.enabled, true),
            eq(aiModelRoutes.enabled, true),
            eq(aiProviders.enabled, true),
          ),
        )
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );
  },

  /** Find all routes for a model (by model PK) — for admin UI. */
  async findByModelPk(modelPk: number): Promise<RouteWithProvider[]> {
    return queryAll<RouteWithProvider>(
      db
        .select({ route: aiModelRoutes, provider: aiProviders })
        .from(aiModelRoutes)
        .innerJoin(aiProviders, eq(aiModelRoutes.providerId, aiProviders.id))
        .where(eq(aiModelRoutes.modelId, modelPk))
        .orderBy(asc(aiModelRoutes.priority), desc(aiModelRoutes.weight), asc(aiModelRoutes.id)),
    );
  },

  /** Find all routes for a provider — for provider detail counts. */
  async findByProviderId(providerId: number): Promise<AiModelRoute[]> {
    return queryAll(
      db.select().from(aiModelRoutes).where(eq(aiModelRoutes.providerId, providerId)),
    );
  },

  /** Check if a route exists for this model+provider pair. */
  async findByModelAndProvider(
    modelPk: number,
    providerId: number,
  ): Promise<AiModelRoute | undefined> {
    return queryOne(
      db
        .select()
        .from(aiModelRoutes)
        .where(and(eq(aiModelRoutes.modelId, modelPk), eq(aiModelRoutes.providerId, providerId))),
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
