CREATE TABLE "announcement_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcement_id" text NOT NULL,
	"consumer_key_id" integer NOT NULL,
	"surface" text NOT NULL,
	"delivered_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "severity" text DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "surfaces" text DEFAULT '["web"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "related_models" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "starts_at" timestamp;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_announcement_deliveries_announcement_id" ON "announcement_deliveries" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "idx_announcement_deliveries_consumer_key_id" ON "announcement_deliveries" USING btree ("consumer_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_announcement_deliveries_announcement_consumer_surface" ON "announcement_deliveries" USING btree ("announcement_id","consumer_key_id","surface");--> statement-breakpoint
CREATE INDEX "idx_announcements_priority" ON "announcements" USING btree ("priority");