import { useCallback, useEffect, useRef, useState } from "react";

import { useAccount, useSignMessage } from "wagmi";

import {
  useAdminAuthAuthenticate,
  useAdminAuthExchange,
  useAdminAuthInitialize,
  useAdminAuthRegister,
  useAdminLogout,
} from "@/web/api/admin-auth-hooks";
import {
  AdminApiError,
  adminGet,
  adminTokenPostVoid,
  getAdminRefreshToken,
  getAdminToken,
  setAdminRefreshToken,
  setAdminToken,
} from "@/web/api/admin-client";
import { API_ADMIN_AUTH_LOGOUT, API_ADMIN_AUTH_ME } from "@/web/api/constants";
import type { AdminInfo } from "@/web/api/schemas";
import { adminMeResponseSchema } from "@/web/api/schemas";

type AuthProviderType = "siwe" | "credentials" | "google" | "github" | "oidc" | "saml";

const ERROR_CODE_MAP: Record<string, string> = {
  invalid_credentials: "invalid-credentials",
  account_not_found: "not-admin",
  account_exists: "account-exists",
  signature_invalid: "verify-failed",
  nonce_expired: "verify-failed",
  provider_error: "oauth-failed",
};

interface AdminAuthState {
  admin: AdminInfo | null;
  isValidating: boolean;
  isBusy: boolean;
  error: string | null;
}

export function useAdminAuth() {
  const [state, setState] = useState<AdminAuthState>({
    admin: null,
    isValidating: true,
    isBusy: false,
    error: null,
  });

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const initializeMut = useAdminAuthInitialize();
  const authenticateMut = useAdminAuthAuthenticate();
  const registerMut = useAdminAuthRegister();
  const exchangeMut = useAdminAuthExchange();
  const logoutMut = useAdminLogout();

  // Validate existing token on mount (uses auto-refresh-capable client)
  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setState({ admin: null, isValidating: false, isBusy: false, error: null });
      return;
    }

    adminGet(API_ADMIN_AUTH_ME, adminMeResponseSchema)
      .then((data) => {
        setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
      })
      .catch(() => {
        setAdminToken(null);
        setAdminRefreshToken(null);
        setState({ admin: null, isValidating: false, isBusy: false, error: null });
      });
  }, []);

  // Auto-logout on wallet disconnect — only fires when isConnected
  // transitions from true → false (not on initial mount when wagmi
  // hasn't hydrated yet and isConnected starts as false).
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    const wasConnected = prevConnected.current;
    prevConnected.current = isConnected;
    // Only act on true → false transition
    if (wasConnected && !isConnected && state.admin?.address) {
      const token = getAdminToken();
      const refreshToken = getAdminRefreshToken();
      if (token) adminTokenPostVoid(API_ADMIN_AUTH_LOGOUT, token, { refreshToken });
      setAdminToken(null);
      setAdminRefreshToken(null);
      setState({ admin: null, isValidating: false, isBusy: false, error: null });
    }
  }, [isConnected, state.admin]);

  /**
   * Unified admin login — dispatches to the correct flow per provider.
   *
   * SIWE:         login("siwe") -> nonce -> sign -> authenticate
   * Credentials:  login("credentials", { email, password })
   * OAuth:        login("google") / login("github") -> redirect to OAuth URL
   */
  const login = useCallback(
    async (provider: AuthProviderType, params?: Record<string, unknown>) => {
      setState((s) => ({ ...s, isBusy: true, error: null }));

      try {
        if (provider === "siwe") {
          if (!address) {
            setState((s) => ({ ...s, isBusy: false, error: "no-wallet" }));
            return;
          }
          const initData = await initializeMut.mutateAsync({
            provider: "siwe",
            body: { address },
          });
          const message = initData.message as string;
          const signature = await signMessageAsync({ message });
          const data = await authenticateMut.mutateAsync({
            provider: "siwe",
            body: { address, signature, message },
          });
          setAdminToken(data.token);
          setAdminRefreshToken(data.refreshToken);
          setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
        } else if (provider === "credentials") {
          const data = await authenticateMut.mutateAsync({
            provider: "credentials",
            body: params ?? {},
          });
          setAdminToken(data.token);
          setAdminRefreshToken(data.refreshToken);
          setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
        } else {
          // OAuth: initialize -> redirect
          const initData = await initializeMut.mutateAsync({ provider });
          const url = initData.url as string;
          if (url) {
            window.location.href = url;
            return;
          }
          throw new Error("OAuth provider did not return a URL");
        }
      } catch (err: unknown) {
        if (err instanceof AdminApiError && err.status === 403) {
          setState((s) => ({ ...s, isBusy: false, error: "not-admin" }));
          return;
        }
        const msg =
          err instanceof Error && err.message.includes("User rejected")
            ? "user-rejected"
            : err instanceof AdminApiError && err.code
              ? (ERROR_CODE_MAP[err.code] ?? "login-failed")
              : "login-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [address, signMessageAsync, initializeMut, authenticateMut],
  );

  /**
   * Unified admin register — registers a new admin via strategy.
   */
  const register = useCallback(
    async (provider: AuthProviderType, params?: Record<string, unknown>) => {
      setState((s) => ({ ...s, isBusy: true, error: null }));

      try {
        if (provider === "siwe") {
          if (!address) {
            setState((s) => ({ ...s, isBusy: false, error: "no-wallet" }));
            return;
          }
          const initData = await initializeMut.mutateAsync({
            provider: "siwe",
            body: { address },
          });
          const message = initData.message as string;
          const signature = await signMessageAsync({ message });
          const data = await registerMut.mutateAsync({
            provider: "siwe",
            body: { address, signature, message, ...(params ?? {}) },
          });
          setAdminToken(data.token);
          setAdminRefreshToken(data.refreshToken);
          setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
        } else {
          const data = await registerMut.mutateAsync({
            provider,
            body: params ?? {},
          });
          setAdminToken(data.token);
          setAdminRefreshToken(data.refreshToken);
          setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
        }
      } catch (err: unknown) {
        if (err instanceof AdminApiError) {
          setState((s) => ({ ...s, isBusy: false, error: err.message || "register-failed" }));
          return;
        }
        const msg =
          err instanceof Error && err.message.includes("User rejected")
            ? "user-rejected"
            : "register-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [address, signMessageAsync, initializeMut, registerMut],
  );

  /**
   * Exchange an OAuth one-time code for admin tokens.
   * Called from /admin/auth/callback page after OAuth redirect.
   */
  const exchange = useCallback(
    async (code: string) => {
      setState((s) => ({ ...s, isBusy: true, error: null }));
      try {
        const data = await exchangeMut.mutateAsync(code);
        setAdminToken(data.token);
        setAdminRefreshToken(data.refreshToken);
        setState({ admin: data.admin, isValidating: false, isBusy: false, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "exchange-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [exchangeMut],
  );

  const logout = useCallback(async () => {
    await logoutMut.mutateAsync();
    setAdminToken(null);
    setAdminRefreshToken(null);
    setState({ admin: null, isValidating: false, isBusy: false, error: null });
  }, [logoutMut]);

  return {
    admin: state.admin,
    isValidating: state.isValidating,
    isBusy: state.isBusy,
    error: state.error,
    isAuthenticated: !!state.admin,
    login,
    register,
    exchange,
    logout,
  };
}
