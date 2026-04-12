/**
 * PostgreSQL adapter (the only adapter) — node-postgres (pg) + Drizzle ORM.
 *
 * Requires DATABASE_URL env var.
 * All Drizzle operations are natively async.
 *
 * Schema management:
 *   - First deploy (empty DB) : auto migrate + seed
 *   - Upgrades                : user runs `pnpm db:migrate` before restarting
 *   - deploy/seed/pg.sql      : seed data, run on first deploy only
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { log } from "@/server/lib/logger";

import type { DbAdapter } from "./adapter";
import * as schema from "./schemas/pg";

/* eslint-disable @typescript-eslint/no-explicit-any */

export class PgAdapter implements DbAdapter {
  readonly db;
  readonly schema = schema;
  private pool: pg.Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required — PostgreSQL is the only supported database");
    }

    this.pool = new pg.Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 20),
      min: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    this.pool.on("error", (err) => {
      log.pg.error({ err }, "Unexpected pool error");
    });

    this.db = drizzle(this.pool, { schema });
  }

  // ── DbAdapter query methods ─────────────────────────────────────────

  async queryOne<T>(qb: any): Promise<T | undefined> {
    const rows = await qb;
    return rows[0] as T | undefined;
  }

  async queryAll<T>(qb: any): Promise<T[]> {
    return (await qb) as T[];
  }

  async exec(qb: any): Promise<void> {
    await qb;
  }

  async returningOne<T>(qb: any): Promise<T> {
    const rows = await qb.returning();
    return rows[0] as T;
  }

  async execWithChanges(qb: any): Promise<number> {
    const result = await qb;
    return result.rowCount ?? 0;
  }

  async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  // ── Schema init ─────────────────────────────────────────────────────

  /**
   * First-deploy auto-init + seed.
   *
   * Checks for __drizzle_migrations table:
   *   - Not found → first deploy → run all migrations from journal + seed
   *   - Found     → existing DB → skip
   *
   * Uses a custom migration runner instead of drizzle-orm's `migrate()` due
   * to known issues in drizzle-orm v0.45.1:
   *   - migrationsSchema defaults to "drizzle" not "public" — our detection
   *     query checks "public", so migrate() appears to succeed but the
   *     tracking table lands in the wrong schema
   *   - Silent failures in Docker/Linux environments (sort order, ESM compat)
   *   - Ref: https://github.com/drizzle-team/drizzle-orm/issues/5289
   *   - Ref: https://github.com/drizzle-team/drizzle-orm/issues/5123
   *
   * TODO: When drizzle-orm releases a version that fixes these, revisit
   * whether the programmatic migrate() can replace this custom runner.
   * If so, pass { migrationsSchema: "public" } to match our detection.
   *
   * Reads drizzle-kit's _journal.json + SQL files, writes to
   * __drizzle_migrations in the same format so `pnpm db:migrate` stays
   * compatible.
   */
  async init(): Promise<void> {
    const migrationsDir = path.join(process.cwd(), "drizzle");
    if (!fs.existsSync(migrationsDir)) return;

    const client = await this.pool.connect();
    try {
      // Detect first deploy
      const { rows } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = '__drizzle_migrations'
        LIMIT 1
      `);
      if (rows.length > 0) return; // Existing DB — skip

      // Read drizzle-kit journal
      const journalPath = path.join(migrationsDir, "meta", "_journal.json");
      if (!fs.existsSync(journalPath)) {
        log.pg.warn("No _journal.json found — skipping migration");
        return;
      }

      const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
        entries: { tag: string; when: number; breakpoints?: boolean }[];
      };

      // Create tracking table (drizzle-kit compatible schema)
      await client.query(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash TEXT NOT NULL,
          created_at BIGINT
        )
      `);

      // Apply each migration
      for (const entry of journal.entries) {
        const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
        if (!fs.existsSync(sqlFile)) {
          log.pg.error({ file: sqlFile }, "Migration file not found");
          throw new Error(`Migration file not found: ${entry.tag}.sql`);
        }

        const sql = fs.readFileSync(sqlFile, "utf-8");
        const hash = crypto.createHash("sha256").update(sql).digest("hex");

        // Split on --> statement-breakpoint if breakpoints enabled
        const statements = entry.breakpoints
          ? sql
              .split("--> statement-breakpoint")
              .map((s) => s.trim())
              .filter(Boolean)
          : [sql];

        await client.query("BEGIN");
        try {
          for (const stmt of statements) {
            await client.query(stmt);
          }
          await client.query(
            "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [hash, entry.when],
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }

      log.pg.info({ count: journal.entries.length }, "First deploy — schema initialised");

      // Seed default data
      const seedFile = path.join(process.cwd(), "deploy", "seed", "pg.sql");
      if (fs.existsSync(seedFile)) {
        await client.query(fs.readFileSync(seedFile, "utf-8"));
      }
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
