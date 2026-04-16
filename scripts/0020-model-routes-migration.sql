-- ============================================================================
-- Migration: ai_model_routes — multi-provider model routing
--
-- Adds the ai_model_routes junction table, migrates existing
-- ai_models.provider_id relationships into route entries, and
-- canonicalises duplicate model slugs so model_id can become globally unique.
--
-- Notes:
--   - Wrapped in a single transaction (all-or-nothing)
--   - Existing provider relationships are preserved as ai_model_routes rows
--   - Duplicate ai_models rows for the same slug are merged onto one canonical row
--     (prefers enabled rows, then latest updated_at, then lowest id)
--   - ai_models.provider_id stays populated on the canonical row for backward compatibility
--   - If duplicate rows are merged, rollback requires restoring from backup
--
-- Usage:
--   psql $DATABASE_URL -f scripts/0020-model-routes-migration.sql
-- ============================================================================

BEGIN;

-- ── Step 1: Create ai_model_routes table ──────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_model_routes" (
  "id"                serial PRIMARY KEY NOT NULL,
  "model_id"          integer NOT NULL,
  "provider_id"       integer NOT NULL,
  "provider_model_id" text,
  "priority"          integer DEFAULT 100 NOT NULL,
  "weight"            integer DEFAULT 1 NOT NULL,
  "enabled"           boolean DEFAULT true NOT NULL,
  "updated_at"        timestamp NOT NULL DEFAULT now(),
  "created_at"        timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ai_model_routes_model_id_provider_id_unique"
    UNIQUE ("model_id", "provider_id"),
  CONSTRAINT "ai_model_routes_model_id_ai_models_id_fk"
    FOREIGN KEY ("model_id") REFERENCES "ai_models"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_model_routes_provider_id_ai_providers_id_fk"
    FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_ai_model_routes_model_id"
  ON "ai_model_routes" ("model_id");
CREATE INDEX IF NOT EXISTS "idx_ai_model_routes_provider_id"
  ON "ai_model_routes" ("provider_id");

-- ── Step 2: Migrate existing model→provider into route entries ────────
-- Each existing model gets one route to its current provider (priority 100).
-- ON CONFLICT DO NOTHING makes this safe to re-run.

INSERT INTO "ai_model_routes" ("model_id", "provider_id", "provider_model_id", "priority", "weight", "enabled", "updated_at", "created_at")
SELECT
  m."id",
  m."provider_id",
  m."model_id",       -- provider_model_id defaults to the model's own slug
  100,                 -- default priority
  COALESCE(m."weight", 1),
  m."enabled",
  now(),
  now()
FROM "ai_models" m
WHERE m."provider_id" IS NOT NULL
ON CONFLICT ("model_id", "provider_id") DO NOTHING;

-- ── Step 3: Merge duplicate model slugs onto a canonical ai_models row ─
-- This preserves all provider relationships via ai_model_routes before
-- model_id becomes globally unique on ai_models.

WITH ranked_models AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "model_id"
      ORDER BY "enabled" DESC, "updated_at" DESC, "id" ASC
    ) AS "canonical_id"
  FROM "ai_models"
)
UPDATE "ai_model_routes" r
SET "model_id" = ranked_models."canonical_id"
FROM ranked_models
WHERE r."model_id" = ranked_models."id"
  AND ranked_models."id" <> ranked_models."canonical_id";

WITH ranked_models AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER (
      PARTITION BY "model_id"
      ORDER BY "enabled" DESC, "updated_at" DESC, "id" ASC
    ) AS "canonical_id"
  FROM "ai_models"
)
DELETE FROM "ai_models" m
USING ranked_models
WHERE m."id" = ranked_models."id"
  AND ranked_models."id" <> ranked_models."canonical_id";

-- ── Step 4: Alter ai_models — make provider_id nullable ───────────────
-- We keep the column populated for backward compatibility; just drop the NOT NULL.

ALTER TABLE "ai_models" ALTER COLUMN "provider_id" DROP NOT NULL;

-- ── Step 5: Drop old compound unique, add new unique on model_id alone ─
-- The old unique was (provider_id, model_id) — now model_id is globally unique.

ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_provider_id_model_id_unique";
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_model_id_unique" UNIQUE ("model_id");

-- ── Step 6: Replace old FK CASCADE with SET NULL ──────────────────────
-- Old: provider_id → ai_providers(id) ON DELETE CASCADE
-- New: provider_id → ai_providers(id) ON DELETE SET NULL

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE tc.table_name = 'ai_models'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'provider_id'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "ai_models" DROP CONSTRAINT "' || fk_name || '"';
  END IF;
END $$;

ALTER TABLE "ai_models"
  ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk"
  FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id")
  ON DELETE SET NULL;

-- ── Step 7: Update index (drop old provider_id index, add model_id) ───

DROP INDEX IF EXISTS "idx_ai_models_provider_id";
CREATE INDEX IF NOT EXISTS "idx_ai_models_model_id" ON "ai_models" ("model_id");

-- ── Verification queries ──────────────────────────────────────────────

DO $$
DECLARE
  model_count   integer;
  route_count   integer;
  orphan_count  integer;
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO model_count FROM "ai_models";
  SELECT count(*) INTO route_count FROM "ai_model_routes";
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT "model_id"
    FROM "ai_models"
    GROUP BY "model_id"
    HAVING count(*) > 1
  ) dupes;
  SELECT count(*) INTO orphan_count
  FROM "ai_models" m
  WHERE m."provider_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "ai_model_routes" r
      WHERE r."model_id" = m."id" AND r."provider_id" = m."provider_id"
    );

  RAISE NOTICE '✓ Models: %, Routes created: %, Duplicate slugs remaining: %, Orphans (should be 0): %',
    model_count, route_count, duplicate_count, orphan_count;

  IF duplicate_count > 0 THEN
    RAISE WARNING '⚠ % duplicate model_id rows remain — UNIQUE(model_id) will fail', duplicate_count;
  END IF;
  IF orphan_count > 0 THEN
    RAISE WARNING '⚠ % models have no corresponding route — check manually', orphan_count;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (uncomment and run if you need to revert)
-- ============================================================================
--
-- NOTE:
-- Duplicate ai_models rows merged during Step 3 cannot be reconstructed automatically.
-- Restore from backup if you need a byte-for-byte rollback of duplicate rows.
--
-- BEGIN;
--
-- -- Restore NOT NULL on provider_id
-- UPDATE "ai_models" SET "provider_id" = (
--   SELECT r."provider_id" FROM "ai_model_routes" r
--   WHERE r."model_id" = "ai_models"."id"
--   ORDER BY r."priority" ASC LIMIT 1
-- ) WHERE "provider_id" IS NULL;
-- ALTER TABLE "ai_models" ALTER COLUMN "provider_id" SET NOT NULL;
--
-- -- Restore old unique constraint
-- ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_model_id_unique";
-- ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_model_id_unique"
--   UNIQUE ("provider_id", "model_id");
--
-- -- Restore old FK
-- ALTER TABLE "ai_models" DROP CONSTRAINT IF EXISTS "ai_models_provider_id_ai_providers_id_fk";
-- ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk"
--   FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE;
--
-- -- Restore old index
-- DROP INDEX IF EXISTS "idx_ai_models_model_id";
-- CREATE INDEX IF NOT EXISTS "idx_ai_models_provider_id" ON "ai_models" ("provider_id");
--
-- -- Drop routes table
-- DROP TABLE IF EXISTS "ai_model_routes";
--
-- COMMIT;
