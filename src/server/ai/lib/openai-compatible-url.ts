const VERSION_PATH_SEGMENT = /^v\d+(?:[a-z]+)?$/i;

function parseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

export function hasOpenAiCompatiblePathPrefix(baseUrl: string): boolean {
  const parsed = parseUrl(baseUrl);
  if (!parsed) return false;

  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments.some((segment) => VERSION_PATH_SEGMENT.test(segment));
}

export function buildOpenAiCompatibleUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  const parsed = parseUrl(base);

  if (parsed?.hostname.toLowerCase() === "api.deepseek.com" && normalizedPath === "models") {
    return `${base}/${normalizedPath}`;
  }

  if (hasOpenAiCompatiblePathPrefix(base)) {
    return `${base}/${normalizedPath}`;
  }

  return `${base}/v1/${normalizedPath}`;
}
