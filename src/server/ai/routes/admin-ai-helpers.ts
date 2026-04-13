/**
 * Shared helpers for admin AI route handlers.
 */
import { safeParseJsonArray } from "../lib/safe-json";

export function parseJsonField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function formatProvider(p: { authConfig: string; [key: string]: unknown }) {
  return { ...p, authConfig: parseJsonField(p.authConfig) };
}

export function formatProviderUpstream(p: { metadata: string; [key: string]: unknown }) {
  return { ...p, metadata: parseJsonField(p.metadata) };
}

export function formatModel(m: {
  capabilities: string;
  fallbackModelIds: string | null;
  [key: string]: unknown;
}) {
  return {
    ...m,
    capabilities: safeParseJsonArray(m.capabilities, "capabilities"),
    fallbackModelIds: m.fallbackModelIds
      ? safeParseJsonArray(m.fallbackModelIds, "fallbackModelIds")
      : null,
  };
}
