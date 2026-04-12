/**
 * AI Model repository — CRUD for `ai_models` table.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  type AiModel,
  aiModels,
  type AiProvider,
  aiProviders,
  db,
  exec,
  type NewAiModel,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiModelRepo = {
  async findByProviderId(providerId: number): Promise<AiModel[]> {
    return queryAll(db.select().from(aiModels).where(eq(aiModels.providerId, providerId)));
  },

  async findEnabledByProviderId(providerId: number): Promise<AiModel[]> {
    return queryAll(
      db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.providerId, providerId), eq(aiModels.enabled, true))),
    );
  },

  async findById(id: number): Promise<AiModel | undefined> {
    return queryOne(db.select().from(aiModels).where(eq(aiModels.id, id)));
  },

  async findByProviderAndModelId(
    providerId: number,
    modelId: string,
  ): Promise<AiModel | undefined> {
    return queryOne(
      db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.providerId, providerId), eq(aiModels.modelId, modelId))),
    );
  },

  /** Find an enabled model by model_id slug, joining with enabled providers. */
  async findEnabledByModelId(
    modelId: string,
  ): Promise<{ model: AiModel; provider: AiProvider } | undefined> {
    return queryOne<{ model: AiModel; provider: AiProvider }>(
      db
        .select({ model: aiModels, provider: aiProviders })
        .from(aiModels)
        .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
        .where(
          and(
            eq(aiModels.modelId, modelId),
            eq(aiModels.enabled, true),
            eq(aiProviders.enabled, true),
          ),
        )
        .limit(1),
    );
  },

  /** All enabled models (for /v1/models catalog). */
  async findAllEnabled(): Promise<Array<{ model: AiModel; provider: AiProvider }>> {
    return queryAll(
      db
        .select({ model: aiModels, provider: aiProviders })
        .from(aiModels)
        .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.id))
        .where(and(eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
        .orderBy(aiModels.id),
    );
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
};
