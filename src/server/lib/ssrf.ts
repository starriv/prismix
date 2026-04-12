/**
 * DNS-level SSRF protection.
 *
 * Resolves the hostname of an upstream URL and checks if the resolved IP
 * falls into a private/reserved range. Prevents DNS rebinding attacks
 * where a public hostname resolves to a private IP (127.0.0.1, 10.x, etc.).
 *
 * This is a second layer of defense — the first layer is the hostname-level
 * regex check in `src/shared/url.ts` (isPrivateHost).
 */
import dns from "dns/promises";

import { isPrivateHost } from "@/shared/url";

/**
 * Check if an IP address belongs to a private/reserved range.
 * Covers IPv4 private ranges, IPv6 loopback, and IPv6-mapped IPv4.
 */
function isPrivateIp(ip: string): boolean {
  // Strip IPv6 bracket notation ([::1] → ::1) before any further checks
  const stripped = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  // Strip IPv6-mapped IPv4 prefix (::ffff:x.x.x.x → x.x.x.x)
  const normalized = stripped.replace(/^::ffff:/i, "");

  // Use the existing hostname regex which already checks IPv4 private ranges
  if (isPrivateHost(normalized)) return true;

  // Handle IPv6-mapped IPv4 in hex form (e.g. ::ffff:7f00:1 → 7f00:1 → 127.0.0.1)
  // Node.js normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 in URL.hostname
  const hexMapped = normalized.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const dotted = `${a}.${b}.${c}.${lo & 0xff}`;
    if (isPrivateHost(dotted)) return true;
  }

  // Additional checks not covered by the hostname regex:
  // - 0.0.0.0 (unspecified)
  // - ::1 (IPv6 loopback)
  // - fe80:: (link-local)
  // - fc00::/7 (unique local address)
  const lower = stripped.toLowerCase();
  if (
    lower === "0.0.0.0" ||
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  ) {
    return true;
  }

  return false;
}

/**
 * Resolve a URL's hostname via DNS and verify the resolved IP is not private.
 * Returns null if safe, or an error message string.
 *
 * This should be called before fetching upstream URLs.
 * The DNS resolution result is NOT cached to prevent time-of-check/time-of-use
 * issues with DNS rebinding (where a hostname alternates between public and private IPs).
 */
export async function checkDnsRebinding(url: string): Promise<string | null> {
  try {
    const hostname = new URL(url).hostname;

    // IPv4 dotted-quad literals — already checked by isPrivateHost in the hostname layer
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return null;
    }

    // IPv6 literals (contain ":") — check directly with isPrivateIp instead of skipping
    if (hostname.includes(":")) {
      return isPrivateIp(hostname) ? `IPv6 address resolves to private range (${hostname})` : null;
    }

    const { address } = await dns.lookup(hostname);

    if (isPrivateIp(address)) {
      return `DNS resolved to private IP (${address})`;
    }

    return null;
  } catch {
    // DNS resolution failed — the fetch will fail too, let it fail naturally
    return null;
  }
}
