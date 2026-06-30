-- Companion to 0021_ai_usage_performance_probes.sql.
-- Run this OUTSIDE of a transaction (required by CONCURRENTLY).
-- Created separately from the drizzle-tracked migration to avoid an ACCESS EXCLUSIVE
-- lock on the high-throughput ai_usage_logs table during production deploys.
--
-- Drizzle does not support CREATE INDEX CONCURRENTLY inside its breakpoint format,
-- so this script is applied manually by operators after the drizzle migration runs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_ai_usage_logs_cache_status"
  ON "ai_usage_logs" USING btree ("cache_status");
