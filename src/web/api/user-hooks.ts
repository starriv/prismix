/**
 * User Portal API hooks — TanStack Query wrappers for user-facing endpoints.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  API_USER_ANNOUNCEMENTS,
  API_USER_ERROR_DAILY,
  API_USER_ERROR_OVERVIEW,
  API_USER_KEYS,
  API_USER_LOGS,
  API_USER_MODELS,
  API_USER_PROFILE,
  API_USER_USAGE_DAILY,
  API_USER_USAGE_SUMMARY,
  API_USER_WALLET,
  API_USER_WALLET_DEPOSIT_INFO,
  API_USER_WALLET_DEPOSIT_VERIFY,
  API_USER_WALLET_FIAT_CONFIGS,
  API_USER_WALLET_TOPUP,
  API_USER_WALLET_TOPUP_ORDERS,
  API_USER_WALLET_TRANSACTIONS,
  API_USER_WALLET_WITHDRAW,
  API_USER_WALLET_WITHDRAWALS,
  apiUserKeyDetail,
  apiUserKeyDisable,
  apiUserKeyEnable,
  apiUserKeyReveal,
  apiUserRequestLog,
  apiUserWalletTopupOrder,
  apiUserWalletTopupProof,
  DEFAULT_PAGE_SIZE,
} from "./constants";
import { queryKeys } from "./query-keys";
import {
  aiDailyUsageSchema,
  aiErrorDailySchema,
  aiErrorOverviewSchema,
  aiRequestLogSchema,
  aiUsageRecordSchema,
  aiUsageSummarySchema,
  announcementSchema,
  createWalletTopupBody,
  depositInfoSchema,
  fiatConfigSchema,
  userKeySchema,
  userWalletSchema,
  userWalletTopupOrderListSchema,
  userWalletTopupOrderSchema,
  verifyDepositResultSchema,
  walletTransactionListSchema,
  withdrawOrderListSchema,
} from "./schemas";
import type {
  CreateWalletTopupBody,
  CreateWithdrawBody,
  SubmitFiatTopupProofBody,
  UserKey,
  VerifyDepositBody,
} from "./schemas";
import { userDel, userGet, userPost, userPut } from "./user-client";

// ── Model Catalog ─────────────────────────────────────────────

const userModelSchema = z.object({
  modelId: z.string(),
  name: z.string(),
  inputPrice: z.string(),
  outputPrice: z.string(),
  consumerInputPrice: z.string(),
  consumerOutputPrice: z.string(),
  capabilities: z.array(z.string()),
  contextWindow: z.number().nullable(),
  limitedFreeUntil: z.string().nullable().optional(),
  isLimitedFree: z.coerce.boolean().optional(),
});

const userModelEndpointSchema = z.object({
  id: z.number(),
  name: z.string(),
  iconUrl: z.string().nullable(),
  apiFormat: z.string(),
  models: z.array(userModelSchema),
});

const userModelCatalogSchema = z.object({
  endpoints: z.array(userModelEndpointSchema),
  markupPercent: z.number(),
});

export type UserModelEndpoint = z.infer<typeof userModelEndpointSchema>;
export type UserModel = z.infer<typeof userModelSchema>;
export type UserModelCatalog = z.infer<typeof userModelCatalogSchema>;

export function useUserModels() {
  return useQuery({
    queryKey: queryKeys.userModels(),
    queryFn: () => userGet(API_USER_MODELS, userModelCatalogSchema),
  });
}

// ── Profile ───────────────────────────────────────────────────

export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userProfile(),
    queryFn: () =>
      userGet(
        API_USER_PROFILE,
        z.object({
          id: z.number(),
          uuid: z.string().nullable().optional(),
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
      userPost(apiUserKeyReveal(id), {}, z.object({ apiKey: z.string() })),
  });
}

export function useDisableUserKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => userPost(apiUserKeyDisable(id), {}, userKeySchema),
    onSuccess: (updated) => {
      qc.setQueryData(
        queryKeys.userKeys(),
        (current: UserKey[] | undefined) =>
          current?.map((key) => (key.id === updated.id ? updated : key)) ?? current,
      );
      qc.invalidateQueries({ queryKey: queryKeys.userKeys() });
    },
  });
}

export function useEnableUserKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => userPost(apiUserKeyEnable(id), {}, userKeySchema),
    onSuccess: (updated) => {
      qc.setQueryData(
        queryKeys.userKeys(),
        (current: UserKey[] | undefined) =>
          current?.map((key) => (key.id === updated.id ? updated : key)) ?? current,
      );
      qc.invalidateQueries({ queryKey: queryKeys.userKeys() });
    },
  });
}

export function useDeleteUserKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => userDel(apiUserKeyDetail(id), z.object({ success: z.boolean() })),
    onSuccess: (_result, deletedId) => {
      qc.setQueryData(
        queryKeys.userKeys(),
        (current: UserKey[] | undefined) =>
          current?.filter((key) => key.id !== deletedId) ?? current,
      );
      qc.invalidateQueries({ queryKey: queryKeys.userKeys() });
    },
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

export function useUserErrorOverview(days = 30, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.userErrorOverview(days),
    queryFn: () => userGet(`${API_USER_ERROR_OVERVIEW}?days=${days}`, aiErrorOverviewSchema),
    refetchInterval,
  });
}

export function useUserErrorDaily(days = 30, refetchInterval?: number | false) {
  return useQuery({
    queryKey: queryKeys.userErrorDaily(days),
    queryFn: () => userGet(`${API_USER_ERROR_DAILY}?days=${days}`, z.array(aiErrorDailySchema)),
    refetchInterval,
  });
}

export { DEFAULT_PAGE_SIZE as USER_LOG_PAGE_SIZE };

export function useUserLogs(opts?: {
  modelId?: string;
  statusClass?: "4xx" | "5xx";
  page?: number;
  refetchInterval?: number | false;
}) {
  const page = opts?.page ?? 0;
  const params = new URLSearchParams();
  if (opts?.modelId) params.set("modelId", opts.modelId);
  if (opts?.statusClass) params.set("statusClass", opts.statusClass);
  params.set("limit", String(DEFAULT_PAGE_SIZE));
  params.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.userLogs({ modelId: opts?.modelId, statusClass: opts?.statusClass, page }),
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

// ── Announcements ────────────────────────────────────────────────

export function useUserAnnouncements() {
  return useQuery({
    queryKey: queryKeys.userAnnouncements(),
    queryFn: () => userGet(API_USER_ANNOUNCEMENTS, z.array(announcementSchema)),
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

export function useWalletFiatConfigs(enabled = true) {
  return useQuery({
    queryKey: queryKeys.userWalletFiatConfigs(),
    queryFn: () => userGet(API_USER_WALLET_FIAT_CONFIGS, z.array(fiatConfigSchema)),
    enabled,
  });
}

export function useCreateWalletTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWalletTopupBody) =>
      userPost(
        API_USER_WALLET_TOPUP,
        createWalletTopupBody.parse(body),
        userWalletTopupOrderSchema,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.userWalletTopupOrdersAll() });
    },
  });
}

export function useWalletTopupOrder(orderId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.userWalletTopupOrder(orderId ?? 0),
    queryFn: () => userGet(apiUserWalletTopupOrder(orderId!), userWalletTopupOrderSchema),
    enabled: enabled && orderId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && status !== "pending") return false;
      return 10_000;
    },
  });
}

export function useWalletTopupOrders(params?: {
  status?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  const qs = searchParams.toString();

  return useQuery({
    queryKey: queryKeys.userWalletTopupOrders(params ?? {}),
    queryFn: () =>
      userGet(
        `${API_USER_WALLET_TOPUP_ORDERS}${qs ? `?${qs}` : ""}`,
        userWalletTopupOrderListSchema,
      ),
    enabled: params?.enabled ?? true,
    placeholderData: keepPreviousData,
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
      qc.invalidateQueries({ queryKey: queryKeys.userWalletTopupOrdersAll() });
    },
  });
}

export function useSubmitFiatTopupProof() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: SubmitFiatTopupProofBody & { id: number }) =>
      userPut(apiUserWalletTopupProof(id), body, userWalletTopupOrderSchema),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.userWalletTopupOrdersAll() });
      qc.invalidateQueries({
        queryKey: queryKeys.userWalletTopupOrder(vars.id),
      });
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
      userGet(`${API_USER_WALLET_TRANSACTIONS}${qs ? `?${qs}` : ""}`, walletTransactionListSchema),
    placeholderData: keepPreviousData,
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
      userGet(`${API_USER_WALLET_WITHDRAWALS}${qs ? `?${qs}` : ""}`, withdrawOrderListSchema),
    placeholderData: keepPreviousData,
  });
}
