ALTER TABLE "ai_suppliers" ADD COLUMN "auth_type" text DEFAULT 'bearer' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_suppliers" ADD COLUMN "auth_config" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_suppliers" ADD COLUMN "official_concurrency_limit" integer;--> statement-breakpoint
ALTER TABLE "ai_suppliers" ADD COLUMN "official_queue_timeout_ms" integer DEFAULT 30000 NOT NULL;--> statement-breakpoint
UPDATE "ai_suppliers" s
SET
	"auth_type" = e."auth_type",
	"auth_config" = e."auth_config",
	"official_concurrency_limit" = e."official_concurrency_limit",
	"official_queue_timeout_ms" = e."official_queue_timeout_ms"
FROM (
	SELECT DISTINCT ON ("supplier_id")
		"supplier_id",
		"auth_type",
		"auth_config",
		"official_concurrency_limit",
		"official_queue_timeout_ms"
	FROM "ai_endpoints"
	ORDER BY "supplier_id", "id"
) e
WHERE s."id" = e."supplier_id";
--> statement-breakpoint
ALTER TABLE "ai_endpoints" ADD COLUMN "auth_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_endpoints" ADD COLUMN "concurrency_mode" text DEFAULT 'inherit' NOT NULL;--> statement-breakpoint
UPDATE "ai_endpoints" e
SET
	"auth_mode" = CASE
		WHEN e."auth_type" = s."auth_type" AND e."auth_config" = s."auth_config" THEN 'inherit'
		ELSE 'override'
	END,
	"concurrency_mode" = CASE
		WHEN e."official_concurrency_limit" IS NOT DISTINCT FROM s."official_concurrency_limit"
			AND e."official_queue_timeout_ms" = s."official_queue_timeout_ms" THEN 'inherit'
		ELSE 'override'
	END
FROM "ai_suppliers" s
WHERE e."supplier_id" = s."id";
