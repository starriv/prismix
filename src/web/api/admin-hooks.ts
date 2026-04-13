import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { adminDel, adminGet, adminPost, adminPut } from "./admin-client";
import {
  API_ADMIN_ADMINS,
  API_ADMIN_ALLOWED_TOKENS,
  API_ADMIN_ANNOUNCEMENTS,
  API_ADMIN_AUTH_PROVIDERS_CONFIG,
  API_ADMIN_CIRCLE_NETWORKS,
  API_ADMIN_KNOWN_TOKENS,
  API_ADMIN_NETWORKS,
  API_ADMIN_NOTIFICATION_PROVIDERS,
  API_ADMIN_SSO_DISCOVER_SAML,
  API_ADMIN_USERS,
  API_ADMIN_WITHDRAWALS,
  API_ADMIN_WITHDRAWALS_PENDING_COUNT,
  apiAdminAnnouncementDetail,
  apiAdminAnnouncementSend,
  apiAdminUserCreateAgent,
  apiAdminUserCredit,
  apiAdminUserDetail,
  apiAdminUserDisable,
  apiAdminUserEnable,
  apiAdminWithdrawApprove,
  apiAdminWithdrawReject,
} from "./constants";
// ── Withdrawal Orders ──────────────────────────────────────────────

import { DEFAULT_PAGE_SIZE } from "./constants";
import { queryKeys } from "./query-keys";
import {
  adminUserDetailSchema,
  type AllowedToken,
  allowedTokenSchema,
  type CircleNetworkEntry,
  circleNetworkEntrySchema,
  type KnownTokenInfo,
  knownTokenSchema,
  merchantSchema,
  type SupportedNetwork,
  supportedNetworkSchema,
} from "./schemas";
// ── Announcements ───────────────────────────────────────────────────

import {
  type Announcement,
  announcementSchema,
  type CreateAnnouncementBody,
  type UpdateAnnouncementBody,
} from "./schemas";
import { withdrawOrderSchema } from "./schemas";

const userListSchema = z.array(merchantSchema);

// ── Admin Members ───────────────────────────────────────────────────

const adminMemberSchema = z.object({
  id: z.number(),
  name: z.string(),
  address: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.string(),
  identities: z.array(
    z.object({
      id: z.number(),
      provider: z.string(),
      providerAccountId: z.string(),
    }),
  ),
});
export type AdminMember = z.infer<typeof adminMemberSchema>;

export function useAdminMembers() {
  return useQuery({
    queryKey: queryKeys.adminAdmins(),
    queryFn: () => adminGet(API_ADMIN_ADMINS, z.array(adminMemberSchema)),
  });
}

export function useCreateAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      provider: string;
      providerAccountId: string;
      email?: string;
      address?: string;
      password?: string;
    }) => adminPost(API_ADMIN_ADMINS, body, z.unknown()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAdmins() });
    },
  });
}

export function useDeleteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminDel(`${API_ADMIN_ADMINS}?id=${id}`, z.unknown()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAdmins() });
    },
  });
}

// ── Queries ─────────────────────────────────────────────────────────

export function useAdminUsers(params?: {
  name?: string;
  email?: string;
  address?: string;
  page?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.name) qs.set("name", params.name);
  if (params?.email) qs.set("email", params.email);
  if (params?.address) qs.set("address", params.address);
  const page = params?.page ?? 0;
  qs.set("limit", String(DEFAULT_PAGE_SIZE));
  qs.set("offset", String(page * DEFAULT_PAGE_SIZE));
  const query = qs.toString();
  return useQuery({
    queryKey: queryKeys.adminUsers(params),
    queryFn: () => adminGet(`${API_ADMIN_USERS}?${query}`, userListSchema),
    placeholderData: keepPreviousData,
  });
}

/** @deprecated Use `useAdminUsers` instead */
export const useAdminMerchants = useAdminUsers;

export function useAdminUserDetail(userId: number) {
  return useQuery({
    queryKey: queryKeys.adminUserDetail(userId),
    queryFn: () => adminGet(apiAdminUserDetail(userId), adminUserDetailSchema),
    enabled: userId > 0,
  });
}

export function useAdminAllowedTokens() {
  return useQuery<AllowedToken[]>({
    queryKey: queryKeys.adminAllowedTokens(),
    queryFn: () => adminGet(API_ADMIN_ALLOWED_TOKENS, z.array(allowedTokenSchema)),
  });
}

export function useKnownTokens() {
  return useQuery<KnownTokenInfo[]>({
    queryKey: queryKeys.adminKnownTokens(),
    queryFn: () => adminGet(API_ADMIN_KNOWN_TOKENS, z.array(knownTokenSchema)),
  });
}

export function useAdminNetworks() {
  return useQuery<SupportedNetwork[]>({
    queryKey: queryKeys.adminNetworks(),
    queryFn: () => adminGet(API_ADMIN_NETWORKS, z.array(supportedNetworkSchema)),
  });
}

export function useCircleNetworks() {
  return useQuery<CircleNetworkEntry[]>({
    queryKey: queryKeys.adminCircleNetworks(),
    queryFn: () => adminGet(API_ADMIN_CIRCLE_NETWORKS, z.array(circleNetworkEntrySchema)),
  });
}

// ── Mutations ───────────────────────────────────────────────────────

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminDel(`${API_ADMIN_USERS}?id=${id}`, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/** @deprecated Use `useDeleteUser` instead */
export const useDeleteMerchant = useDeleteUser;

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      name?: string;
      email?: string;
      status?: number;
      agentId?: number | null;
    }) => adminPut(apiAdminUserDetail(id), body, z.unknown()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useCreateUserAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: number) => adminPost(apiAdminUserCreateAgent(userId), {}, z.unknown()),
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: queryKeys.adminUserDetail(userId) });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentsAll() });
    },
  });
}

export function useDisableUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminPost(apiAdminUserDisable(id), {}, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useEnableUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminPost(apiAdminUserEnable(id), {}, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

export function useCreditUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; amount: string; description?: string }) =>
      adminPost(
        apiAdminUserCredit(id),
        body,
        z.object({ success: z.boolean(), balance: z.string() }),
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: queryKeys.adminUserDetail(vars.id) });
    },
  });
}

export function useCreateAllowedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { symbol: string; network: string; contractAddress: string }) =>
      adminPost(API_ADMIN_ALLOWED_TOKENS, body, allowedTokenSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAllowedTokens() });
    },
  });
}

export function useUpdateAllowedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: number; enabled?: boolean }) =>
      adminPut(API_ADMIN_ALLOWED_TOKENS, body, allowedTokenSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAllowedTokens() });
    },
  });
}

export function useDeleteAllowedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminDel(`${API_ADMIN_ALLOWED_TOKENS}?id=${id}`, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAllowedTokens() });
    },
  });
}

export function useCreateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      chainId: number;
      networkId: string;
      name: string;
      shortName: string;
      explorerUrl: string;
      testnet: boolean;
      iconUrl: string;
      rpcUrl?: string;
    }) => adminPost(API_ADMIN_NETWORKS, body, supportedNetworkSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminNetworks() });
      qc.invalidateQueries({ queryKey: queryKeys.adminCircleNetworks() });
    },
  });
}

export function useUpdateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: number; enabled?: boolean; rpcUrl?: string }) =>
      adminPut(API_ADMIN_NETWORKS, body, supportedNetworkSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminNetworks() });
    },
  });
}

export function useDeleteNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      adminDel(`${API_ADMIN_NETWORKS}?id=${id}`, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminNetworks() });
      qc.invalidateQueries({ queryKey: queryKeys.adminCircleNetworks() });
      qc.invalidateQueries({ queryKey: queryKeys.adminAllowedTokens() });
    },
  });
}

// ── Auth Provider Config ──────────────────────────────────────────

const authProvidersConfigSchema = z.record(z.string(), z.unknown());

export function useAdminAuthProvidersConfig() {
  return useQuery({
    queryKey: queryKeys.adminAuthProvidersConfig(),
    queryFn: () => adminGet(API_ADMIN_AUTH_PROVIDERS_CONFIG, authProvidersConfigSchema),
  });
}

export function useUpdateAdminAuthProvidersConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminPut(API_ADMIN_AUTH_PROVIDERS_CONFIG, body, authProvidersConfigSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminAuthProvidersConfig() });
    },
  });
}

// ── SAML Discovery ──────────────────────────────────────────────────

const samlDiscoverSchema = z.object({
  entityId: z.string(),
  ssoUrl: z.string(),
  sloUrl: z.string(),
  certificate: z.string(),
});

export type SamlDiscoverResult = z.infer<typeof samlDiscoverSchema>;

export function useDiscoverSamlMetadata() {
  return useMutation({
    mutationFn: (metadataUrl: string) =>
      adminPost(API_ADMIN_SSO_DISCOVER_SAML, { metadataUrl }, samlDiscoverSchema),
  });
}

// ── Notification Providers ──────────────────────────────────────────

const notifProvidersConfigSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

export function useAdminNotificationProviders() {
  return useQuery({
    queryKey: queryKeys.adminNotificationProviders(),
    queryFn: () => adminGet(API_ADMIN_NOTIFICATION_PROVIDERS, notifProvidersConfigSchema),
  });
}

export function useUpdateAdminNotificationProviders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, Record<string, unknown>>) =>
      adminPut(API_ADMIN_NOTIFICATION_PROVIDERS, body, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminNotificationProviders() });
    },
  });
}

export function useAdminAnnouncements(params?: { page?: number }) {
  const page = params?.page ?? 0;
  const qs = new URLSearchParams();
  qs.set("limit", String(DEFAULT_PAGE_SIZE));
  qs.set("offset", String(page * DEFAULT_PAGE_SIZE));
  return useQuery<Announcement[]>({
    queryKey: queryKeys.adminAnnouncements(params),
    queryFn: () => adminGet(`${API_ADMIN_ANNOUNCEMENTS}?${qs}`, z.array(announcementSchema)),
    placeholderData: keepPreviousData,
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnnouncementBody) =>
      adminPost(API_ADMIN_ANNOUNCEMENTS, body, announcementSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
  });
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateAnnouncementBody & { id: string }) =>
      adminPut(apiAdminAnnouncementDetail(id), body, announcementSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      adminDel(`${API_ADMIN_ANNOUNCEMENTS}?id=${id}`, z.object({ success: z.boolean() })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
  });
}

export function useSendAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminPost(apiAdminAnnouncementSend(id), {}, announcementSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
  });
}

export function useAdminWithdrawals(params?: { status?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params?.status && params.status !== "all") qs.set("status", params.status);
  if (params?.page) {
    qs.set("offset", String(params.page * DEFAULT_PAGE_SIZE));
    qs.set("limit", String(DEFAULT_PAGE_SIZE));
  }
  const query = qs.toString();
  return useQuery({
    queryKey: queryKeys.adminWithdrawals(params),
    queryFn: () =>
      adminGet(
        query ? `${API_ADMIN_WITHDRAWALS}?${query}` : API_ADMIN_WITHDRAWALS,
        z.array(withdrawOrderSchema),
      ),
  });
}

export function useAdminWithdrawalsPendingCount() {
  return useQuery({
    queryKey: queryKeys.adminWithdrawalsPendingCount(),
    queryFn: () => adminGet(API_ADMIN_WITHDRAWALS_PENDING_COUNT, z.object({ pending: z.number() })),
    refetchInterval: 30_000,
  });
}

export function useApproveWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminPut(apiAdminWithdrawApprove(id), {}, withdrawOrderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminWithdrawals() });
      qc.invalidateQueries({ queryKey: queryKeys.adminWithdrawalsPendingCount() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentsAll() });
    },
  });
}

export function useRejectWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      adminPut(apiAdminWithdrawReject(id), { reason }, withdrawOrderSchema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.adminWithdrawals() });
      qc.invalidateQueries({ queryKey: queryKeys.adminWithdrawalsPendingCount() });
      qc.invalidateQueries({ queryKey: queryKeys.payAgentsAll() });
    },
  });
}
