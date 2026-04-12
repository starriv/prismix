/**
 * User Auth API hooks — react-query wrappers for strategy-based user auth flows.
 *
 * Same pattern as admin-auth-hooks.ts: session validation is imperative (useEffect),
 * login/logout use useMutation.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import {
  API_AUTH_EXCHANGE,
  API_AUTH_PROVIDERS,
  apiAuthAuthenticate,
  apiAuthInitialize,
  apiAuthRegister,
} from "./constants";
import { queryKeys } from "./query-keys";
import { authProvidersSchema, userVerifyResponseSchema } from "./schemas";
import { userPublicGet, userPublicPost, userTokenPostVoid } from "./user-client";

/** Fetch enabled user auth providers */
export function useUserAuthProviders() {
  return useQuery({
    queryKey: queryKeys.userAuthProviders(),
    queryFn: () => userPublicGet(API_AUTH_PROVIDERS, authProvidersSchema),
  });
}

/** Initialize user auth strategy (nonce for SIWE, OAuth URL for Google/GitHub) */
export function useUserAuthInitialize() {
  return useMutation({
    mutationFn: (params: { provider: string; body?: Record<string, unknown> }) =>
      userPublicPost(
        apiAuthInitialize(params.provider),
        params.body ?? {},
        z.record(z.string(), z.unknown()),
      ),
  });
}

/** Authenticate user via strategy */
export function useUserAuthAuthenticate() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      userPublicPost(apiAuthAuthenticate(params.provider), params.body, userVerifyResponseSchema),
  });
}

/** Register user via strategy */
export function useUserAuthRegister() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      userPublicPost(apiAuthRegister(params.provider), params.body, userVerifyResponseSchema),
  });
}

/** Exchange one-time OAuth code for user tokens */
export function useUserAuthExchange() {
  return useMutation({
    mutationFn: (code: string) =>
      userPublicPost(API_AUTH_EXCHANGE, { code }, userVerifyResponseSchema),
  });
}

/** User logout — fire-and-forget, sends refresh token for server-side revocation */
export function useUserLogout() {
  return useMutation({
    mutationFn: async () => {
      const { getUserToken, getUserRefreshToken } = await import("./user-client");
      const token = getUserToken();
      const refreshToken = getUserRefreshToken();
      if (token) {
        const { API_AUTH_LOGOUT } = await import("./constants");
        await userTokenPostVoid(API_AUTH_LOGOUT, token, { refreshToken });
      }
    },
  });
}
