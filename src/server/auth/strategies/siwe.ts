import { verifySiweSignature } from "@/server/lib/auth-flows";
import { buildSiweMessage, createNonce } from "@/server/middleware/auth";

import type { AuthIdentity, AuthStrategy, InitializeResult } from "../strategy";
import { AuthError } from "../strategy";

export class SiweStrategy implements AuthStrategy {
  readonly name = "siwe" as const;

  async initialize(params: Record<string, unknown>): Promise<InitializeResult> {
    const address = params.address as string;
    const scope = (params.scope as string) || "user";
    const origin = params.origin as string | undefined;
    if (!address) throw new AuthError("address is required", "invalid_credentials", 400);

    const nonce = createNonce(address, scope as "user" | "admin");
    const message = buildSiweMessage(address, nonce, origin);
    return { data: { message, nonce } };
  }

  async authenticate(params: Record<string, unknown>): Promise<AuthIdentity> {
    const address = params.address as string;
    const signature = params.signature as string;
    const message = params.message as string;
    const scope = (params.scope as string) || "user";
    const origin = params.origin as string | undefined;

    if (!address || !signature || !message) {
      throw new AuthError(
        "address, signature, and message are required",
        "invalid_credentials",
        400,
      );
    }

    const result = await verifySiweSignature(
      address,
      signature,
      message,
      scope as "user" | "admin",
      origin,
    );

    if (!result.ok) {
      throw new AuthError(result.reason, "signature_invalid");
    }

    const addr = address.toLowerCase();
    return {
      provider: "siwe",
      providerAccountId: addr,
      profile: { name: `${addr.slice(0, 6)}...${addr.slice(-4)}` },
    };
  }
}
