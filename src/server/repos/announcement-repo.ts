import { desc, eq } from "drizzle-orm";
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

export const announcementRepo = {
  async findAll(): Promise<Announcement[]> {
    return queryAll(db.select().from(announcements).orderBy(desc(announcements.createdAt)));
  },

  async findById(id: string): Promise<Announcement | undefined> {
    return queryOne(db.select().from(announcements).where(eq(announcements.id, id)));
  },

  async create(data: Omit<NewAnnouncement, "id">): Promise<Announcement> {
    return returningOne(db.insert(announcements).values({ id: nanoid(), ...data }));
  },

  async update(
    id: string,
    data: Partial<Pick<Announcement, "title" | "body" | "link">>,
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
