/**
 * User repository — CRUD for the `users` table.
 */
import { count, desc, eq } from "drizzle-orm";

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

  async findByEmail(email: string): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.email, email.toLowerCase())));
  },

  async findByAddress(address: string): Promise<User | undefined> {
    return queryOne(db.select().from(users).where(eq(users.address, address.toLowerCase())));
  },

  async findAll(limit = 50, offset = 0): Promise<User[]> {
    return queryAll(
      db.select().from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
    );
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
