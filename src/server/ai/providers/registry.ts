/**
 * Provider Adapter registry — register and look up adapters by API format.
 */
import type { ProviderAdapter } from "./types";

const adapters = new Map<string, ProviderAdapter>();

/** Register a provider adapter. Replaces any existing adapter for the same format. */
export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.format, adapter);
}

/** Look up an adapter by the provider's `api_format` field. */
export function getAdapter(apiFormat: string): ProviderAdapter | undefined {
  return adapters.get(apiFormat);
}

/** Get all registered format names. */
export function getRegisteredFormats(): string[] {
  return [...adapters.keys()];
}
