import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight, Brain, DollarSign, Hash, Key, Sparkles, Wallet } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import {
  useUserKeys,
  useUserLogs,
  useUserUsageDaily,
  useUserUsageSummary,
  useUserWallet,
} from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
import { DataTable } from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";

import {
  buildUserDashboardDailyColumns,
  buildUserDashboardRecentRequestColumns,
} from "./dashboard-columns";
import { formatUserTokens } from "./table-helpers";

const UserVolumeChart = lazy(() => import("@/web/pages/user/dashboard/volume-chart"));

export default function UserDashboardPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Header title={t("user.dash.title")} description={t("user.dash.desc")} />

      <div className="p-4 md:p-8 space-y-6 md:space-y-8">
        <UserDashboardContent />
      </div>
    </div>
  );
}

// ── Dashboard Content ──────────────────────────────────

function UserDashboardContent() {
  const { t, i18n } = useTranslation();
  const { data: summary, isLoading: summaryLoading } = useUserUsageSummary();
  const { data: daily = [] } = useUserUsageDaily(30);
  const { data: keys = [], isLoading: keysLoading } = useUserKeys();
  const { data: wallet, isLoading: walletLoading } = useUserWallet();
  const { data: logsData } = useUserLogs();

  const activeKeys = keys.filter((k) => k.status === "active");
  const recentRequests = (logsData?.items ?? []).slice(0, 5);
  const daily7 = useMemo(() => daily.slice(-7), [daily]);
  const dailyColumns = useMemo(() => buildUserDashboardDailyColumns(t), [t]);
  const recentRequestColumns = useMemo(
    () => buildUserDashboardRecentRequestColumns({ language: i18n.language, t }),
    [i18n.language, t],
  );

  const isEmpty = !summaryLoading && (!summary || summary.totalRequests === 0);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("user.dash.balance")}
          value={walletLoading ? "\u2014" : `$${removeTailingZero(wallet?.balance ?? "0")}`}
          subtitle={t("user.dash.all-time")}
          icon={Wallet}
        />
        <StatCard
          title={t("user.dash.keys")}
          value={keysLoading ? "\u2014" : String(activeKeys.length)}
          subtitle={t("user.dash.all-time")}
          icon={Key}
        />
        <StatCard
          title={t("user.dash.requests")}
          value={summaryLoading ? "\u2014" : formatUserTokens(summary?.totalRequests ?? 0)}
          subtitle={t("user.dash.all-time")}
          icon={Hash}
        />
        <StatCard
          title={t("user.dash.spend")}
          value={
            summaryLoading ? "\u2014" : `$${removeTailingZero(summary?.totalEstimatedCost ?? 0, 4)}`
          }
          subtitle={t("user.dash.all-time")}
          icon={DollarSign}
        />
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-muted-foreground">
              <Brain className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">{t("user.dash.recent-empty")}</p>
              <p className="text-xs mt-1">{t("user.dash.recent-empty-hint")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Interactive Bar Chart — 30 days */}
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <UserVolumeChart data={daily} />
          </Suspense>

          {/* Daily trend (7 days) */}
          {daily7.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("user.dash.daily-title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={dailyColumns}
                  data={daily7}
                  emptyText={t("ai-usage.recent.empty")}
                  tableClassName="min-w-[420px]"
                />
              </CardContent>
            </Card>
          )}

          {/* Recent Requests */}
          {recentRequests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("user.dash.recent-title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  columns={recentRequestColumns}
                  data={recentRequests}
                  emptyText={t("ai-usage.recent.empty")}
                  tableClassName="min-w-[560px]"
                />
              </CardContent>
            </Card>
          )}

          {/* View Full Report CTA */}
          <div className="flex justify-center">
            <Button variant="outline" size="sm" asChild>
              <LocaleLink to="/user/usage">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t("user.dash.view-full")}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </LocaleLink>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
