import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_KEY_PROVIDER_TXNS,
  API_KEY_PROVIDERS,
  apiKeyProviderAdjust,
  apiKeyProviderDetail,
  apiKeyProviderKeys,
  apiKeyProviderRecent,
  apiKeyProviderSummary,
} from "./constants";
import { queryKeys } from "./query-keys";
import type { CreateKeyProviderBody } from "./schemas";
import { aiUsageRecordSchema } from "./schemas";
import {
  keyProviderKeysSchema,
  keyProviderSchema,
  keyProviderSummarySchema,
  keyProviderTransactionSchema,
} from "./schemas";

// ── Key Providers ─────────────────────────────────────────────────────

export function useKeyProviders() {
  return useQuery({
    queryKey: queryKeys.keyProviders(),
    queryFn: () => get(API_KEY_PROVIDERS, z.array(keyProviderSchema)),
  });
}

export function useKeyProviderSummary(providerId: number | null) {
  return useQuery({
    queryKey: queryKeys.keyProviderSummary(providerId ?? 0),
    queryFn: () => get(apiKeyProviderSummary(providerId!), keyProviderSummarySchema),
    enabled: providerId != null && providerId > 0,
  });
}

export function useKeyProviderKeys(
  providerId: number | null,
  opts?: {
    limit?: number;
    offset?: number;
  },
) {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;
  return useQuery({
    queryKey: queryKeys.keyProviderKeys(providerId ?? 0, limit, offset),
    queryFn: () =>
      get(
        `${apiKeyProviderKeys(providerId!)}?limit=${limit}&offset=${offset}`,
        keyProviderKeysSchema,
      ),
    enabled: providerId != null && providerId > 0,
  });
}

export function useKeyProviderRecent(
  providerId: number | null,
  opts?: {
    limit?: number;
    offset?: number;
  },
) {
  const limit = opts?.limit ?? 10;
  const offset = opts?.offset ?? 0;
  return useQuery({
    queryKey: queryKeys.keyProviderRecent(providerId ?? 0, limit, offset),
    queryFn: () =>
      get(
        `${apiKeyProviderRecent(providerId!)}?limit=${limit}&offset=${offset}`,
        z.array(aiUsageRecordSchema),
      ),
    enabled: providerId != null && providerId > 0,
  });
}

export function useCreateKeyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKeyProviderBody) => post(API_KEY_PROVIDERS, body, keyProviderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
    },
  });
}

export function useUpdateKeyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Partial<CreateKeyProviderBody>) =>
      put(apiKeyProviderDetail(id), body, keyProviderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useDeleteKeyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiKeyProviderDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useAdjustKeyProviderBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      amount: string;
      type: "credit" | "debit";
      description?: string;
    }) => post(apiKeyProviderAdjust(id), body, keyProviderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderSummaryPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderKeysPrefix() });
      qc.invalidateQueries({ queryKey: queryKeys.keyProviderRecentPrefix() });
    },
  });
}

export function useKeyProviderTxns(
  providerId: number,
  opts?: {
    limit?: number;
    offset?: number;
  },
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  return useQuery({
    queryKey: queryKeys.keyProviderTxns(providerId, limit, offset),
    queryFn: () =>
      get(
        `${API_KEY_PROVIDER_TXNS}?providerId=${providerId}&limit=${limit}&offset=${offset}`,
        z.array(keyProviderTransactionSchema),
      ),
    enabled: providerId > 0,
  });
}
