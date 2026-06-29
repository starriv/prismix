ALTER TABLE "ai_endpoints" RENAME TO "ai_supplier_connections";--> statement-breakpoint
ALTER TABLE "ai_supplier_connections" RENAME CONSTRAINT "ai_endpoints_supplier_id_ai_suppliers_id_fk" TO "ai_supplier_connections_supplier_id_ai_suppliers_id_fk";--> statement-breakpoint
ALTER TABLE "ai_supplier_connections" RENAME CONSTRAINT "ai_endpoints_endpoint_id_unique" TO "ai_supplier_connections_endpoint_id_unique";--> statement-breakpoint
ALTER INDEX "idx_ai_endpoints_endpoint_id" RENAME TO "idx_ai_supplier_connections_endpoint_id";--> statement-breakpoint
ALTER INDEX "idx_ai_endpoints_supplier_id" RENAME TO "idx_ai_supplier_connections_supplier_id";--> statement-breakpoint
ALTER TABLE "ai_upstream_assignments" RENAME CONSTRAINT "ai_upstream_assignments_endpoint_id_ai_endpoints_id_fk" TO "fk_ai_upstream_assignments_connection_id";--> statement-breakpoint
ALTER TABLE "ai_model_routes" RENAME CONSTRAINT "ai_model_routes_endpoint_id_ai_endpoints_id_fk" TO "fk_ai_model_routes_connection_id";--> statement-breakpoint
ALTER TABLE "ai_endpoint_credentials" RENAME CONSTRAINT "ai_endpoint_credentials_endpoint_id_ai_endpoints_id_fk" TO "fk_ai_endpoint_credentials_connection_id";--> statement-breakpoint
