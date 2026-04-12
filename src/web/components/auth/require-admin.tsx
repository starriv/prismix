import type { ReactNode } from "react";

import { LocaleNavigate } from "@/web/components/locale-link";
import { useAdminAuthContext } from "@/web/providers/admin-auth-provider";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAuthenticated, isValidating } = useAdminAuthContext();

  if (isValidating) {
    return <div className="h-screen bg-background" />;
  }

  if (!isAuthenticated) {
    return <LocaleNavigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
