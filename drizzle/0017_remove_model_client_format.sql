WITH canonical_models AS (
  SELECT "model_id", MIN("id") AS keep_id
  FROM "ai_models"
  GROUP BY "model_id"
),
-- Routes to endpoints already served by the canonical row are NOT moved;
-- their per-route attributes (priority/weight/endpointModelId/enabled) are
-- discarded in favor of the canonical row's values. Distinct endpoints are preserved.
movable_routes AS (
  SELECT r."id" AS route_id, c.keep_id
  FROM "ai_model_routes" r
  INNER JOIN "ai_models" m ON m."id" = r."model_id"
  INNER JOIN canonical_models c ON c."model_id" = m."model_id"
  WHERE r."model_id" <> c.keep_id
    AND NOT EXISTS (
      SELECT 1
      FROM "ai_model_routes" existing
      WHERE existing."model_id" = c.keep_id
        AND existing."endpoint_id" = r."endpoint_id"
    )
)
UPDATE "ai_model_routes" r
SET "model_id" = movable_routes.keep_id
FROM movable_routes
WHERE r."id" = movable_routes.route_id;--> statement-breakpoint
WITH canonical_models AS (
  SELECT "model_id", MIN("id") AS keep_id
  FROM "ai_models"
  GROUP BY "model_id"
),
movable_gray_users AS (
  SELECT gu."id" AS gray_user_id, c.keep_id
  FROM "ai_model_gray_users" gu
  INNER JOIN "ai_models" m ON m."id" = gu."model_id"
  INNER JOIN canonical_models c ON c."model_id" = m."model_id"
  WHERE gu."model_id" <> c.keep_id
    AND NOT EXISTS (
      SELECT 1
      FROM "ai_model_gray_users" existing
      WHERE existing."model_id" = c.keep_id
        AND existing."user_id" = gu."user_id"
    )
)
UPDATE "ai_model_gray_users" gu
SET "model_id" = movable_gray_users.keep_id
FROM movable_gray_users
WHERE gu."id" = movable_gray_users.gray_user_id;--> statement-breakpoint
WITH canonical_models AS (
  SELECT "model_id", MIN("id") AS keep_id
  FROM "ai_models"
  GROUP BY "model_id"
)
DELETE FROM "ai_models" m
USING canonical_models c
WHERE m."model_id" = c."model_id"
  AND m."id" <> c.keep_id;--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT "ai_models_client_format_model_id_unique";--> statement-breakpoint
DROP INDEX "idx_ai_models_client_format";--> statement-breakpoint
ALTER TABLE "ai_models" DROP COLUMN "client_format";--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_model_id_unique" UNIQUE("model_id");
