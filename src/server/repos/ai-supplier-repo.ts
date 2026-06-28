/**
 * AI Supplier repository — CRUD for real AI vendors.
 */
import { asc, eq, inArray } from "drizzle-orm";

import {
  type AiSupplier,
  aiSuppliers,
  db,
  exec,
  type NewAiSupplier,
  queryAll,
  queryOne,
  returningOne,
} from "@/server/db";

export const aiSupplierRepo = {
  async findAll(limit = 200, offset = 0): Promise<AiSupplier[]> {
    return queryAll(
      db.select().from(aiSuppliers).orderBy(asc(aiSuppliers.id)).limit(limit).offset(offset),
    );
  },

  async findById(id: number): Promise<AiSupplier | undefined> {
    return queryOne(db.select().from(aiSuppliers).where(eq(aiSuppliers.id, id)));
  },

  async findByIds(ids: number[]): Promise<AiSupplier[]> {
    if (ids.length === 0) return [];
    return queryAll(db.select().from(aiSuppliers).where(inArray(aiSuppliers.id, ids)));
  },

  async findBySupplierId(supplierId: string): Promise<AiSupplier | undefined> {
    return queryOne(db.select().from(aiSuppliers).where(eq(aiSuppliers.supplierId, supplierId)));
  },

  async create(data: NewAiSupplier): Promise<AiSupplier> {
    return returningOne(db.insert(aiSuppliers).values(data));
  },

  async update(id: number, data: Partial<AiSupplier>): Promise<AiSupplier | undefined> {
    return returningOne(
      db
        .update(aiSuppliers)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(aiSuppliers.id, id)),
    );
  },

  async delete(id: number): Promise<void> {
    await exec(db.delete(aiSuppliers).where(eq(aiSuppliers.id, id)));
  },
};
