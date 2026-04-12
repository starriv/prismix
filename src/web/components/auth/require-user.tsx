import type { ReactNode } from "react";

import { LocaleNavigate } from "@/web/components/locale-link";
import { useUserAuthContext } from "@/web/providers/user-auth-provider";

export function RequireUser({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isValidating } = useUserAuthContext();

  if (isValidating) {
    return <div className="h-screen bg-background" />;
  }

  if (!isAuthenticated) {
    return <LocaleNavigate to="/user/login" replace />;
  }

  // Disabled user
  if (user?.status === 2) {
    return <LocaleNavigate to="/403" replace />;
  }

  return <>{children}</>;
}
