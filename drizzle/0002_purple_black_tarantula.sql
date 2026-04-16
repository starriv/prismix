CREATE TABLE "ai_model_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"provider_model_id" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_model_routes_model_id_provider_id_unique" UNIQUE("model_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT "ai_models_provider_id_model_id_unique";--> statement-breakpoint
ALTER TABLE "ai_models" DROP CONSTRAINT "ai_models_provider_id_ai_providers_id_fk";
--> statement-breakpoint
DROP INDEX "idx_ai_models_provider_id";--> statement-breakpoint
ALTER TABLE "ai_models" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_routes" ADD CONSTRAINT "ai_model_routes_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_routes" ADD CONSTRAINT "ai_model_routes_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_model_routes_model_id" ON "ai_model_routes" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "idx_ai_model_routes_provider_id" ON "ai_model_routes" USING btree ("provider_id");--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_models_model_id" ON "ai_models" USING btree ("model_id");--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_model_id_unique" UNIQUE("model_id");