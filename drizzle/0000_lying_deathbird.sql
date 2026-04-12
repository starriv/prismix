CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "admins_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "ai_guardrail_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rules" text DEFAULT '[]' NOT NULL,
	"action" text DEFAULT 'block' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"owner_id" integer,
	"name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"model_id" text NOT NULL,
	"name" text NOT NULL,
	"context_window" integer,
	"input_price" text DEFAULT '0' NOT NULL,
	"output_price" text DEFAULT '0' NOT NULL,
	"capabilities" text DEFAULT '[]' NOT NULL,
	"fallback_model_ids" text,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_models_provider_id_model_id_unique" UNIQUE("provider_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_format" text NOT NULL,
	"auth_type" text NOT NULL,
	"auth_config" text DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"load_balance_strategy" text DEFAULT 'round-robin' NOT NULL,
	"icon_url" text,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_providers_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_id" integer,
	"consumer_key_id" integer,
	"user_id" integer,
	"provider_id" text,
	"model_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost" text,
	"upstream_cost" text,
	"markup_percent" real,
	"latency_ms" integer,
	"status_code" integer,
	"request_id" text,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"network" text NOT NULL,
	"contract_address" text DEFAULT '' NOT NULL,
	"decimals" integer DEFAULT 6 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "allowed_tokens_symbol_network_unique" UNIQUE("symbol","network")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"sent_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"scopes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "api_keys_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "api_keys_secret_hash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "fiat_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"display_name" text NOT NULL,
	"config" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "global_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_role" text DEFAULT 'user' NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"password_hash" text,
	"profile_data" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "identities_provider_provider_account_id_user_role_unique" UNIQUE("provider","provider_account_id","user_role")
);
--> statement-breakpoint
CREATE TABLE "key_provider_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"key_id" integer,
	"type" text NOT NULL,
	"amount" text NOT NULL,
	"balance_before" text NOT NULL,
	"balance_after" text NOT NULL,
	"description" text,
	"request_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"contact_info" text,
	"address" text,
	"revenue_share_percent" real DEFAULT 70 NOT NULL,
	"balance" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"target" text NOT NULL,
	"secret" text,
	"events" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"config_id" integer,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"target" text NOT NULL,
	"payload" text NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_agent_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" integer,
	"type" text NOT NULL,
	"amount" text NOT NULL,
	"balance_before" text NOT NULL,
	"balance_after" text NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"description" text,
	"tx_hash" text,
	"network" text,
	"source" text DEFAULT 'platform' NOT NULL,
	"consumer_key_id" integer,
	"model_id" text,
	"tokens" integer,
	"request_id" text,
	"upstream_cost" text,
	"markup_percent" real,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pay_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"address" text,
	"private_key" text,
	"type" text DEFAULT 'standard' NOT NULL,
	"balance" text DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"per_pay_limit" text,
	"daily_limit" text,
	"monthly_limit" text,
	"default_markup_percent" real,
	"last_sync_block" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "relay_consumer_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"encrypted_key" text DEFAULT '' NOT NULL,
	"markup_percent" real,
	"rate_limit_rpm" integer,
	"allowed_models" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "relay_consumer_keys_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "supported_networks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"network_id" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"explorer_url" text NOT NULL,
	"testnet" boolean DEFAULT false NOT NULL,
	"icon_url" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rpc_url" text DEFAULT '' NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "supported_networks_chain_id_unique" UNIQUE("chain_id"),
	CONSTRAINT "supported_networks_network_id_unique" UNIQUE("network_id")
);
--> statement-breakpoint
CREATE TABLE "top_up_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"amount" text NOT NULL,
	"fiat_amount" text,
	"fiat_currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"payment_proof" text,
	"admin_note" text,
	"network" text,
	"to_address" text,
	"tx_hash" text,
	"confirmed_at" timestamp,
	"expired_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"avatar" text,
	"address" text,
	"agent_id" integer,
	"status" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"response_status" integer,
	"response_body" text,
	"latency_ms" integer,
	"last_error" text,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"secret" text NOT NULL,
	"events" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdraw_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" integer,
	"to_address" text NOT NULL,
	"amount" text NOT NULL,
	"network" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"fee" text,
	"fail_reason" text,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_owner_id_key_providers_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."key_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_consumer_keys" ADD CONSTRAINT "relay_consumer_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_consumer_keys" ADD CONSTRAINT "relay_consumer_keys_agent_id_pay_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."pay_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "top_up_orders" ADD CONSTRAINT "top_up_orders_agent_id_pay_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."pay_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_pay_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."pay_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdraw_orders" ADD CONSTRAINT "withdraw_orders_agent_id_pay_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."pay_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_keys_provider_id" ON "ai_keys" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_ai_models_provider_id" ON "ai_models" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_ai_providers_provider_id" ON "ai_providers" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_created_at" ON "ai_usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_provider_id" ON "ai_usage_logs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_consumer_key" ON "ai_usage_logs" USING btree ("consumer_key_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_user_id" ON "ai_usage_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_key_id" ON "ai_usage_logs" USING btree ("key_id");--> statement-breakpoint
CREATE INDEX "idx_announcements_status" ON "announcements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_announcements_created_at" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_api_keys_secret_hash" ON "api_keys" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "idx_identities_user" ON "identities" USING btree ("user_id","user_role");--> statement-breakpoint
CREATE INDEX "idx_identities_provider" ON "identities" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "idx_key_provider_txns_provider_id" ON "key_provider_transactions" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_key_provider_txns_created_at" ON "key_provider_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_notification_logs_status" ON "notification_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_notification_logs_created_at" ON "notification_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notification_logs_dedupe_key" ON "notification_logs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_pay_agent_transactions_agent_id" ON "pay_agent_transactions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_pay_agent_transactions_created_at" ON "pay_agent_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pay_agent_transactions_tx_hash" ON "pay_agent_transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_pay_agent_txns_consumer_key" ON "pay_agent_transactions" USING btree ("consumer_key_id");--> statement-breakpoint
CREATE INDEX "idx_pay_agent_txns_request_id" ON "pay_agent_transactions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_pay_agent_txns_user_id" ON "pay_agent_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user_role" ON "refresh_tokens" USING btree ("user_id","role");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_relay_consumer_keys_user_id" ON "relay_consumer_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_relay_consumer_keys_agent_id" ON "relay_consumer_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_top_up_orders_agent_id" ON "top_up_orders" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_top_up_orders_status" ON "top_up_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_endpoint_id" ON "webhook_deliveries" USING btree ("endpoint_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_status" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_deliveries_event_id" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_endpoints_status" ON "webhook_endpoints" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_withdraw_orders_agent_id" ON "withdraw_orders" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_withdraw_orders_user_id" ON "withdraw_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_withdraw_orders_status" ON "withdraw_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_withdraw_orders_created_at" ON "withdraw_orders" USING btree ("created_at");