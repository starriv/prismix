const READABLE_ID_MAX_LENGTH = 50;
const READABLE_ID_SUFFIX_LENGTH = 5;
const READABLE_ID_SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function slugifyReadableIdPart(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function randomReadableIdSuffix(length = READABLE_ID_SUFFIX_LENGTH): string {
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(
      bytes,
      (byte) => READABLE_ID_SUFFIX_ALPHABET[byte % READABLE_ID_SUFFIX_ALPHABET.length],
    ).join("");
  }

  return Array.from(
    { length },
    () =>
      READABLE_ID_SUFFIX_ALPHABET[Math.floor(Math.random() * READABLE_ID_SUFFIX_ALPHABET.length)],
  ).join("");
}

export function buildReadableId({
  parts,
  suffix,
  existingIds,
  fallback = "item",
  maxLength = READABLE_ID_MAX_LENGTH,
}: {
  parts: Array<string | null | undefined>;
  suffix: string;
  existingIds?: Set<string>;
  fallback?: string;
  maxLength?: number;
}): string {
  const fallbackSlug = slugifyReadableIdPart(fallback) || "item";
  const normalizedParts = parts.map(slugifyReadableIdPart).filter(Boolean);
  const normalized = normalizedParts.join("-") || fallbackSlug;
  const normalizedSuffix =
    slugifyReadableIdPart(suffix).replace(/-/g, "") || randomReadableIdSuffix();
  const trimBase = (value: string, suffixLength: number) =>
    value.slice(0, maxLength - suffixLength - 1).replace(/-+$/g, "") || fallbackSlug;
  const first = `${trimBase(normalized, normalizedSuffix.length)}-${normalizedSuffix}`;
  if (!existingIds?.has(first)) return first;

  for (let index = 2; index <= 9999; index += 1) {
    const collisionSuffix = `${normalizedSuffix}-${index}`;
    const candidate = `${trimBase(normalized, collisionSuffix.length)}-${collisionSuffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  return `${trimBase(normalized, normalizedSuffix.length)}-${normalizedSuffix}-${Date.now().toString(36)}`;
}
