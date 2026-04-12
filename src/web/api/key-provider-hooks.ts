import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { del, get, post, put } from "./client";
import {
  API_KEY_PROVIDER_TXNS,
  API_KEY_PROVIDERS,
  apiKeyProviderAdjust,
  apiKeyProviderDetail,
} from "./constants";
import { queryKeys } from "./query-keys";
import type { CreateKeyProviderBody } from "./schemas";
import { keyProviderSchema, keyProviderTransactionSchema } from "./schemas";

// ── Key Providers ─────────────────────────────────────────────────────

export function useKeyProviders() {
  return useQuery({
    queryKey: queryKeys.keyProviders(),
    queryFn: () => get(API_KEY_PROVIDERS, z.array(keyProviderSchema)),
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
    },
  });
}

export function useDeleteKeyProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => del(apiKeyProviderDetail(id), z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.keyProviders() });
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
    },
  });
}

export function useKeyProviderTxns(providerId: number) {
  return useQuery({
    queryKey: queryKeys.keyProviderTxns(providerId),
    queryFn: () =>
      get(
        `${API_KEY_PROVIDER_TXNS}?providerId=${providerId}`,
        z.array(keyProviderTransactionSchema),
      ),
    enabled: providerId > 0,
  });
}
