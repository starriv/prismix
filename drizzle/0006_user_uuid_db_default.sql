CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "uuid" SET DEFAULT gen_random_uuid()::text;
