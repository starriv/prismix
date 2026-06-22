ALTER TABLE "ai_providers" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_success_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "auto_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "health_status" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "last_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "last_success_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_upstreams" ADD COLUMN "auto_disabled" boolean DEFAULT false NOT NULL;