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
  const overviewQuery = useUserErrorOverview(30, 5_000);
  const dailyQuery = useUserErrorDaily(30, 5_000);

  const overview = overviewQuery.data;
  const daily = dailyQuery.data ?? [];
  const overviewLoading = overviewQuery.isLoading;
  const overviewError = overviewQuery.isError && !overview;
  const dailyLoading = dailyQuery.isLoading;
  const dailyError = dailyQuery.isError && !dailyQuery.data;

  const peakSubtitle = (dateStr: string | null | undefined): string | undefined => {
    if (overviewLoading || overviewError) return undefined;
    return dateStr ? new Date(dateStr).toLocaleDateString(i18n.language) : t("dash.ai.no-peak");
  };

  const statValue = (n: number): string =>
    overview ? n.toLocaleString() : overviewError ? "—" : "0";

  const statSubtitle = (fallback: string): string | undefined =>
    overviewLoading || overviewError ? undefined : fallback;

  return (
    <div>
      <Header title={t("user.errors.title")} description={t("user.errors.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t("dash.ai.error-4xx")}
            value={statValue(overview?.total4xx ?? 0)}
            subtitle={statSubtitle(t("dash.ai.last-30-days"))}
            icon={TriangleAlert}
            loading={overviewLoading}
            error={overviewError}
          />
          <StatCard
            title={t("dash.ai.error-5xx")}
            value={statValue(overview?.total5xx ?? 0)}
            subtitle={statSubtitle(t("dash.ai.last-30-days"))}
            icon={ServerCrash}
            loading={overviewLoading}
            error={overviewError}
          />
          <StatCard
            title={t("dash.ai.error-4xx-peak")}
            value={statValue(overview?.peak4xx ?? 0)}
            subtitle={peakSubtitle(overview?.peak4xxDate)}
            icon={AlertTriangle}
            loading={overviewLoading}
            error={overviewError}
          />
          <StatCard
            title={t("dash.ai.error-5xx-peak")}
            value={statValue(overview?.peak5xx ?? 0)}
            subtitle={peakSubtitle(overview?.peak5xxDate)}
            icon={AlertTriangle}
            loading={overviewLoading}
            error={overviewError}
          />
        </div>

        <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
          <ErrorTrendChart data={daily} loading={dailyLoading} error={dailyError} />
        </Suspense>
      </div>
    </div>
  );
}
