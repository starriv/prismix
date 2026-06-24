import { z } from "zod";

// ── Centralized env var validation ──────────────────────────────────
// Validates process.env at import time so misconfiguration is caught
// immediately on startup. Env vars are loaded before this module runs:
//   dev  → tsx --env-file=.env.local  (loads file before any code)
//   prod → platform injects env vars  (Railway, Docker, etc.)

const envSchema = z.object({
  // Required in all environments
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters (recommend: openssl rand -hex 32)"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (PostgreSQL connection string)"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required (Redis connection string)"),

  // Ports — API requires PORT at its entry point; the worker exposes a health
  // server on WORKER_HEALTH_PORT (default 3404). VITE_DEV_PORT is dev-only.
  PORT: z.coerce.number().int().positive().optional(),
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3404),
  VITE_DEV_PORT: z.coerce.number().int().positive().optional(),
  ROLE: z.enum(["all", "api", "worker"]).optional(),

  // Optional — have sensible defaults
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
  DOMAIN: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(20),

  // Security — optional but recommended in production
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_SALT: z.string().optional(),

  // Admin seeding — optional

  // External services — optional
  ALCHEMY_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Environment validation failed:\n${issues}`);
}

/**
 * Validated environment variables — use this instead of raw process.env
 * for type-safe access to required variables.
 */
export const env = parsed.data;
