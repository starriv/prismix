/**
 * Resolve the gateway origin for displaying full URLs to users.
 *
 * Priority: DOMAIN env var (injected at build time) → localhost:{API_PORT}.
 * In production Docker deployments DOMAIN is always set (Caddy HTTPS),
 * so users see the real gateway URL. In local dev it falls back to the
 * actual API server port (not the Vite dev server port).
 */
export function getGatewayOrigin(): string {
  if (__GATEWAY_ORIGIN__) return __GATEWAY_ORIGIN__;
  // Dev mode: use API server port (e.g. 3403), not Vite port (e.g. 5189)
  const port = typeof __API_PORT__ !== "undefined" ? __API_PORT__ : "";
  return port ? `http://localhost:${port}` : window.location.origin;
}
