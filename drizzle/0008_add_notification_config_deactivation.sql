ALTER TABLE "notification_configs" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_configs" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_configs" ADD COLUMN "last_failure_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_configs" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "notification_configs" ADD COLUMN "disabled_at" timestamp;