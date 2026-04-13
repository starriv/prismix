ALTER TABLE "ai_usage_logs" ADD COLUMN "key_owner_id" integer;--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_key_owner_id" ON "ai_usage_logs" USING btree ("key_owner_id");--> statement-breakpoint
UPDATE "ai_usage_logs" AS l
SET "key_owner_id" = k."owner_id"
FROM "ai_keys" AS k
WHERE l."key_id" = k."id" AND l."key_owner_id" IS NULL;--> statement-breakpoint
