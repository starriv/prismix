CREATE TABLE "relay_consumer_key_blacklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"relay_consumer_key_id" integer,
	"user_id" integer,
	"agent_id" integer NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"deleted_at" timestamp NOT NULL,
	CONSTRAINT "relay_consumer_key_blacklist_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE INDEX "idx_relay_consumer_key_blacklist_user_id" ON "relay_consumer_key_blacklist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_relay_consumer_key_blacklist_agent_id" ON "relay_consumer_key_blacklist" USING btree ("agent_id");