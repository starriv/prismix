/**
 * URL validation utilities — shared by server and web.
 *
 * SSRF protection: block upstream URLs pointing to private/reserved networks.
 */

const PRIVATE_HOST_RE =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|fc|fd|::1|::ffff:|localhost)/i;

/** Returns true if the hostname resolves to a private/reserved IP range. */
export function isPrivateHost(hostname: string): boolean {
  if (PRIVATE_HOST_RE.test(hostname)) return true;

  // Block decimal IP notation (e.g. 2130706433 = 127.0.0.1)
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
      const a = (n >>> 24) & 0xff;
      // 127.x, 10.x, 172.16-31.x, 192.168.x, 0.x, 169.254.x
      if (
        a === 127 ||
        a === 10 ||
        a === 0 ||
        (a === 172 && ((n >>> 16) & 0xff) >= 16 && ((n >>> 16) & 0xff) <= 31) ||
        (a === 192 && ((n >>> 16) & 0xff) === 168) ||
        (a === 169 && ((n >>> 16) & 0xff) === 254)
      )
        return true;
    }
  }

  return false;
}

/**
 * Validate that a URL is safe to use as an upstream target.
 * Returns null if valid, or an error message string.
 */
export function validateUpstreamUrl(url: string): string | null {
  if (!url) return null; // empty is allowed (optional field)
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith("http")) {
      return "URL must use http or https";
    }
    if (isPrivateHost(parsed.hostname)) {
      return "URL must not point to private/internal addresses";
    }
    return null;
  } catch {
    return "Invalid URL format";
  }
}
