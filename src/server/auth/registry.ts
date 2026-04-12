import type { AuthProviderType, AuthStrategy } from "./strategy";

const strategies = new Map<AuthProviderType, AuthStrategy>();

export function registerStrategy(strategy: AuthStrategy): void {
  strategies.set(strategy.name, strategy);
}

export function getStrategy(name: AuthProviderType): AuthStrategy {
  const s = strategies.get(name);
  if (!s) throw new Error(`Auth strategy "${name}" not registered`);
  return s;
}

export function listStrategies(): AuthProviderType[] {
  return [...strategies.keys()];
}
