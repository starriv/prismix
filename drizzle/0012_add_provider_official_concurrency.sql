ALTER TABLE "ai_providers" ADD COLUMN "official_concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "official_queue_timeout_ms" integer DEFAULT 30000 NOT NULL;
