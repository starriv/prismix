ALTER TABLE "ai_models" ADD COLUMN "limited_free_until" timestamp;--> statement-breakpoint
CREATE INDEX "idx_ai_models_limited_free_until" ON "ai_models" USING btree ("limited_free_until");