CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

UPDATE users
SET uuid = gen_random_uuid()::text
WHERE uuid IS NULL;

COMMIT;

SELECT COUNT(*) AS users_missing_uuid
FROM users
WHERE uuid IS NULL;

SELECT uuid, COUNT(*) AS duplicate_count
FROM users
WHERE uuid IS NOT NULL
GROUP BY uuid
HAVING COUNT(*) > 1;
