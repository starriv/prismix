CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION uuid_v7_text()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  ts_ms bigint;
  ts_hex text;
  rand_hex text;
  variant text;
BEGIN
  ts_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  ts_hex := lpad(to_hex(ts_ms), 12, '0');
  rand_hex := encode(gen_random_bytes(9), 'hex');
  variant := substr('89ab', (get_byte(gen_random_bytes(1), 0) % 4) + 1, 1);

  RETURN lower(
    substr(ts_hex, 1, 8) || '-' ||
    substr(ts_hex, 9, 4) || '-' ||
    '7' || substr(rand_hex, 1, 3) || '-' ||
    variant || substr(rand_hex, 4, 3) || '-' ||
    substr(rand_hex, 7, 12)
  );
END;
$$;

BEGIN;

UPDATE users
SET uuid = uuid_v7_text()
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
