import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ServerCrash, TriangleAlert } from "lucide-react";

import { useUserErrorDaily, useUserErrorOverview } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
import { Skeleton } from "@/web/components/ui/skeleton";

const ErrorTrendChart = lazy(() => import("@/web/pages/dashboard/error-trend-chart"));

export default function UserErrorsPage() {
  const { t, i18n } = useTranslation();
  const { data: errorOverview } = useUserErrorOverview(30, 5_000);
  const { data: errorDaily = [] } = useUserErrorDaily(30, 5_000);

  return (
    <div>
      <Header title={t("user.errors.title")} description={t("user.errors.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t("dash.ai.error-4xx")}
            value={errorOverview ? errorOverview.total4xx.toLocaleString() : "0"}
            subtitle={t("dash.ai.last-30-days")}
            icon={TriangleAlert}
          />
          <StatCard
            title={t("dash.ai.error-5xx")}
            value={errorOverview ? errorOverview.total5xx.toLocaleString() : "0"}
            subtitle={t("dash.ai.last-30-days")}
            icon={ServerCrash}
          />
          <StatCard
            title={t("dash.ai.error-4xx-peak")}
            value={errorOverview ? errorOverview.peak4xx.toLocaleString() : "0"}
            subtitle={
              errorOverview?.peak4xxDate
                ? new Date(errorOverview.peak4xxDate).toLocaleDateString(i18n.language)
                : t("dash.ai.no-peak")
            }
            icon={AlertTriangle}
          />
          <StatCard
            title={t("dash.ai.error-5xx-peak")}
            value={errorOverview ? errorOverview.peak5xx.toLocaleString() : "0"}
            subtitle={
              errorOverview?.peak5xxDate
                ? new Date(errorOverview.peak5xxDate).toLocaleDateString(i18n.language)
                : t("dash.ai.no-peak")
            }
            icon={AlertTriangle}
          />
        </div>

        <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
          <ErrorTrendChart data={errorDaily} />
        </Suspense>
      </div>
    </div>
  );
}
