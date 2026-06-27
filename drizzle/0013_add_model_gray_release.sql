CREATE TABLE "ai_model_gray_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "ai_model_gray_users_model_id_user_id_unique" UNIQUE("model_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD COLUMN "gray_release_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model_gray_users" ADD CONSTRAINT "ai_model_gray_users_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_gray_users" ADD CONSTRAINT "ai_model_gray_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_model_gray_users_model_id" ON "ai_model_gray_users" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "idx_ai_model_gray_users_user_id" ON "ai_model_gray_users" USING btree ("user_id");