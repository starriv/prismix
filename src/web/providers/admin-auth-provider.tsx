import { createContext, type ReactNode, useContext } from "react";

import type { AdminInfo } from "@/web/api/schemas";
import { useAdminAuth } from "@/web/hooks/use-admin-auth";

type AuthProviderType = "siwe" | "credentials" | "google" | "github" | "oidc" | "saml";

interface AdminAuthContextValue {
  admin: AdminInfo | null;
  isValidating: boolean;
  isBusy: boolean;
  error: string | null;
  isAuthenticated: boolean;
  login: (provider: AuthProviderType, params?: Record<string, unknown>) => Promise<void>;
  register: (provider: AuthProviderType, params?: Record<string, unknown>) => Promise<void>;
  exchange: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAdminAuth();
  return <AdminAuthContext.Provider value={auth}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuthContext(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuthContext must be used within AdminAuthProvider");
  return ctx;
}
