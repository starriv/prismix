/**
 * Extract client IP from a Hono request context.
 *
 * Trust chain (first match wins):
 * 1. `X-Real-IP` — set by trusted reverse proxy (Caddy / Nginx)
 * 2. `X-Forwarded-For` rightmost entry — closest trusted proxy appends here
 * 3. Socket remote address — direct connection fallback
 *
 * In production, the reverse proxy (Caddy) should strip/overwrite
 * client-supplied X-Forwarded-For and set X-Real-IP to the true client IP.
 */
import type { Context } from "hono";

export function getClientIp(c: Context): string {
  // Prefer X-Real-IP (single value, set by trusted proxy)
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  // X-Forwarded-For: take the rightmost (last) value — the one appended by
  // the nearest trusted proxy, not the leftmost which the client can forge.
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",");
    const rightmost = parts[parts.length - 1]?.trim();
    if (rightmost) return rightmost;
  }

  // Fallback: raw socket address (works for direct connections)
  const addr = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket
    ?.remoteAddress;
  return addr ?? "unknown";
}
