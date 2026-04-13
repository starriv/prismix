ALTER TABLE "ai_providers"
ADD COLUMN "upstream_routing_strategy" text NOT NULL DEFAULT 'priority';--> statement-breakpoint

CREATE TABLE "ai_provider_upstreams" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider_id" integer NOT NULL REFERENCES "ai_providers"("id") ON DELETE cascade,
  "upstream_id" text NOT NULL,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'custom',
  "priority" integer NOT NULL DEFAULT 100,
  "weight" integer NOT NULL DEFAULT 1,
  "enabled" boolean NOT NULL DEFAULT true,
  "metadata" text NOT NULL DEFAULT '{}',
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ai_provider_upstreams_provider_id_upstream_id_unique" UNIQUE("provider_id","upstream_id")
);--> statement-breakpoint

CREATE INDEX "idx_ai_provider_upstreams_provider_id"
ON "ai_provider_upstreams" USING btree ("provider_id");--> statement-breakpoint

ALTER TABLE "ai_keys"
ADD COLUMN "upstream_id" integer REFERENCES "ai_provider_upstreams"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "idx_ai_keys_upstream_id"
ON "ai_keys" USING btree ("upstream_id");--> statement-breakpoint

ALTER TABLE "ai_usage_logs"
ADD COLUMN "upstream_id" integer;--> statement-breakpoint
ALTER TABLE "ai_usage_logs"
ADD COLUMN "upstream_name" text;--> statement-breakpoint

CREATE INDEX "idx_ai_usage_logs_upstream_id"
ON "ai_usage_logs" USING btree ("upstream_id");--> statement-breakpoint
