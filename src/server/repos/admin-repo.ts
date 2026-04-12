/**
 * Admin repository — CRUD for the `admins` table.
 */
import { count, eq } from "drizzle-orm";

import {
  type Admin,
  admins,
  db,
  exec,
  type NewAdmin,
  queryAll,
  queryOne,
  returningOne,
  transaction,
} from "@/server/db";

export const adminRepo = {
  async findById(id: number): Promise<Admin | undefined> {
    return queryOne(db.select().from(admins).where(eq(admins.id, id)));
  },

  async findByAddress(address: string): Promise<Admin | undefined> {
    return queryOne(db.select().from(admins).where(eq(admins.address, address.toLowerCase())));
  },

  async findAll(): Promise<Admin[]> {
    return queryAll(db.select().from(admins));
  },

  async create(data: NewAdmin): Promise<Admin> {
    return returningOne(db.insert(admins).values(data));
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(admins).where(eq(admins.id, id)));
  },

  /**
   * Atomically create the first admin — only succeeds if no admins exist.
   * Uses a transaction to prevent the race where two concurrent requests
   * both see zero admins and both register as admin.
   * Returns the created admin, or null if admins already exist.
   */
  async createFirstAdmin(data: NewAdmin): Promise<Admin | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return transaction(async (tx: any) => {
      const row = await tx.select({ total: count() }).from(admins);
      const total = row?.[0]?.total ?? 0;
      if (total > 0) return null;
      const rows = await tx.insert(admins).values(data).returning();
      return (rows[0] ?? rows) as Admin;
    });
  },
};
