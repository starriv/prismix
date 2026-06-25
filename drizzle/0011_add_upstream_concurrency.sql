ALTER TABLE "ai_upstreams" ADD COLUMN "concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "queue_timeout_ms" integer DEFAULT 30000 NOT NULL;
