DROP INDEX "idx_announcements_status";--> statement-breakpoint
DROP INDEX "idx_announcements_priority";--> statement-breakpoint
CREATE INDEX "idx_announcements_active_sent" ON "announcements" USING btree ("status","priority","sent_at");