ALTER TABLE "top_up_orders"
ADD COLUMN "type" text DEFAULT 'crypto' NOT NULL;

ALTER TABLE "top_up_orders"
ADD COLUMN "fiat_config_id" integer;

ALTER TABLE "withdraw_orders"
ADD COLUMN "type" text DEFAULT 'crypto' NOT NULL;

ALTER TABLE "withdraw_orders"
ADD COLUMN "fiat_config_id" integer;

ALTER TABLE "withdraw_orders"
ADD COLUMN "payment_method" text;

ALTER TABLE "withdraw_orders"
ADD COLUMN "user_note" text;

ALTER TABLE "withdraw_orders"
ADD COLUMN "admin_note" text;

ALTER TABLE "withdraw_orders"
ALTER COLUMN "to_address" DROP NOT NULL;

ALTER TABLE "withdraw_orders"
ALTER COLUMN "network" DROP NOT NULL;
