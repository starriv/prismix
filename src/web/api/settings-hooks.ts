import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, publicGet, put } from "./client";
import {
  API_ALLOWED_TOKENS,
  API_ANNOUNCEMENTS,
  API_API_KEYS,
  API_AUTH_ALLOWED_TOKENS,
  API_AUTH_NETWORKS,
  API_FIAT_CONFIGS,
  API_NETWORKS,
  apiApiKeyDetail,
  apiApiKeyRevoke,
  apiApiKeyRotate,
  apiFiatConfigDetail,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import type {
  AllowedToken,
  ApiKey,
  CreateApiKeyBody,
  CreateFiatConfigBody,
  SupportedNetwork,
  UpdateApiKeyBody,
  UpdateFiatConfigBody,
} from "./schemas";
import {
  allowedTokenSchema,
  announcementSchema,
  apiKeySchema,
  apiKeyWithSecretSchema,
  fiatConfigSchema,
  supportedNetworkSchema,
} from "./schemas";

export { DEFAULT_PAGE_SIZE as PAGE_SIZE };

// ── Queries ───────────────────────────────────────────────────────────

export function useAllowedTokens() {
  return useQuery<AllowedToken[]>({
    queryKey: queryKeys.allowedTokens(),
    queryFn: () => get(API_ALLOWED_TOKENS, z.array(allowedTokenSchema)),
  });
}

export function usePublicAllowedTokens() {
  return useQuery<AllowedToken[]>({
    queryKey: queryKeys.publicAllowedTokens(),
    queryFn: () => publicGet(API_AUTH_ALLOWED_TOKENS, z.array(allowedTokenSchema)),
  });
}

/** Enabled networks — authenticated use */
export function useNetworks() {
  return useQuery<SupportedNetwork[]>({
    queryKey: queryKeys.networks(),
    queryFn: () => get(API_NETWORKS, z.array(supportedNetworkSchema)),
  });
}

/** Enabled networks — public, no auth required */
export function usePublicNetworks() {
  return useQuery<SupportedNetwork[]>({
    queryKey: queryKeys.publicNetworks(),
    queryFn: () => publicGet(API_AUTH_NETWORKS, z.array(supportedNetworkSchema)),
  });
}

// ── API Keys ──────────────────────────────────────────────────────────

export function useApiKeys() {
  return useQuery<ApiKey[]>({
    queryKey: queryKeys.apiKeys(),
    queryFn: () => get(API_API_KEYS, z.array(apiKeySchema)),
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiKeyBody) => post(API_API_KEYS, body, apiKeyWithSecretSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

export function useUpdateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateApiKeyBody & { id: number }) =>
      put(apiApiKeyDetail(id), body, apiKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(apiApiKeyRevoke(id), {}, apiKeySchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

export function useRotateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => post(apiApiKeyRotate(id), {}, apiKeyWithSecretSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

export function useDeleteApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiApiKeyDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.apiKeys() });
    },
  });
}

// ── Fiat Configs ──────────────────────────────────────────────────────

export function useFiatConfigs() {
  return useQuery({
    queryKey: queryKeys.fiatConfigs(),
    queryFn: () => get(API_FIAT_CONFIGS, z.array(fiatConfigSchema)),
  });
}

export function useCreateFiatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFiatConfigBody) => post(API_FIAT_CONFIGS, body, fiatConfigSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fiatConfigs() });
    },
  });
}

export function useUpdateFiatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateFiatConfigBody) =>
      put(apiFiatConfigDetail(id), body, fiatConfigSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fiatConfigs() });
    },
  });
}

export function useDeleteFiatConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiFiatConfigDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fiatConfigs() });
    },
  });
}

export function useReorderFiatConfigs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      put(API_FIAT_CONFIGS + "/reorder", { ids }, z.array(fiatConfigSchema)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fiatConfigs() });
    },
  });
}

// ── Announcements ─────────────────────────────────────────────────────

export function useAnnouncements() {
  return useQuery({
    queryKey: queryKeys.announcements(),
    queryFn: () => get(API_ANNOUNCEMENTS, z.array(announcementSchema)),
  });
}
