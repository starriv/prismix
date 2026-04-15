/**
 * Shared helpers for admin AI route handlers.
 */
import { compact, uniq } from "lodash-es";

import type { AiKey } from "@/server/db";
import { aiProviderRepo, aiUpstreamRepo, keyProviderRepo } from "@/server/repos";

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

export function formatUpstream(u: { metadata: string; [key: string]: unknown }) {
  return { ...u, metadata: parseJsonField(u.metadata) };
}

export async function formatKeys(keys: AiKey[]) {
  const providerIds = uniq(keys.map((key) => key.providerId));
  const providers = await aiProviderRepo.findByIds(providerIds);
  const providerMap = new Map(providers.map((provider) => [provider.id, provider.name]));

  const ownerIds = compact(uniq(keys.map((key) => key.ownerId))) as number[];
  const ownerEntries = await Promise.all(
    ownerIds.map(async (ownerId) => {
      const provider = await keyProviderRepo.findById(ownerId);
      return provider ? ([ownerId, provider.name] as const) : null;
    }),
  );
  const ownerMap = new Map(
    ownerEntries.filter((entry): entry is readonly [number, string] => entry !== null),
  );

  const upstreamIds = compact(uniq(keys.map((key) => key.upstreamId))) as number[];
  const upstreams = await aiUpstreamRepo.findByIds(upstreamIds);
  const upstreamMap = new Map(
    upstreams.map((upstream) => [
      upstream.id,
      { name: upstream.name, upstreamId: upstream.upstreamId },
    ]),
  );

  return keys.map(({ encryptedKey, keyHash, ...rest }) => ({
    ...rest,
    providerName: providerMap.get(rest.providerId) ?? "Unknown",
    ownerName: rest.ownerId ? (ownerMap.get(rest.ownerId) ?? null) : null,
    upstreamName: rest.upstreamId ? (upstreamMap.get(rest.upstreamId)?.name ?? null) : null,
    upstreamSlug: rest.upstreamId ? (upstreamMap.get(rest.upstreamId)?.upstreamId ?? null) : null,
  }));
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
