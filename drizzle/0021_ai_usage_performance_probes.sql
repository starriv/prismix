ALTER TABLE "ai_usage_logs" ADD COLUMN "route_type" text;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "is_stream" boolean;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "cache_status" text;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "cache_lookup_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "cache_write_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "routing_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "queue_wait_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "upstream_ttfb_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "upstream_body_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "transform_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "billing_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "first_chunk_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "first_token_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "request_bytes" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "response_bytes" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "stream_chunks" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "stream_bytes" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "stream_ping_count" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "stream_abort_reason" text;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;