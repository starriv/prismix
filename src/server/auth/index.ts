// ── Register ALL built-in strategies ──────────────────────────────────
// All strategies are always registered. The "enabled" check is done at
// the API layer via isProviderEnabled() / listEnabledProviders().
import { registerStrategy } from "./registry";
import { CredentialsStrategy } from "./strategies/credentials";
import { GithubAuthStrategy } from "./strategies/github";
import { GoogleAuthStrategy } from "./strategies/google";
import { OidcStrategy } from "./strategies/oidc";
import { SamlStrategy } from "./strategies/saml";
import { SiweStrategy } from "./strategies/siwe";

export { AuthError } from "./strategy";
export type { AuthIdentity, AuthProviderType, AuthStrategy, InitializeResult } from "./strategy";
export { getStrategy, listStrategies, registerStrategy } from "./registry";
export { resolveIdentity } from "./identity-resolver";

registerStrategy(new SiweStrategy());
registerStrategy(new CredentialsStrategy());
registerStrategy(new GoogleAuthStrategy());
registerStrategy(new GithubAuthStrategy());
registerStrategy(new OidcStrategy());
registerStrategy(new SamlStrategy());
