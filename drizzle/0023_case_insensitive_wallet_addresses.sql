CREATE UNIQUE INDEX "admins_address_ci_unique" ON "admins" USING btree (lower("address"));--> statement-breakpoint
CREATE UNIQUE INDEX "identities_siwe_account_role_ci_unique" ON "identities" USING btree (lower("provider_account_id"),"user_role") WHERE "identities"."provider" = 'siwe';--> statement-breakpoint
CREATE UNIQUE INDEX "users_address_ci_unique" ON "users" USING btree (lower("address"));