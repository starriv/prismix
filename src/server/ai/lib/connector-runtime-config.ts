import type { AiSupplier, AiSupplierConnection } from "@/server/db";

export type ConnectorConfigMode = "inherit" | "override";

export interface SupplierRuntimeDefaults {
  authType: string;
  authConfig: string;
  officialConcurrencyLimit: number | null;
  officialQueueTimeoutMs: number;
}

export interface ConnectorRuntimeFields {
  authMode: string;
  authType: string;
  authConfig: string;
  concurrencyMode: string;
  officialConcurrencyLimit: number | null;
  officialQueueTimeoutMs: number;
}

export interface ConnectorRuntimeConfig {
  authMode: ConnectorConfigMode;
  authType: string;
  authConfig: string;
  concurrencyMode: ConnectorConfigMode;
  officialConcurrencyLimit: number | null;
  officialQueueTimeoutMs: number;
}

export type EndpointWithRuntimeSupplier = ConnectorRuntimeFields & {
  supplier?: SupplierRuntimeDefaults | null;
};

export interface ConnectorAuthFields {
  authMode?: string;
  authType: string;
  authConfig: string;
  supplier?: SupplierRuntimeDefaults | null;
}

export function normalizeConnectorConfigMode(value: unknown): ConnectorConfigMode {
  return value === "override" ? "override" : "inherit";
}

export function getEmbeddedSupplierRuntimeDefaults(
  endpoint: Partial<EndpointWithRuntimeSupplier>,
): SupplierRuntimeDefaults | null {
  const supplier = endpoint.supplier;
  if (!supplier) return null;

  return {
    authType: supplier.authType,
    authConfig: supplier.authConfig,
    officialConcurrencyLimit: supplier.officialConcurrencyLimit ?? null,
    officialQueueTimeoutMs: supplier.officialQueueTimeoutMs ?? 30_000,
  };
}

export function resolveConnectorRuntimeConfig(
  endpoint: ConnectorRuntimeFields,
  supplier: SupplierRuntimeDefaults | null = getEmbeddedSupplierRuntimeDefaults(endpoint),
): ConnectorRuntimeConfig {
  const authMode = normalizeConnectorConfigMode(endpoint.authMode);
  const concurrencyMode = normalizeConnectorConfigMode(endpoint.concurrencyMode);
  const authSource = authMode === "inherit" && supplier ? supplier : endpoint;
  const concurrencySource = concurrencyMode === "inherit" && supplier ? supplier : endpoint;

  return {
    authMode,
    authType: authSource.authType,
    authConfig: authSource.authConfig || "{}",
    concurrencyMode,
    officialConcurrencyLimit: concurrencySource.officialConcurrencyLimit ?? null,
    officialQueueTimeoutMs: concurrencySource.officialQueueTimeoutMs ?? 30_000,
  };
}

export function resolveConnectorAuthConfig(
  endpoint: ConnectorAuthFields,
  supplier: SupplierRuntimeDefaults | null = getEmbeddedSupplierRuntimeDefaults(endpoint),
): Pick<ConnectorRuntimeConfig, "authMode" | "authType" | "authConfig"> {
  const authMode =
    endpoint.authMode === undefined ? "override" : normalizeConnectorConfigMode(endpoint.authMode);
  const authSource = authMode === "inherit" && supplier ? supplier : endpoint;

  return {
    authMode,
    authType: authSource.authType,
    authConfig: authSource.authConfig || "{}",
  };
}

export function withConnectorRuntimeConfig<T extends ConnectorRuntimeFields>(
  endpoint: T,
  supplier: SupplierRuntimeDefaults | null = getEmbeddedSupplierRuntimeDefaults(endpoint),
): T {
  return {
    ...endpoint,
    ...resolveConnectorRuntimeConfig(endpoint, supplier),
  };
}

export function supplierRuntimeDefaults(
  supplier: Pick<
    AiSupplier,
    "authType" | "authConfig" | "officialConcurrencyLimit" | "officialQueueTimeoutMs"
  >,
): SupplierRuntimeDefaults {
  return {
    authType: supplier.authType,
    authConfig: supplier.authConfig,
    officialConcurrencyLimit: supplier.officialConcurrencyLimit ?? null,
    officialQueueTimeoutMs: supplier.officialQueueTimeoutMs ?? 30_000,
  };
}

export function parseAuthConfig(authConfig: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(authConfig) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export type RuntimeConfigEndpoint = Pick<
  AiSupplierConnection,
  | "authMode"
  | "authType"
  | "authConfig"
  | "concurrencyMode"
  | "officialConcurrencyLimit"
  | "officialQueueTimeoutMs"
>;
