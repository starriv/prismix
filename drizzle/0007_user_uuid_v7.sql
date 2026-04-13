CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "uuid" SET DEFAULT uuid_v7_text();
