/**
 * User repository — CRUD for the `users` table.
 */
import { and, count, desc, eq, ilike } from "drizzle-orm";

import {
  db,
  exec,
  type NewUser,
  queryAll,
  queryOne,
  returningOne,
  type User,
  users,
} from "@/server/db";

export const userRepo = {
  async findById(id: number): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.id, id)));
  },

  async findByUuid(uuid: string): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.uuid, uuid)));
  },

  async findByEmail(email: string): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.email, email.toLowerCase())));
  },

  async findByAddress(address: string): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.address, address.toLowerCase())));
  },

  async findAll(
    limit = 50,
    offset = 0,
    filters?: { id?: number; uuid?: string; name?: string; email?: string; address?: string },
  ): Promise<User[]> {
    const esc = (v: string) => v.replace(/[%_]/g, "\\$&");
    const conditions = [];
    if (filters?.id) conditions.push(eq(users.id, filters.id));
    if (filters?.uuid) conditions.push(ilike(users.uuid, `%${esc(filters.uuid)}%`));
    if (filters?.name) conditions.push(ilike(users.name, `%${esc(filters.name)}%`));
    if (filters?.email) conditions.push(ilike(users.email, `%${esc(filters.email)}%`));
    if (filters?.address) conditions.push(ilike(users.address, `%${esc(filters.address)}%`));

    const qb = db.select().from(users);
    if (conditions.length) qb.where(and(...conditions));
    return queryAll(qb.orderBy(desc(users.createdAt)).limit(limit).offset(offset));
  },

  async create(data: NewUser): Promise<User> {
    return returningOne(db.insert(users).values(data));
  },

  async update(id: number, data: Partial<NewUser>): Promise<User | undefined> {
    return returningOne(
      db
        .update(users)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(users.id, id)),
    );
  },

  async setAgentId(userId: number, agentId: number): Promise<User | undefined> {
    return returningOne(
      db.update(users).set({ agentId, updatedAt: new Date() }).where(eq(users.id, userId)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(users).where(eq(users.id, id)));
  },

  async count(): Promise<number> {
    const row = await queryOne<{ total: number }>(db.select({ total: count() }).from(users));
    return row?.total ?? 0;
  },
};
