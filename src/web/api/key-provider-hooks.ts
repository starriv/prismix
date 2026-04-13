import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_KEY_PROVIDER_TXNS,
  API_KEY_PROVIDERS,
  apiKeyProviderAdjust,
  apiKeyProviderDetail,
  apiKeyProviderSummary,
} from "./constants";
import { queryKeys } from "./query-keys";
import type { CreateKeyProviderBody } from "./schemas";
import {
  keyProviderDetailSchema,
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

export function useKeyProviderDetail(providerId: number | null) {
  return useQuery({
    queryKey: queryKeys.keyProviderDetail(providerId ?? 0),
    queryFn: () => get(apiKeyProviderDetail(providerId!), keyProviderDetailSchema),
    enabled: providerId != null && providerId > 0,
  });
}

export function useKeyProviderSummary(providerId: number | null) {
  return useQuery({
    queryKey: queryKeys.keyProviderSummary(providerId ?? 0),
    queryFn: () => get(apiKeyProviderSummary(providerId!), keyProviderSummarySchema),
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
      qc.invalidateQueries({ queryKey: ["app", "key-provider-summary"] });
      qc.invalidateQueries({ queryKey: ["app", "key-provider-detail"] });
    },
  });
}

export function useDeleteKeyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiKeyProviderDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
      qc.invalidateQueries({ queryKey: ["app", "key-provider-summary"] });
      qc.invalidateQueries({ queryKey: ["app", "key-provider-detail"] });
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
      qc.invalidateQueries({ queryKey: ["app", "key-provider-summary"] });
      qc.invalidateQueries({ queryKey: ["app", "key-provider-detail"] });
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
