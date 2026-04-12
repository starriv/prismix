#!/usr/bin/env tsx
/**
 * db:reset — Wipe PostgreSQL database and regenerate drizzle-kit migrations.
 *
 * Safety:
 *   - Only runs when NODE_ENV is unset or "development"
 *   - Requires interactive confirmation (Enter to proceed)
 *
 * Usage:
 *   pnpm db:reset
 */

import { createInterface } from "readline";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ── Safety checks ──────────────────────────────────────────────────────

const env = process.env.NODE_ENV ?? "development";
if (env !== "development") {
  console.error(`✗ db:reset is blocked in NODE_ENV="${env}".`);
  console.error("  This command destroys all data. It is only allowed in development.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL is not set. Cannot reset PostgreSQL.");
  process.exit(1);
}

console.log("⚠  db:reset will DESTROY the following database:\n");
console.log("   • PostgreSQL (DROP SCHEMA public)\n");
console.log("   All data will be lost. Migration files will be regenerated.\n");

// Interactive confirmation
const confirmed = await new Promise<boolean>((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Press Enter to continue, or Ctrl+C to cancel... ", () => {
    rl.close();
    resolve(true);
  });
});

if (!confirmed) process.exit(0);

// ── Helpers ────────────────────────────────────────────────────────────

/** Remove all drizzle-kit generated files (SQL + meta/) */
function cleanMigrationDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

// ── PostgreSQL ─────────────────────────────────────────────────────────

const { default: pgLib } = await import("pg");
const client = new pgLib.Client({ connectionString: url });
try {
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO public");
  console.log("✓ PostgreSQL schema dropped and recreated");
} catch (err) {
  console.error("✗ PostgreSQL reset failed:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await client.end();
}

cleanMigrationDir(path.join(process.cwd(), "drizzle", "pg"));

console.log("\nGenerating PostgreSQL migration...");
execSync("pnpm drizzle-kit generate", { stdio: "inherit" });
console.log("✓ PostgreSQL reset complete\n");

console.log("Done. Restart the server to rebuild from migrations.");
