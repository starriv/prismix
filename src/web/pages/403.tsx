import { useTranslation } from "react-i18next";

import { ShieldOff } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { useLocaleNavigate } from "@/web/hooks/use-locale";

export default function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 text-center px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
        <ShieldOff className="h-10 w-10 text-destructive" />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">403</h1>
        <p className="text-lg font-medium">{t("error.403.title")}</p>
        <p className="text-sm text-muted-foreground max-w-sm">{t("error.403.desc")}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => navigate("/user/login")}>
          {t("error.btn.login")}
        </Button>
        <Button onClick={() => navigate("/")}>{t("error.btn.home")}</Button>
      </div>
    </div>
  );
}
