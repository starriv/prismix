import { useCallback, useEffect, useRef, useState } from "react";

import { useAccount, useSignMessage } from "wagmi";

import { API_AUTH_LOGOUT, API_AUTH_ME } from "@/web/api/constants";
import type { UserPortalInfo } from "@/web/api/schemas";
import { userMeResponseSchema } from "@/web/api/schemas";
import {
  useUserAuthAuthenticate,
  useUserAuthExchange,
  useUserAuthInitialize,
  useUserAuthRegister,
  useUserLogout,
} from "@/web/api/user-auth-hooks";
import {
  getUserRefreshToken,
  getUserToken,
  setUserRefreshToken,
  setUserToken,
  UserApiError,
  userGet,
  userTokenPostVoid,
} from "@/web/api/user-client";

export type AuthProviderType = "siwe" | "credentials" | "google" | "github" | "oidc" | "saml";

const ERROR_CODE_MAP: Record<string, string> = {
  invalid_credentials: "invalid-credentials",
  account_not_found: "not_registered",
  not_registered: "not_registered",
  account_exists: "account-exists",
  password_too_weak: "password-too-weak",
  signature_invalid: "verify-failed",
  nonce_expired: "verify-failed",
  provider_error: "oauth-failed",
};

interface UserAuthState {
  user: UserPortalInfo | null;
  isValidating: boolean;
  isBusy: boolean;
  error: string | null;
}

export function useUserAuth() {
  const [state, setState] = useState<UserAuthState>({
    user: null,
    isValidating: true,
    isBusy: false,
    error: null,
  });

  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const initializeMut = useUserAuthInitialize();
  const authenticateMut = useUserAuthAuthenticate();
  const registerMut = useUserAuthRegister();
  const exchangeMut = useUserAuthExchange();
  const logoutMut = useUserLogout();

  // Validate existing token on mount (uses auto-refresh-capable client)
  useEffect(() => {
    const token = getUserToken();
    if (!token) {
      setState({ user: null, isValidating: false, isBusy: false, error: null });
      return;
    }

    userGet(API_AUTH_ME, userMeResponseSchema)
      .then((data) => {
        setState({
          user: data.user,
          isValidating: false,
          isBusy: false,
          error: null,
        });
      })
      .catch(() => {
        setUserToken(null);
        setUserRefreshToken(null);
        setState({ user: null, isValidating: false, isBusy: false, error: null });
      });
  }, []);

  // Auto-logout on wallet disconnect — only fires when isConnected
  // transitions from true -> false (not on initial mount when wagmi
  // hasn't hydrated yet and isConnected starts as false).
  const prevConnected = useRef(isConnected);
  useEffect(() => {
    const wasConnected = prevConnected.current;
    prevConnected.current = isConnected;
    // Only act on true -> false transition
    if (wasConnected && !isConnected && state.user?.address) {
      const token = getUserToken();
      const refreshToken = getUserRefreshToken();
      if (token) userTokenPostVoid(API_AUTH_LOGOUT, token, { refreshToken });
      setUserToken(null);
      setUserRefreshToken(null);
      setState({ user: null, isValidating: false, isBusy: false, error: null });
    }
  }, [isConnected, state.user]);

  /**
   * Unified user login — dispatches to the correct flow per provider.
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
          setUserToken(data.token);
          setUserRefreshToken(data.refreshToken);
          setState({ user: data.user, isValidating: false, isBusy: false, error: null });
        } else if (provider === "credentials") {
          const data = await authenticateMut.mutateAsync({
            provider: "credentials",
            body: params ?? {},
          });
          setUserToken(data.token);
          setUserRefreshToken(data.refreshToken);
          setState({ user: data.user, isValidating: false, isBusy: false, error: null });
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
        const msg =
          err instanceof Error && err.message.includes("User rejected")
            ? "user-rejected"
            : err instanceof UserApiError && err.code
              ? (ERROR_CODE_MAP[err.code] ?? "login-failed")
              : "login-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [address, signMessageAsync, initializeMut, authenticateMut],
  );

  /**
   * Unified user register — registers a new user via strategy.
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
          setUserToken(data.token);
          setUserRefreshToken(data.refreshToken);
          setState({ user: data.user, isValidating: false, isBusy: false, error: null });
        } else {
          const data = await registerMut.mutateAsync({
            provider,
            body: params ?? {},
          });
          setUserToken(data.token);
          setUserRefreshToken(data.refreshToken);
          setState({ user: data.user, isValidating: false, isBusy: false, error: null });
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error && err.message.includes("User rejected")
            ? "user-rejected"
            : err instanceof UserApiError && err.code
              ? (ERROR_CODE_MAP[err.code] ?? "register-failed")
              : "register-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [address, signMessageAsync, initializeMut, registerMut],
  );

  /**
   * Exchange an OAuth one-time code for user tokens.
   * Called from /user/auth/callback page after OAuth redirect.
   */
  const exchange = useCallback(
    async (code: string) => {
      setState((s) => ({ ...s, isBusy: true, error: null }));
      try {
        const data = await exchangeMut.mutateAsync(code);
        setUserToken(data.token);
        setUserRefreshToken(data.refreshToken);
        setState({ user: data.user, isValidating: false, isBusy: false, error: null });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "exchange-failed";
        setState((s) => ({ ...s, isBusy: false, error: msg }));
      }
    },
    [exchangeMut],
  );

  const logout = useCallback(async () => {
    await logoutMut.mutateAsync();
    setUserToken(null);
    setUserRefreshToken(null);
    setState({ user: null, isValidating: false, isBusy: false, error: null });
  }, [logoutMut]);

  return {
    user: state.user,
    isValidating: state.isValidating,
    isBusy: state.isBusy,
    error: state.error,
    isAuthenticated: !!state.user,
    login,
    register,
    exchange,
    logout,
  };
}
