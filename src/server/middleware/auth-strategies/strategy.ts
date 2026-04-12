/**
 * Auth middleware strategy interface.
 *
 * Each strategy handles a specific credential format (JWT, API Key, etc.)
 * and returns a unified AuthResult on success.
 */

export interface AuthResult {
  adminId: number;
  address?: string;
  source: "jwt" | "api_key";
  keyId?: number;
}

export interface AuthMiddlewareStrategy {
  /**
   * Fast check — can this strategy handle the given token?
   * Used for prefix-based dispatch without performing actual verification.
   */
  canHandle(token: string): boolean;

  /**
   * Verify the token and return an AuthResult, or null if verification fails.
   * Only called when canHandle returns true.
   */
  authenticate(token: string): Promise<AuthResult | null>;
}
