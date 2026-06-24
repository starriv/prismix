import { and, count, desc, eq, gte, isNull, like, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  type Announcement,
  announcements,
  db,
  exec,
  type NewAnnouncement,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";
import { type AnnouncementSurface, surfaceLikePattern } from "@/shared/announcements";

export const announcementRepo = {
  async findAll(opts?: { limit?: number; offset?: number }): Promise<Announcement[]> {
    let q = db.select().from(announcements).orderBy(desc(announcements.createdAt)).$dynamic();
    if (opts?.limit != null) q = q.limit(opts.limit);
    if (opts?.offset != null) q = q.offset(opts.offset);
    return queryAll(q);
  },

  async count(): Promise<number> {
    const row = await queryOne<{ total: number }>(
      db.select({ total: count() }).from(announcements),
    );
    return row?.total ?? 0;
  },

  async findById(id: string): Promise<Announcement | undefined> {
    return queryOne(db.select().from(announcements).where(eq(announcements.id, id)));
  },

  async create(data: Omit<NewAnnouncement, "id">): Promise<Announcement> {
    return returningOne(db.insert(announcements).values({ id: nanoid(), ...data }));
  },

  async update(
    id: string,
    data: Partial<
      Pick<
        Announcement,
        | "title"
        | "body"
        | "link"
        | "category"
        | "severity"
        | "surfaces"
        | "relatedModels"
        | "startsAt"
        | "expiresAt"
        | "priority"
      >
    >,
  ): Promise<Announcement | undefined> {
    return returningOne(
      db
        .update(announcements)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(announcements.id, id)),
    );
  },

  async delete(id: string): Promise<void> {
    await exec(db.delete(announcements).where(eq(announcements.id, id)));
  },

  /**
   * Active sent announcements, optionally filtered by surface.
   * The surface filter is pushed down to SQL (LIKE on the JSON text column) so
   * low-priority announcements for a less-common surface are not evicted from
   * the result window by a flood of higher-priority announcements for other
   * surfaces — the in-memory filter that preceded this could silently drop them.
   */
  async findActiveSent(limit = 50, surface?: AnnouncementSurface): Promise<Announcement[]> {
    const now = new Date();
    return queryAll(
      db
        .select()
        .from(announcements)
        .where(
          and(
            eq(announcements.status, "sent"),
            or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
            or(isNull(announcements.expiresAt), gte(announcements.expiresAt, now)),
            ...(surface ? [like(announcements.surfaces, surfaceLikePattern(surface))] : []),
          ),
        )
        .orderBy(
          desc(announcements.priority),
          desc(announcements.sentAt),
          desc(announcements.createdAt),
        )
        .limit(limit),
    );
  },

  async findRecentSent(limit = 10): Promise<Announcement[]> {
    return queryAll(
      db
        .select()
        .from(announcements)
        .where(eq(announcements.status, "sent"))
        .orderBy(desc(announcements.sentAt))
        .limit(limit),
    );
  },

  async markSent(id: string): Promise<Announcement | undefined> {
    return returningOne(
      db
        .update(announcements)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(announcements.id, id)),
    );
  },
};
