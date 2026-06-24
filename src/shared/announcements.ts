/**
 * Announcement taxonomy — single source of truth shared by server + web.
 *
 * Pure values + derived types only (no zod / no platform deps) so this stays
 * safe to import from both `src/server` and `src/web`. Schema files derive
 * their `z.enum(...)` validators from these arrays.
 */

export const ANNOUNCEMENT_CATEGORIES = [
  "general",
  "model_retirement",
  "model_pause",
  "model_price_change",
  "outage",
] as const;

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"] as const;

export const ANNOUNCEMENT_SURFACES = ["web", "cli", "model_error"] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];
export type AnnouncementSurface = (typeof ANNOUNCEMENT_SURFACES)[number];

/** SQL LIKE pattern matching a surface token inside the JSON text column, e.g. `%"web"%`. */
export function surfaceLikePattern(surface: AnnouncementSurface): string {
  return `%"${surface}"%`;
}
