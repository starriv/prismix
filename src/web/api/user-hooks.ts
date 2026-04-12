/**
 * User Portal API hooks — TanStack Query wrappers for user-facing endpoints.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  API_USER_KEYS,
  API_USER_LOGS,
  API_USER_PROFILE,
  API_USER_USAGE_DAILY,
  API_USER_USAGE_SUMMARY,
  API_USER_WALLET,
  API_USER_WALLET_DEPOSIT_INFO,
  API_USER_WALLET_DEPOSIT_VERIFY,
  API_USER_WALLET_TRANSACTIONS,
  API_USER_WALLET_WITHDRAW,
  API_USER_WALLET_WITHDRAWALS,
  apiUserRequestLog,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  aiDailyUsageSchema,
  aiRequestLogSchema,
  aiUsageRecordSchema,
  aiUsageSummarySchema,
  depositInfoSchema,
  userKeySchema,
  userPortalInfoSchema,
  userWalletSchema,
  verifyDepositResultSchema,
  walletTransactionSchema,
  withdrawOrderSchema,
} from "./schemas";
import type { CreateWithdrawBody, VerifyDepositBody } from "./schemas";
import { userGet, userPost } from "./user-client";

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile(),
    queryFn: () =>
      userGet(
        API_USER_PROFILE,
        z.object({
          id: z.number(),
          name: z.string(),
          email: z.string().nullable(),
          avatar: z.string().nullable(),
          status: z.number(),
        }),
      ),
  });
}

export function useUserKeys() {
  return useQuery({
    queryKey: queryKeys.userKeys(),
    queryFn: () => userGet(API_USER_KEYS, z.array(userKeySchema)),
  });
}

export function useCreateUserKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      userPost(
        API_USER_KEYS,
        body,
        z.object({
          id: z.number(),
          name: z.string(),
          apiKeyPrefix: z.string(),
          apiKey: z.string(),
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userKeys() });
    },
  });
}

export function useRevealUserKey() {
  return useMutation({
    mutationFn: (id: number) =>
      userPost(`${API_USER_KEYS}/${id}/reveal`, {}, z.object({ apiKey: z.string() })),
  });
}

export function useUserUsageSummary() {
  return useQuery({
    queryKey: queryKeys.userUsageSummary(),
    queryFn: () => userGet(API_USER_USAGE_SUMMARY, aiUsageSummarySchema),
  });
}

export function useUserUsageDaily(days = 30) {
  return useQuery({
    queryKey: queryKeys.userUsageDaily(days),
    queryFn: () => userGet(`${API_USER_USAGE_DAILY}?days=${days}`, z.array(aiDailyUsageSchema)),
  });
}

export { DEFAULT_PAGE_SIZE as USER_LOG_PAGE_SIZE };

export function useUserLogs(opts?: {
  modelId?: string;
  page?: number;
  refetchInterval?: number | false;
}) {
  const page = opts?.page ?? 0;
  const params = new URLSearchParams();
  if (opts?.modelId) params.set("modelId", opts.modelId);
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.userLogs({ modelId: opts?.modelId, page }),
    queryFn: () =>
      userGet(
        `${API_USER_LOGS}?${qs}`,
        z.object({
          items: z.array(aiUsageRecordSchema),
          total: z.number(),
        }),
      ),
    placeholderData: keepPreviousData,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useUserRequestLog(requestId: string | null) {
  return useQuery({
    queryKey: queryKeys.userRequestLog(requestId ?? ""),
    queryFn: () => userGet(apiUserRequestLog(requestId!), aiRequestLogSchema),
    enabled: !!requestId,
  });
}

// ── Wallet ──────────────────────────────────────────────────────

export function useUserWallet() {
  return useQuery({
    queryKey: queryKeys.userWallet(),
    queryFn: () => userGet(API_USER_WALLET, userWalletSchema),
  });
}

export function useWalletDepositInfo(enabled = true) {
  return useQuery({
    queryKey: queryKeys.userWalletDepositInfo(),
    queryFn: () => userGet(API_USER_WALLET_DEPOSIT_INFO, depositInfoSchema),
    enabled,
  });
}

export function useVerifyDeposit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyDepositBody) =>
      userPost(API_USER_WALLET_DEPOSIT_VERIFY, body, verifyDepositResultSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userWallet() });
      qc.invalidateQueries({ queryKey: queryKeys.userWalletTransactions() });
    },
  });
}

export function useWalletTransactions(params?: { type?: string; limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  const qs = searchParams.toString();
  return useQuery({
    queryKey: queryKeys.userWalletTransactions(params),
    queryFn: () =>
      userGet(
        `${API_USER_WALLET_TRANSACTIONS}${qs ? `?${qs}` : ""}`,
        z.array(walletTransactionSchema),
      ),
  });
}

export function useCreateWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWithdrawBody) =>
      userPost(
        API_USER_WALLET_WITHDRAW,
        body,
        z.object({ orderId: z.number(), status: z.string() }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userWallet() });
      qc.invalidateQueries({ queryKey: queryKeys.userWalletTransactions() });
      qc.invalidateQueries({ queryKey: queryKeys.userWalletWithdrawals() });
    },
  });
}

export function useWalletWithdrawals(params?: {
  excludeStatus?: string;
  limit?: number;
  offset?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.excludeStatus) searchParams.set("excludeStatus", params.excludeStatus);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  const qs = searchParams.toString();
  return useQuery({
    queryKey: queryKeys.userWalletWithdrawals(params),
    queryFn: () =>
      userGet(`${API_USER_WALLET_WITHDRAWALS}${qs ? `?${qs}` : ""}`, z.array(withdrawOrderSchema)),
  });
}
