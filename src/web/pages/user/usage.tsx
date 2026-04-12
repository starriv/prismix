import { useTranslation } from "react-i18next";

import { AlertTriangle, BarChart3, Cpu, DollarSign, Zap } from "lucide-react";

import { formatPercent, removeTailingZero } from "@/shared/number";
import { useUserUsageDaily, useUserUsageSummary } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { DailyTrendChart, ModelDistributionChart } from "@/web/pages/ai-usage/charts";
import { formatTokens, StatCard } from "@/web/pages/ai-usage/helpers";

export default function UserUsagePage() {
  const { t } = useTranslation();
  const { data: summary, isLoading: summaryLoading } = useUserUsageSummary();
  const { data: daily = [], isLoading: dailyLoading } = useUserUsageDaily(30);

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
            value={formatTokens(summary?.totalInputTokens ?? 0)}
            loading={summaryLoading}
          />
          <StatCard
            icon={Cpu}
            label={t("ai-usage.stats.output-tokens")}
            value={formatTokens(summary?.totalOutputTokens ?? 0)}
            loading={summaryLoading}
          />
          <StatCard
            icon={BarChart3}
            label={t("ai-usage.stats.total-tokens")}
            value={formatTokens(summary?.totalTokens ?? 0)}
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
            value={formatPercent(summary?.errorRate ?? 0)}
            loading={summaryLoading}
          />
        </div>

        {/* Charts */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
          {/* Daily Usage Trend */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.chart.daily-title")}</CardTitle>
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

        {/* By Provider */}
        {summary && summary.byProvider.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.by-provider.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ai-usage.th.provider")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.requests")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.input")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.output")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.total")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.cost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byProvider.map((row) => (
                    <TableRow key={row.providerId}>
                      <TableCell className="text-sm font-medium">{row.providerId}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {row.requests}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.totalTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        ${removeTailingZero(row.estimatedCost, 4)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ai-usage.th.provider")}</TableHead>
                    <TableHead>{t("ai-usage.th.model")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.requests")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.input")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.output")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.total")}</TableHead>
                    <TableHead className="text-right">{t("ai-usage.th.cost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.byModel.map((row) => (
                    <TableRow key={`${row.providerId}-${row.modelId}`}>
                      <TableCell className="text-sm font-medium">{row.providerId}</TableCell>
                      <TableCell className="font-mono text-xs">{row.modelId}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {row.requests}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatTokens(row.totalTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        ${removeTailingZero(row.estimatedCost, 4)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
