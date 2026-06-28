/**
 * Shared helpers for admin AI route handlers.
 */
import { compact, uniq } from "lodash-es";

import type { AiCredential } from "@/server/db";
import {
  aiEndpointRepo,
  aiSupplierRepo,
  aiUpstreamRepo,
  type EndpointCredential,
  keyProviderRepo,
} from "@/server/repos";

import {
  type ConnectorRuntimeFields,
  parseAuthConfig,
  resolveConnectorRuntimeConfig,
  type SupplierRuntimeDefaults,
} from "../lib/connector-runtime-config";
import { isLimitedFreeActive, serializeLimitedFreeUntil } from "../lib/limited-free";
import { safeParseJsonArray } from "../lib/safe-json";

export function parseJsonField(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function formatSupplier(supplier: { authConfig?: string; [key: string]: unknown }) {
  return {
    ...supplier,
    authConfig: typeof supplier.authConfig === "string" ? parseAuthConfig(supplier.authConfig) : {},
  };
}

type FormattableEndpoint = ConnectorRuntimeFields & {
  supplier?: SupplierRuntimeDefaults | null;
};

function formatEffectiveRuntimeConfig(endpoint: FormattableEndpoint) {
  const runtime = resolveConnectorRuntimeConfig(endpoint);
  return {
    ...runtime,
    authConfig: parseAuthConfig(runtime.authConfig),
  };
}

export function formatEndpointWithSupplier<T extends FormattableEndpoint>(endpoint: T) {
  return {
    ...endpoint,
    authConfig: parseAuthConfig(endpoint.authConfig),
    effectiveRuntimeConfig: formatEffectiveRuntimeConfig(endpoint),
  };
}

export function formatUpstream(u: { metadata: string; [key: string]: unknown }) {
  return { ...u, metadata: parseJsonField(u.metadata) };
}

export async function formatCredentials(credentials: AiCredential[]) {
  const supplierIds = uniq(
    credentials
      .map((credential) => credential.supplierId)
      .filter((id): id is number => typeof id === "number"),
  );
  const suppliers = await aiSupplierRepo.findByIds(supplierIds);
  const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

  const ownerIds = compact(uniq(credentials.map((credential) => credential.ownerId))) as number[];
  const ownerEntries = await Promise.all(
    ownerIds.map(async (ownerId) => {
      const provider = await keyProviderRepo.findById(ownerId);
      return provider ? ([ownerId, provider.name] as const) : null;
    }),
  );
  const ownerMap = new Map(
    ownerEntries.filter((entry): entry is readonly [number, string] => entry !== null),
  );

  return credentials.map(({ encryptedKey, keyHash, ...rest }) => ({
    ...rest,
    supplierName:
      rest.supplierId != null ? (supplierMap.get(rest.supplierId) ?? "Unknown") : "Unknown",
    ownerName: rest.ownerId ? (ownerMap.get(rest.ownerId) ?? null) : null,
  }));
}

export async function formatEndpointCredentials(credentials: EndpointCredential[]) {
  const endpointIds = uniq(credentials.map((credential) => credential.endpointId));
  const endpoints = await aiEndpointRepo.findByIds(endpointIds);
  const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.name]));

  const upstreamIds = compact(
    uniq(credentials.map((credential) => credential.upstreamId)),
  ) as number[];
  const upstreams = await aiUpstreamRepo.findByIds(upstreamIds);
  const upstreamMap = new Map(
    upstreams.map((upstream) => [
      upstream.id,
      { name: upstream.name, upstreamId: upstream.upstreamId },
    ]),
  );

  const ownerIds = compact(uniq(credentials.map((credential) => credential.ownerId))) as number[];
  const ownerEntries = await Promise.all(
    ownerIds.map(async (ownerId) => {
      const provider = await keyProviderRepo.findById(ownerId);
      return provider ? ([ownerId, provider.name] as const) : null;
    }),
  );
  const ownerMap = new Map(
    ownerEntries.filter((entry): entry is readonly [number, string] => entry !== null),
  );

  return credentials.map(({ encryptedKey, keyHash, ...rest }) => ({
    ...rest,
    endpointName: endpointMap.get(rest.endpointId) ?? "Unknown",
    upstreamName: rest.upstreamId ? (upstreamMap.get(rest.upstreamId)?.name ?? null) : null,
    upstreamSlug: rest.upstreamId ? (upstreamMap.get(rest.upstreamId)?.upstreamId ?? null) : null,
    ownerName: rest.ownerId ? (ownerMap.get(rest.ownerId) ?? null) : null,
  }));
}

export function formatModel(m: {
  capabilities: string;
  fallbackModelIds: string | null;
  limitedFreeUntil?: Date | string | number | null;
  [key: string]: unknown;
}) {
  return {
    ...m,
    capabilities: safeParseJsonArray(m.capabilities, "capabilities"),
    fallbackModelIds: m.fallbackModelIds
      ? safeParseJsonArray(m.fallbackModelIds, "fallbackModelIds")
      : null,
    limitedFreeUntil: serializeLimitedFreeUntil(m.limitedFreeUntil),
    isLimitedFree: isLimitedFreeActive(m.limitedFreeUntil),
  };
}
