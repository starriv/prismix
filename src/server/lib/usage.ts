/**
 * Shared helpers for AI usage day-range parsing + clamping.
 *
 * Used by route handlers (admin + user portals) and the usage log repo so
 * that query-string parsing, day-count clamping, and the empty-string edge
 * case are handled consistently across all usage endpoints.
 */

/** Clamp a day count to the allowed [1, 90] range with a fallback. */
export function normalizeDayCount(days: number, fallback = 30): number {
  const truncated = Math.trunc(days);
  if (!Number.isFinite(truncated)) return fallback;
  return Math.min(Math.max(truncated, 1), 90);
}

/** Parse a raw query string into a clamped day count. */
export function parseUsageDays(raw: string | null | undefined, fallback = 30): number {
  if (raw === null || raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? normalizeDayCount(parsed, fallback) : fallback;
}
