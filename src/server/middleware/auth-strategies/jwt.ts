/**
 * JWT auth strategy — extracts admin identity from a signed JWT.
 *
 * Positively identifies JWTs by structure (three dot-separated segments)
 * rather than relying on negation of known prefixes.
 */
import { verifyAccessToken } from "../../lib/jwt";
import type { AuthMiddlewareStrategy, AuthResult } from "./strategy";

/** JWTs are three base64url-encoded segments separated by dots. */
const JWT_STRUCTURE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export class JwtAuthStrategy implements AuthMiddlewareStrategy {
  canHandle(token: string): boolean {
    return JWT_STRUCTURE_RE.test(token);
  }

  async authenticate(token: string): Promise<AuthResult | null> {
    const payload = await verifyAccessToken(token);
    if (!payload || payload.role !== "admin") return null;
    const adminId = Number(payload.sub);
    if (!Number.isFinite(adminId) || adminId <= 0) return null;
    return {
      adminId,
      address: payload.address,
      source: "jwt",
    };
  }
}
