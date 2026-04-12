/**
 * AI Guardrail Config repository — guardrail rules.
 */
import { eq } from "drizzle-orm";

import {
  type AiGuardrailConfig,
  aiGuardrailConfigs,
  db,
  exec,
  type NewAiGuardrailConfig,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiGuardrailConfigRepo = {
  async findAll(): Promise<AiGuardrailConfig[]> {
    return queryAll(db.select().from(aiGuardrailConfigs));
  },

  async findAllEnabled(): Promise<AiGuardrailConfig[]> {
    return queryAll(
      db.select().from(aiGuardrailConfigs).where(eq(aiGuardrailConfigs.enabled, true)),
    );
  },

  async findById(id: number): Promise<AiGuardrailConfig | undefined> {
    return queryOne(db.select().from(aiGuardrailConfigs).where(eq(aiGuardrailConfigs.id, id)));
  },

  async create(data: NewAiGuardrailConfig): Promise<AiGuardrailConfig> {
    return returningOne(db.insert(aiGuardrailConfigs).values(data));
  },

  async update(
    id: number,
    data: Partial<AiGuardrailConfig>,
  ): Promise<AiGuardrailConfig | undefined> {
    return returningOne(
      db
        .update(aiGuardrailConfigs)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiGuardrailConfigs.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiGuardrailConfigs).where(eq(aiGuardrailConfigs.id, id)));
  },
};
