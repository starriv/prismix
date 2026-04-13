ALTER TABLE "users" ADD COLUMN "uuid" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_uuid_unique" ON "users" USING btree ("uuid");
