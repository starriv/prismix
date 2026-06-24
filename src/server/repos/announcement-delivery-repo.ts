import { and, eq, inArray } from "drizzle-orm";

import {
  announcementDeliveries,
  type AnnouncementDelivery,
  db,
  exec,
  queryAll,
  queryOne,
} from "@/server/db";

export const announcementDeliveryRepo = {
  async findByConsumerSurface(
    announcementId: string,
    consumerKeyId: number,
    surface: string,
  ): Promise<AnnouncementDelivery | undefined> {
    return queryOne(
      db
        .select()
        .from(announcementDeliveries)
        .where(
          and(
            eq(announcementDeliveries.announcementId, announcementId),
            eq(announcementDeliveries.consumerKeyId, consumerKeyId),
            eq(announcementDeliveries.surface, surface),
          ),
        ),
    );
  },

  /**
   * Return the set of announcement ids already delivered to a consumer for a
   * surface. Single query replacement for the per-candidate lookup loop.
   * Empty `announcementIds` short-circuits (drizzle's inArray with [] would
   * produce `in ()` which is invalid SQL).
   */
  async findDeliveredAnnouncementIds(
    announcementIds: string[],
    consumerKeyId: number,
    surface: string,
  ): Promise<Set<string>> {
    if (announcementIds.length === 0) return new Set();
    const rows = await queryAll<{ announcementId: string }>(
      db
        .select({ announcementId: announcementDeliveries.announcementId })
        .from(announcementDeliveries)
        .where(
          and(
            inArray(announcementDeliveries.announcementId, announcementIds),
            eq(announcementDeliveries.consumerKeyId, consumerKeyId),
            eq(announcementDeliveries.surface, surface),
          ),
        ),
    );
    return new Set(rows.map((row) => row.announcementId));
  },

  async markDelivered(
    announcementId: string,
    consumerKeyId: number,
    surface: string,
  ): Promise<void> {
    await exec(
      db
        .insert(announcementDeliveries)
        .values({ announcementId, consumerKeyId, surface })
        .onConflictDoNothing(),
    );
  },
};
