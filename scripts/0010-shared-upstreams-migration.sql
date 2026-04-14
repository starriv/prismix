CREATE TABLE "ai_upstream_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"upstream_id" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_upstream_assignments_provider_id_upstream_id_unique" UNIQUE("provider_id","upstream_id")
);
--> statement-breakpoint
CREATE TABLE "ai_upstreams" (
	"id" serial PRIMARY KEY NOT NULL,
	"upstream_id" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_upstreams_upstream_id_unique" UNIQUE("upstream_id")
);
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" ADD CONSTRAINT "ai_upstream_assignments_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" ADD CONSTRAINT "ai_upstream_assignments_upstream_id_ai_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."ai_upstreams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_upstream_assignments_provider_id" ON "ai_upstream_assignments" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_ai_upstream_assignments_upstream_id" ON "ai_upstream_assignments" USING btree ("upstream_id");--> statement-breakpoint

INSERT INTO "ai_upstreams" (
	"id",
	"upstream_id",
	"name",
	"base_url",
	"kind",
	"enabled",
	"metadata",
	"updated_at",
	"created_at"
)
	SELECT
		old."id",
		CASE
			WHEN COUNT(*) OVER (PARTITION BY old."upstream_id") = 1 THEN old."upstream_id"
			ELSE CONCAT('migrated-', old."id", '-', old."upstream_id")
		END,
	old."name",
	old."base_url",
	old."kind",
	old."enabled",
	old."metadata",
	old."updated_at",
	old."created_at"
FROM "ai_provider_upstreams" old;
--> statement-breakpoint

INSERT INTO "ai_upstream_assignments" (
	"provider_id",
	"upstream_id",
	"priority",
	"weight",
	"enabled",
	"updated_at",
	"created_at"
)
SELECT
	old."provider_id",
	old."id",
	old."priority",
	old."weight",
	old."enabled",
	old."updated_at",
	old."created_at"
FROM "ai_provider_upstreams" old;
--> statement-breakpoint

SELECT setval(
	pg_get_serial_sequence('"ai_upstreams"', 'id'),
	COALESCE((SELECT MAX("id") FROM "ai_upstreams"), 1),
	true
);
--> statement-breakpoint

ALTER TABLE "ai_keys" DROP CONSTRAINT "ai_keys_upstream_id_ai_provider_upstreams_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_upstream_id_ai_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."ai_upstreams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "ai_provider_upstreams" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ai_provider_upstreams" CASCADE;
--> statement-breakpoint

-- Remove DB-level uuid default (now generated in application code via $defaultFn)
ALTER TABLE "users" ALTER COLUMN "uuid" DROP DEFAULT;
DROP FUNCTION IF EXISTS uuid_v7_text();
DROP EXTENSION IF EXISTS pgcrypto;
