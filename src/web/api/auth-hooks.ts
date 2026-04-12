/**
 * Auth API hooks — react-query wrappers for strategy-based auth flows.
 * These power the useAuth() hook in src/web/hooks/use-auth.ts.
 *
 * Note: Session validation (GET /me) is NOT a useQuery — it's a one-shot
 * check on mount that manages localStorage tokens. Using useQuery for this
 * causes subtle bugs with `enabled` becoming stale. The /me check stays
 * as an imperative call via `get` in the useEffect of use-auth.ts.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { publicGet, publicPost, tokenPostVoid } from "./client";
import {
  API_AUTH_EXCHANGE,
  API_AUTH_PROVIDERS,
  apiAuthAuthenticate,
  apiAuthInitialize,
  apiAuthRegister,
} from "./constants";
import { queryKeys } from "./query-keys";
import { authProvidersSchema, verifyResponseSchema } from "./schemas";

/** Fetch enabled auth providers */
export function useAuthProviders() {
  return useQuery({
    queryKey: queryKeys.authProviders(),
    queryFn: () => publicGet(API_AUTH_PROVIDERS, authProvidersSchema),
  });
}

/** Initialize auth strategy (nonce for SIWE, OAuth URL for Google/GitHub) */
export function useAuthInitialize() {
  return useMutation({
    mutationFn: (params: { provider: string; body?: Record<string, unknown> }) =>
      publicPost(
        apiAuthInitialize(params.provider),
        params.body ?? {},
        z.record(z.string(), z.unknown()),
      ),
  });
}

/** Authenticate via strategy */
export function useAuthAuthenticate() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      publicPost(apiAuthAuthenticate(params.provider), params.body, verifyResponseSchema),
  });
}

/** Register via strategy */
export function useAuthRegister() {
  return useMutation({
    mutationFn: (params: { provider: string; body: Record<string, unknown> }) =>
      publicPost(apiAuthRegister(params.provider), params.body, verifyResponseSchema),
  });
}

/** Exchange one-time OAuth code for tokens */
export function useAuthExchange() {
  return useMutation({
    mutationFn: (code: string) => publicPost(API_AUTH_EXCHANGE, { code }, verifyResponseSchema),
  });
}

/** Logout — fire-and-forget, sends refresh token for server-side revocation */
export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      const { getAuthToken, getRefreshToken } = await import("./client");
      const token = getAuthToken();
      const refreshToken = getRefreshToken();
      if (token) {
        const { API_AUTH_LOGOUT } = await import("./constants");
        await tokenPostVoid(API_AUTH_LOGOUT, token, { refreshToken });
      }
    },
  });
}
