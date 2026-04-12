import { createContext, type ReactNode, useContext } from "react";

import type { UserPortalInfo } from "@/web/api/schemas";
import { type AuthProviderType, useUserAuth } from "@/web/hooks/use-user-auth";

interface UserAuthContextValue {
  user: UserPortalInfo | null;
  isValidating: boolean;
  isBusy: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (provider: AuthProviderType, params?: Record<string, unknown>) => Promise<void>;
  register: (provider: AuthProviderType, params?: Record<string, unknown>) => Promise<void>;
  exchange: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const UserAuthContext = createContext<UserAuthContextValue | null>(null);

export function UserAuthProvider({ children }: { children: ReactNode }) {
  const auth = useUserAuth();
  return <UserAuthContext.Provider value={auth}>{children}</UserAuthContext.Provider>;
}

export function useUserAuthContext(): UserAuthContextValue {
  const ctx = useContext(UserAuthContext);
  if (!ctx) throw new Error("useUserAuthContext must be used within UserAuthProvider");
  return ctx;
}
