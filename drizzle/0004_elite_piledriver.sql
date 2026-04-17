CREATE TABLE "ai_upstream_model_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"upstream_id" integer NOT NULL,
	"source_model_id" text NOT NULL,
	"mapped_model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_upstream_model_mappings_upstream_id_source_model_id_unique" UNIQUE("upstream_id","source_model_id")
);
--> statement-breakpoint
CREATE INDEX "idx_ai_upstream_model_mappings_upstream_id" ON "ai_upstream_model_mappings" USING btree ("upstream_id");