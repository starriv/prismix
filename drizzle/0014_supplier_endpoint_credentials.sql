CREATE TABLE "ai_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_suppliers_supplier_id_unique" UNIQUE("supplier_id")
);
--> statement-breakpoint
CREATE INDEX "idx_ai_suppliers_enabled" ON "ai_suppliers" USING btree ("enabled");
--> statement-breakpoint
INSERT INTO "ai_suppliers" ("supplier_id", "name", "icon_url", "metadata", "enabled", "updated_at", "created_at")
SELECT
	"provider_id",
	"name",
	"icon_url",
	'{}',
	true,
	COALESCE("updated_at", now()),
	COALESCE("created_at", now())
FROM "ai_providers"
ON CONFLICT ("supplier_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "ai_providers" RENAME TO "ai_endpoints";
--> statement-breakpoint
ALTER TABLE "ai_endpoints" RENAME COLUMN "provider_id" TO "endpoint_id";
--> statement-breakpoint
ALTER TABLE "ai_endpoints" ADD COLUMN "supplier_id" integer;
--> statement-breakpoint
UPDATE "ai_endpoints" e
SET "supplier_id" = s."id"
FROM "ai_suppliers" s
WHERE s."supplier_id" = e."endpoint_id";
--> statement-breakpoint
ALTER TABLE "ai_endpoints" ALTER COLUMN "supplier_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_endpoints" ADD CONSTRAINT "ai_endpoints_supplier_id_ai_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."ai_suppliers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_endpoints" DROP CONSTRAINT IF EXISTS "ai_providers_provider_id_unique";
--> statement-breakpoint
ALTER TABLE "ai_endpoints" ADD CONSTRAINT "ai_endpoints_endpoint_id_unique" UNIQUE("endpoint_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_providers_provider_id";
--> statement-breakpoint
CREATE INDEX "idx_ai_endpoints_endpoint_id" ON "ai_endpoints" USING btree ("endpoint_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_endpoints_supplier_id" ON "ai_endpoints" USING btree ("supplier_id");
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" RENAME COLUMN "provider_id" TO "endpoint_id";
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" DROP CONSTRAINT IF EXISTS "ai_upstream_assignments_provider_id_ai_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" ADD CONSTRAINT "ai_upstream_assignments_endpoint_id_ai_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."ai_endpoints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" DROP CONSTRAINT IF EXISTS "ai_upstream_assignments_provider_id_upstream_id_unique";
--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" ADD CONSTRAINT "ai_upstream_assignments_endpoint_id_upstream_id_unique" UNIQUE("endpoint_id","upstream_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_upstream_assignments_provider_id";
--> statement-breakpoint
CREATE INDEX "idx_ai_upstream_assignments_endpoint_id" ON "ai_upstream_assignments" USING btree ("endpoint_id");
--> statement-breakpoint
ALTER TABLE "ai_model_routes" RENAME COLUMN "provider_id" TO "endpoint_id";
--> statement-breakpoint
ALTER TABLE "ai_model_routes" RENAME COLUMN "provider_model_id" TO "endpoint_model_id";
--> statement-breakpoint
ALTER TABLE "ai_model_routes" DROP CONSTRAINT IF EXISTS "ai_model_routes_provider_id_ai_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_model_routes" ADD CONSTRAINT "ai_model_routes_endpoint_id_ai_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."ai_endpoints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_model_routes" DROP CONSTRAINT IF EXISTS "ai_model_routes_model_id_provider_id_unique";
--> statement-breakpoint
ALTER TABLE "ai_model_routes" ADD CONSTRAINT "ai_model_routes_model_id_endpoint_id_unique" UNIQUE("model_id","endpoint_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_model_routes_provider_id";
--> statement-breakpoint
CREATE INDEX "idx_ai_model_routes_endpoint_id" ON "ai_model_routes" USING btree ("endpoint_id");
--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_provider_id_ai_providers_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_models_provider_id";
--> statement-breakpoint
ALTER TABLE "ai_models" DROP COLUMN IF EXISTS "provider_id";
--> statement-breakpoint
CREATE TABLE "ai_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"owner_id" integer,
	"name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_credentials_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_supplier_id_ai_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."ai_suppliers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_credentials" ADD CONSTRAINT "ai_credentials_owner_id_key_providers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."key_providers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_ai_credentials_supplier_id" ON "ai_credentials" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_credentials_owner_id" ON "ai_credentials" USING btree ("owner_id");
--> statement-breakpoint
INSERT INTO "ai_credentials" ("supplier_id", "owner_id", "name", "encrypted_key", "key_hash", "key_prefix", "enabled", "last_used_at", "updated_at", "created_at")
SELECT DISTINCT ON (k."key_hash")
	e."supplier_id",
	k."owner_id",
	k."name",
	k."encrypted_key",
	k."key_hash",
	k."key_prefix",
	k."enabled",
	k."last_used_at",
	COALESCE(k."updated_at", now()),
	COALESCE(k."created_at", now())
FROM "ai_keys" k
JOIN "ai_endpoints" e ON e."id" = k."provider_id"
ORDER BY k."key_hash", k."id";
--> statement-breakpoint
CREATE TABLE "ai_endpoint_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"upstream_id" integer,
	"credential_id" integer NOT NULL,
	"name" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_endpoint_credentials" ADD CONSTRAINT "ai_endpoint_credentials_endpoint_id_ai_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."ai_endpoints"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_endpoint_credentials" ADD CONSTRAINT "ai_endpoint_credentials_upstream_id_ai_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."ai_upstreams"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_endpoint_credentials" ADD CONSTRAINT "ai_endpoint_credentials_credential_id_ai_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ai_credentials"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_endpoint_credentials_official" ON "ai_endpoint_credentials" USING btree ("endpoint_id","credential_id") WHERE "upstream_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_endpoint_credentials_upstream" ON "ai_endpoint_credentials" USING btree ("endpoint_id","credential_id","upstream_id") WHERE "upstream_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_ai_endpoint_credentials_endpoint_id" ON "ai_endpoint_credentials" USING btree ("endpoint_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_endpoint_credentials_upstream_id" ON "ai_endpoint_credentials" USING btree ("upstream_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_endpoint_credentials_credential_id" ON "ai_endpoint_credentials" USING btree ("credential_id");
--> statement-breakpoint
INSERT INTO "ai_endpoint_credentials" ("endpoint_id", "upstream_id", "credential_id", "name", "weight", "enabled", "last_used_at", "updated_at", "created_at")
SELECT DISTINCT ON (k."provider_id", c."id", k."upstream_id")
	k."provider_id",
	k."upstream_id",
	c."id",
	k."name",
	k."weight",
	k."enabled",
	k."last_used_at",
	COALESCE(k."updated_at", now()),
	COALESCE(k."created_at", now())
FROM "ai_keys" k
JOIN "ai_credentials" c ON c."key_hash" = k."key_hash"
ORDER BY k."provider_id", c."id", k."upstream_id", k."id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" RENAME COLUMN "key_id" TO "endpoint_credential_id";
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" RENAME COLUMN "key_owner_id" TO "credential_owner_id";
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" RENAME COLUMN "provider_id" TO "endpoint_id";
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "credential_id" integer;
--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD COLUMN "supplier_id" text;
--> statement-breakpoint
UPDATE "ai_usage_logs" l
SET
	"credential_id" = ec."credential_id",
	"supplier_id" = s."supplier_id"
FROM "ai_endpoint_credentials" ec
JOIN "ai_endpoints" e ON e."id" = ec."endpoint_id"
JOIN "ai_suppliers" s ON s."id" = e."supplier_id"
WHERE l."endpoint_credential_id" = ec."id";
--> statement-breakpoint
UPDATE "ai_usage_logs" l
SET "supplier_id" = s."supplier_id"
FROM "ai_endpoints" e
JOIN "ai_suppliers" s ON s."id" = e."supplier_id"
WHERE l."supplier_id" IS NULL AND l."endpoint_id" = e."endpoint_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_usage_logs_provider_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_usage_logs_key_id";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_ai_usage_logs_key_owner_id";
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_supplier_id" ON "ai_usage_logs" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_endpoint_id" ON "ai_usage_logs" USING btree ("endpoint_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_endpoint_credential_id" ON "ai_usage_logs" USING btree ("endpoint_credential_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_credential_id" ON "ai_usage_logs" USING btree ("credential_id");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_credential_owner_id" ON "ai_usage_logs" USING btree ("credential_owner_id");
--> statement-breakpoint
ALTER TABLE "key_provider_transactions" RENAME COLUMN "key_id" TO "credential_id";
--> statement-breakpoint
UPDATE "key_provider_transactions" t
SET "credential_id" = c."id"
FROM "ai_keys" k
JOIN "ai_credentials" c ON c."key_hash" = k."key_hash"
WHERE t."credential_id" = k."id";
--> statement-breakpoint
ALTER TABLE "ai_keys" DROP CONSTRAINT IF EXISTS "ai_keys_provider_id_ai_providers_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_keys" DROP CONSTRAINT IF EXISTS "ai_keys_upstream_id_ai_upstreams_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_keys" DROP CONSTRAINT IF EXISTS "ai_keys_owner_id_key_providers_id_fk";
--> statement-breakpoint
DROP TABLE "ai_keys";
