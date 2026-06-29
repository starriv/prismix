#!/usr/bin/env tsx
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.local" });

type Role = "admin" | "user";

interface Principal {
  id: number;
  address: string | null;
  email: string | null;
  name: string;
  status?: number;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function option(name: string): string | undefined {
  const args = process.argv.slice(2);
  const eqPrefix = `${name}=`;
  const eqArg = args.find((arg) => arg.startsWith(eqPrefix));
  if (eqArg) return eqArg.slice(eqPrefix.length);

  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function parsePositiveInt(name: string): number | undefined {
  const raw = option(name);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage:
  pnpm dev:auth-token -- --role admin [--id 1 | --address 0x... | --email name@example.com]
  pnpm dev:auth-token -- --role user [--id 1 | --address 0x... | --email name@example.com]
  pnpm dev:auth-token -- --role admin --storage-state /tmp/prismix-admin-state.json
  pnpm dev:auth-token -- --role user --list

Options:
  --role admin|user       Token role to issue. Defaults to admin.
  --id <id>               Select a principal by database id.
  --address <address>     Select a SIWE principal by wallet address.
  --email <email>         Select a Web2 principal by email.
  --list                  List matching principals without issuing tokens.
  --include-disabled      Allow disabled users when --role user is used.
  --limit <n>             Number of rows to list. Defaults to 20 for --list.
  --origin <url>           Browser origin for storage state. Defaults to CORS_ORIGIN or localhost VITE_DEV_PORT.
  --storage-state <path>   Write a Playwright storageState JSON file with the issued auth tokens.
  --show-tokens            Include raw token values in stdout (default: omitted for safety).
`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. Check .env.local.`);
  return value;
}

async function findPrincipals(role: Role): Promise<Principal[]> {
  const id = parsePositiveInt("--id");
  const address = option("--address")?.toLowerCase();
  const email = option("--email")?.toLowerCase();
  const limit = parsePositiveInt("--limit") ?? (hasFlag("--list") ? 20 : 1);
  const includeDisabled = hasFlag("--include-disabled");

  const where: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };

  if (id) add("id = ?", id);
  if (address) add("lower(address) = ?", address);
  if (email) add("lower(email) = ?", email);
  if (role === "user" && !includeDisabled) where.push("status = 1");

  values.push(limit);
  const limitPlaceholder = `$${values.length}`;
  const table = role === "admin" ? "admins" : "users";
  const columns =
    role === "admin" ? "id, address, email, name" : "id, address, email, name, status";
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const pool = new pg.Pool({
    connectionString: requireEnv("DATABASE_URL"),
    max: 1,
    idleTimeoutMillis: 1_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    const result = await pool.query<Principal>(
      `SELECT ${columns} FROM ${table} ${whereClause} ORDER BY id ASC LIMIT ${limitPlaceholder}`,
      values,
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

async function issueToken(role: Role, principal: Principal) {
  requireEnv("JWT_SECRET");
  const { signAccessToken, createRefreshToken } = await import("@/server/lib/jwt");
  const { closeDb } = await import("@/server/db");

  try {
    const address = principal.address ?? undefined;
    const token = await signAccessToken({ userId: principal.id, address, role });
    const refreshToken = await createRefreshToken(principal.id, address, role);
    return { token, refreshToken };
  } finally {
    await closeDb();
  }
}

function resolveOrigin(): string {
  const explicit = option("--origin");
  if (explicit) return explicit;
  if (process.env.CORS_ORIGIN) return process.env.CORS_ORIGIN;
  return `http://localhost:${process.env.VITE_DEV_PORT || "5189"}`;
}

function buildStorageState(
  origin: string,
  tokenKey: string,
  token: string,
  refreshTokenKey: string,
  refreshToken: string,
) {
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          { name: tokenKey, value: token },
          { name: refreshTokenKey, value: refreshToken },
        ],
      },
    ],
  };
}

function writeStorageState(
  storageStatePath: string,
  storageState: ReturnType<typeof buildStorageState>,
): void {
  const dir = path.dirname(storageStatePath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(storageStatePath, `${JSON.stringify(storageState, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function main(): Promise<void> {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  const role = (option("--role") ?? "admin") as Role;
  if (role !== "admin" && role !== "user") {
    throw new Error("--role must be admin or user");
  }

  const principals = await findPrincipals(role);
  if (hasFlag("--list")) {
    console.log(JSON.stringify({ role, principals }, null, 2));
    return;
  }

  if (principals.length === 0) {
    throw new Error(`No matching ${role} principal found in the local database.`);
  }

  const principal = principals[0];
  const { token, refreshToken } = await issueToken(role, principal);
  const tokenKey = role === "admin" ? "prismix_admin_token" : "prismix_user_token";
  const refreshTokenKey =
    role === "admin" ? "prismix_admin_refresh_token" : "prismix_user_refresh_token";
  const issuedAt = new Date().toISOString();

  const origin = resolveOrigin();
  const storageState = buildStorageState(origin, tokenKey, token, refreshTokenKey, refreshToken);
  const storageStatePath = option("--storage-state");
  if (storageStatePath) writeStorageState(storageStatePath, storageState);

  // Only print non-secret metadata to stdout. The full token values live in
  // the storage-state file (0o600) and must not be echoed to logs/CI output.
  const showTokens = hasFlag("--show-tokens");
  console.log(
    JSON.stringify(
      {
        role,
        principal,
        issuedAt,
        storage: {
          tokenKey,
          refreshTokenKey,
          ...(showTokens ? { token, refreshToken } : {}),
        },
        playwrightStorageStatePath: storageStatePath ?? null,
        playwrightStorageStateOrigin: origin,
        tokenFingerprint: crypto.createHash("sha256").update(token).digest("hex").slice(0, 12),
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
