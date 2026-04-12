/**
 * Settings repository — global key-value settings.
 */
import { eq } from "drizzle-orm";
import { fromPairs } from "lodash-es";

import { db, exec, globalSettings, queryAll, queryOne } from "@/server/db";

export const settingsRepo = {
  async getGlobal(key: string): Promise<string | undefined> {
    const row = await queryOne<{ value: string }>(
      db.select().from(globalSettings).where(eq(globalSettings.key, key)),
    );
    return row?.value;
  },

  async setGlobal(key: string, value: string): Promise<void> {
    const now = new Date();
    const existing = await queryOne<{ id: number }>(
      db.select().from(globalSettings).where(eq(globalSettings.key, key)),
    );

    if (existing) {
      await exec(
        db
          .update(globalSettings)
          .set({ value, updatedAt: now })
          .where(eq(globalSettings.id, existing.id)),
      );
    } else {
      await exec(db.insert(globalSettings).values({ key, value, updatedAt: now }));
    }
  },

  async getAllGlobal(): Promise<Record<string, string>> {
    const rows = await queryAll<{ key: string; value: string }>(db.select().from(globalSettings));
    return fromPairs(rows.map((row) => [row.key, row.value]));
  },
};
