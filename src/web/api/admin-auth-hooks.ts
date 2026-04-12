/**
 * Admin Auth API hooks — react-query wrappers for strategy-based admin auth flows.
 *
 * Same pattern as auth-hooks.ts: session validation is imperative (useEffect),
 * login/logout use useMutation.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { adminPublicGet, adminPublicPost, adminTokenPostVoid } from "./admin-client";
import {
  API_ADMIN_AUTH_EXCHANGE,
  API_ADMIN_AUTH_PROVIDERS,
  apiAdminAuthAuthenticate,
  apiAdminAuthInitialize,
  apiAdminAuthRegister,
} from "./constants";
import { queryKeys } from "./query-keys";
import { adminVerifyResponseSchema, authProvidersSchema } from "./schemas";

/** Fetch enabled admin auth providers */
export function useAdminAuthProviders() {
  return useQuery({
    queryKey: queryKeys.adminAuthProviders(),
    queryFn: () => adminPublicGet(API_ADMIN_AUTH_PROVIDERS, authProvidersSchema),
  });
}

/** Initialize admin auth strategy (nonce for SIWE, OAuth URL for Google/GitHub) */
export function useAdminAuthInitialize() {
  return useMutation({
    mutationFn: (params: { provider: string; body?: Record<string, unknown> }) =>
      adminPublicPost(
        apiAdminAuthInitialize(params.provider),
        params.body ?? {},
        z.record(z.string(), z.unknown()),
      ),
  });
}

/** Authenticate admin via strategy */
export function useAdminAuthAuthenticate() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      adminPublicPost(
        apiAdminAuthAuthenticate(params.provider),
        params.body,
        adminVerifyResponseSchema,
      ),
  });
}

/** Register admin via strategy */
export function useAdminAuthRegister() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      adminPublicPost(
        apiAdminAuthRegister(params.provider),
        params.body,
        adminVerifyResponseSchema,
      ),
  });
}

/** Exchange one-time OAuth code for admin tokens */
export function useAdminAuthExchange() {
  return useMutation({
    mutationFn: (code: string) =>
      adminPublicPost(API_ADMIN_AUTH_EXCHANGE, { code }, adminVerifyResponseSchema),
  });
}

/** Admin logout — fire-and-forget, sends refresh token for server-side revocation */
export function useAdminLogout() {
  return useMutation({
    mutationFn: async () => {
      const { getAdminToken, getAdminRefreshToken } = await import("./admin-client");
      const token = getAdminToken();
      const refreshToken = getAdminRefreshToken();
      if (token) {
        const { API_ADMIN_AUTH_LOGOUT } = await import("./constants");
        await adminTokenPostVoid(API_ADMIN_AUTH_LOGOUT, token, { refreshToken });
      }
    },
  });
}
