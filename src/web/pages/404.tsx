import { useTranslation } from "react-i18next";

import { FileQuestion } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { useLocaleNavigate } from "@/web/hooks/use-locale";

export default function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useLocaleNavigate();

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 text-center px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">404</h1>
        <p className="text-lg font-medium">{t("error.404.title")}</p>
        <p className="text-sm text-muted-foreground max-w-sm">{t("error.404.desc")}</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => navigate(-1)}>
          {t("error.btn.back")}
        </Button>
        <Button onClick={() => navigate("/")}>{t("error.btn.home")}</Button>
      </div>
    </div>
  );
}
