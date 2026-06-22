ALTER TABLE "ai_models" ADD COLUMN "client_format" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
WITH first_routes AS (
  SELECT
    r."model_id" AS model_pk,
    r."provider_id",
    ROW_NUMBER() OVER (
      PARTITION BY r."model_id"
      ORDER BY r."priority" ASC, r."weight" DESC, r."id" ASC
    ) AS rn
  FROM "ai_model_routes" r
)
UPDATE "ai_models"
SET "client_format" = CASE
  WHEN p."api_format" = 'anthropic' THEN 'anthropic'
  ELSE 'openai'
END
FROM first_routes fr
JOIN "ai_providers" p ON p."id" = fr."provider_id"
WHERE "ai_models"."id" = fr.model_pk AND fr.rn = 1;--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_model_id_unique";--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_client_format_model_id_unique" UNIQUE("client_format","model_id");--> statement-breakpoint
CREATE INDEX "idx_ai_models_client_format" ON "ai_models" USING btree ("client_format");
