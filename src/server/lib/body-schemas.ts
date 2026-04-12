/**
 * Server-side Zod body schemas for route input validation.
 *
 * Barrel — re-exports from domain-specific files so existing imports
 * (`from "@/server/lib/body-schemas"`) continue working unchanged.
 */
export * from "./body-schemas/ai";
export * from "./body-schemas/admin";
export * from "./body-schemas/user";
export * from "./body-schemas/payment";
