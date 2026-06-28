DELETE FROM "ai_upstream_model_mappings"
WHERE "upstream_id" NOT IN (SELECT "id" FROM "ai_upstreams");--> statement-breakpoint
ALTER TABLE "ai_upstream_model_mappings" ADD CONSTRAINT "ai_upstream_model_mappings_upstream_id_ai_upstreams_id_fk" FOREIGN KEY ("upstream_id") REFERENCES "public"."ai_upstreams"("id") ON DELETE cascade ON UPDATE no action;
