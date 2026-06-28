/**
 * Protocol Adapter registry — register and look up adapters by API format.
 */
import type { ProtocolAdapter } from "./types";

const adapters = new Map<string, ProtocolAdapter>();

/** Register a protocol adapter. Replaces any existing adapter for the same format. */
export function registerAdapter(adapter: ProtocolAdapter): void {
  adapters.set(adapter.format, adapter);
}

/** Look up an adapter by the endpoint `api_format` field. */
export function getAdapter(apiFormat: string): ProtocolAdapter | undefined {
  return adapters.get(apiFormat);
}

/** Get all registered format names. */
export function getRegisteredFormats(): string[] {
  return [...adapters.keys()];
}
