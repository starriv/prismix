import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, BarChart3, Cpu, DollarSign, Zap } from "lucide-react";

import { formatPercent, removeTailingZero } from "@/shared/number";
import { useUserLiveTrend, useUserUsageDaily, useUserUsageSummary } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { DataTable } from "@/web/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { DailyTrendChart, ModelDistributionChart } from "@/web/pages/ai-usage/charts";
import { StatCard } from "@/web/pages/ai-usage/helpers";

import { formatUserTokens } from "./table-helpers";
import {
  buildUserUsageDailyColumns,
  buildUserUsageEndpointColumns,
  buildUserUsageModelColumns,
} from "./usage-columns";

const LiveTrendChart = lazy(() => import("@/web/pages/dashboard/live-trend-chart"));

const USAGE_DAY_OPTIONS = [7, 30, 90] as const;

export default function UserUsagePage() {
  const { t } = useTranslation();
  const [usageDays, setUsageDays] = useState<number>(7);
  const { data: summary, isLoading: summaryLoading } = useUserUsageSummary();
  const { data: daily = [], isLoading: dailyLoading } = useUserUsageDaily(usageDays);
  const {
    data: liveTrend = [],
    isLoading: trendLoading,
    isError: trendError,
  } = useUserLiveTrend(60);
  const dailyColumns = useMemo(() => buildUserUsageDailyColumns(t), [t]);
  const endpointColumns = useMemo(() => buildUserUsageEndpointColumns(t), [t]);
  const modelColumns = useMemo(() => buildUserUsageModelColumns(t), [t]);

  const dailyDesc = useMemo(() => [...daily].reverse(), [daily]);

  return (
    <div>
      <Header title={t("ai-usage.title")} description={t("ai-usage.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            icon={Zap}
            label={t("ai-usage.stats.requests")}
            value={summary?.totalRequests ?? 0}
            loading={summaryLoading}
          />
          <StatCard
            icon={Cpu}
            label={t("ai-usage.stats.input-tokens")}
            value={formatUserTokens(summary?.totalInputTokens ?? 0)}
            loading={summaryLoading}
          />
          <StatCard
            icon={Cpu}
            label={t("ai-usage.stats.output-tokens")}
            value={formatUserTokens(summary?.totalOutputTokens ?? 0)}
            loading={summaryLoading}
          />
          <StatCard
            icon={BarChart3}
            label={t("ai-usage.stats.total-tokens")}
            value={formatUserTokens(summary?.totalTokens ?? 0)}
            loading={summaryLoading}
          />
          <StatCard
            icon={DollarSign}
            label={t("ai-usage.stats.est-cost")}
            value={`$${removeTailingZero(summary?.totalEstimatedCost ?? 0, 4)}`}
            loading={summaryLoading}
          />
          <StatCard
            icon={AlertTriangle}
            label={t("ai-usage.stats.error-rate")}
            value={formatPercent(summary?.errorRate)}
            loading={summaryLoading}
          />
        </div>

        {/* Charts */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {/* Daily Usage Trend */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {t("ai-usage.chart.daily-title-days", { days: usageDays })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dailyLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : daily.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">
                  {t("ai-usage.recent.empty")}
                </p>
              ) : (
                <DailyTrendChart data={daily} height={220} />
              )}
            </CardContent>
          </Card>

          {/* Model Token Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.chart.model-title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : !summary || summary.byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">
                  {t("ai-usage.recent.empty")}
                </p>
              ) : (
                <ModelDistributionChart summary={summary} height={220} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live Throughput Trend */}
        <Suspense fallback={<Skeleton className="h-[340px] w-full" />}>
          <LiveTrendChart data={liveTrend} loading={trendLoading} error={trendError} />
        </Suspense>

        {/* Daily Breakdown */}
        <Card>
          <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm">{t("ai-usage.daily.title")}</CardTitle>
            <Select
              value={String(usageDays)}
              onValueChange={(value) => setUsageDays(Number(value))}
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USAGE_DAY_OPTIONS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {t("ai-usage.daily.last-days", { days })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={dailyColumns}
              data={dailyDesc}
              emptyText={t("ai-usage.detail.daily-empty")}
              getRowId={(row) => row.date}
              loading={dailyLoading}
              showPagination={false}
              tableClassName="min-w-[980px]"
            />
          </CardContent>
        </Card>

        {/* By Endpoint */}
        {summary && summary.byEndpoint.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.by-endpoint.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={endpointColumns}
                data={summary.byEndpoint}
                emptyText={t("ai-usage.recent.empty")}
                tableClassName="min-w-[720px]"
              />
            </CardContent>
          </Card>
        )}

        {/* By Model */}
        {summary && summary.byModel.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.by-model.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={modelColumns}
                data={summary.byModel}
                emptyText={t("ai-usage.recent.empty")}
                tableClassName="min-w-[860px]"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
