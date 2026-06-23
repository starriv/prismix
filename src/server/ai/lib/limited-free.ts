/**
 * Limited-free model helpers.
 *
 * The timestamp is the source of truth for the frontend tag. Billing is still
 * controlled by the stored model prices. On expiry, the background job clears
 * the tag AND disables the model to prevent zero-price abuse.
 */
export function isLimitedFreeActive(
  limitedFreeUntil: Date | string | number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!limitedFreeUntil) return false;
  const expiresAt =
    limitedFreeUntil instanceof Date ? limitedFreeUntil : new Date(limitedFreeUntil);
  return Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

export function serializeLimitedFreeUntil(
  limitedFreeUntil: Date | string | number | null | undefined,
): string | null {
  if (!limitedFreeUntil) return null;
  const expiresAt =
    limitedFreeUntil instanceof Date ? limitedFreeUntil : new Date(limitedFreeUntil);
  return Number.isFinite(expiresAt.getTime()) ? expiresAt.toISOString() : null;
}
