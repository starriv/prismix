/**
 * AI Model repository — CRUD for `ai_models` table.
 */
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";

import {
  type AiEndpoint,
  type AiModel,
  aiModels,
  db,
  exec,
  execWithChanges,
  type NewAiModel,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

import type { ClientFormat } from "../ai/lib/client-format";
import { aiModelRouteRepo } from "./ai-model-route-repo";

export const aiModelRepo = {
  /** Find models that have a route to this endpoint. */
  async findByEndpointId(endpointId: number): Promise<AiModel[]> {
    const routes = await aiModelRouteRepo.findByEndpointId(endpointId);
    if (routes.length === 0) return [];
    const modelPks = [...new Set(routes.map((r) => r.modelId))];
    return queryAll(db.select().from(aiModels).where(inArray(aiModels.id, modelPks)));
  },

  /** Find enabled models that have a route to this endpoint. */
  async findEnabledByEndpointId(endpointId: number): Promise<AiModel[]> {
    const models = await this.findByEndpointId(endpointId);
    return models.filter((m) => m.enabled);
  },

  async findById(id: number): Promise<AiModel | undefined> {
    return queryOne(db.select().from(aiModels).where(eq(aiModels.id, id)));
  },

  async findByModelId(
    modelId: string,
    clientFormat: ClientFormat = "openai",
  ): Promise<AiModel | undefined> {
    return queryOne(
      db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.modelId, modelId), eq(aiModels.clientFormat, clientFormat))),
    );
  },

  async findByModelIds(
    modelIds: string[],
    clientFormat: ClientFormat = "openai",
  ): Promise<AiModel[]> {
    if (modelIds.length === 0) return [];
    return queryAll(
      db
        .select()
        .from(aiModels)
        .where(and(inArray(aiModels.modelId, modelIds), eq(aiModels.clientFormat, clientFormat))),
    );
  },

  /**
   * Find an enabled model by model_id slug via route-based lookup.
   * Returns the first (highest-priority) route's endpoint.
   */
  async findEnabledByModelId(
    modelId: string,
    clientFormat: ClientFormat = "openai",
  ): Promise<{ model: AiModel; endpoint: AiEndpoint } | undefined> {
    const routes = await aiModelRouteRepo.findEnabledRoutesByModelId(modelId, clientFormat);
    if (routes.length === 0) return undefined;
    return { model: routes[0].model, endpoint: routes[0].endpoint };
  },

  /** All enabled models (for /v1/models catalog), deduplicated by modelId. */
  async findAllEnabled(
    clientFormat?: ClientFormat,
  ): Promise<Array<{ model: AiModel; endpoint: AiEndpoint }>> {
    const where = clientFormat
      ? and(eq(aiModels.enabled, true), eq(aiModels.clientFormat, clientFormat))
      : eq(aiModels.enabled, true);
    const allModels = await queryAll<AiModel>(
      db.select().from(aiModels).where(where).orderBy(aiModels.id),
    );

    const results: Array<{ model: AiModel; endpoint: AiEndpoint }> = [];
    for (const m of allModels) {
      const routes = await aiModelRouteRepo.findEnabledRoutesByModelId(
        m.modelId,
        m.clientFormat as ClientFormat,
      );
      if (routes.length > 0) {
        results.push({ model: m, endpoint: routes[0].endpoint });
      }
    }
    return results;
  },

  /** All models for admin surfaces, including disabled or currently unrouted rows. */
  async findAll(): Promise<AiModel[]> {
    return queryAll(db.select().from(aiModels).orderBy(aiModels.id));
  },

  async create(data: NewAiModel): Promise<AiModel> {
    return returningOne(db.insert(aiModels).values(data));
  },

  async batchCreate(rows: NewAiModel[]): Promise<AiModel[]> {
    if (rows.length === 0) return [];
    return queryAll(db.insert(aiModels).values(rows).onConflictDoNothing().returning());
  },

  async update(id: number, data: Partial<AiModel>): Promise<AiModel | undefined> {
    return returningOne(
      db
        .update(aiModels)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiModels.id, id)),
    );
  },

  /** Batch-update prices (and optional contextWindow) for multiple models. */
  async batchUpdatePrices(
    updates: Array<{
      id: number;
      inputPrice: string;
      outputPrice: string;
      contextWindow?: number | null;
    }>,
  ): Promise<number> {
    if (updates.length === 0) return 0;

    let count = 0;
    // Drizzle doesn't support multi-row UPDATE in one statement,
    // so we batch individual UPDATEs inside a transaction.
    await db.transaction(async (tx: typeof db) => {
      for (const u of updates) {
        const set: Record<string, unknown> = {
          inputPrice: u.inputPrice,
          outputPrice: u.outputPrice,
          updatedAt: new Date(),
        };
        if (u.contextWindow !== undefined) set.contextWindow = u.contextWindow;

        const res = await tx.update(aiModels).set(set).where(eq(aiModels.id, u.id));
        count += Number(res.rowCount ?? 0);
      }
    });
    return count;
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiModels).where(eq(aiModels.id, id)));
  },

  async batchDelete(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    await exec(db.delete(aiModels).where(inArray(aiModels.id, ids)));
    return ids.length;
  },

  /** Clears the tag AND disables the model — zero-price enabled models are an abuse risk. */
  async disableExpiredLimitedFreeModels(now = new Date()): Promise<number> {
    return execWithChanges(
      db
        .update(aiModels)
        .set({ limitedFreeUntil: null, enabled: false, updatedAt: now })
        .where(and(isNotNull(aiModels.limitedFreeUntil), lte(aiModels.limitedFreeUntil, now))),
    );
  },
};
