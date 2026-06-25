import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { Loader2 } from "lucide-react";

import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { useLocaleNavigate } from "@/web/hooks/use-locale";
import { useAdminAuthContext } from "@/web/providers/admin-auth-provider";

export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();
  const [searchParams] = useSearchParams();
  const { admin, isAuthenticated, exchange } = useAdminAuthContext();
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const exchangingRef = useRef(false);

  const code = searchParams.get("code");
  const urlError = searchParams.get("error");
  const error = urlError ?? exchangeError;

  useEffect(() => {
    if (isAuthenticated && admin) {
      navigate("/admin/dashboard", { replace: true });
      return;
    }

    if (urlError) {
      return;
    }

    if (code && !exchangingRef.current) {
      exchangingRef.current = true;
      exchange(code).catch((err: unknown) => {
        setExchangeError(err instanceof Error ? err.message : "exchange-failed");
      });
    }
  }, [code, urlError, isAuthenticated, navigate, exchange]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-sm text-destructive">{t("auth.callback.error")}</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" asChild>
            <LocaleLink to="/admin/login">{t("auth.callback.back-to-login")}</LocaleLink>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <span className="animate-spin">
          <Loader2 className="h-6 w-6 mx-auto text-muted-foreground" />
        </span>
        <p className="text-sm text-muted-foreground">{t("auth.callback.loading")}</p>
      </div>
    </div>
  );
}
