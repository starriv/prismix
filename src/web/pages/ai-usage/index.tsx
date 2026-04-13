import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { keyBy } from "lodash-es";
import { AlertTriangle, ArrowRight, BarChart3, Cpu, DollarSign, Zap } from "lucide-react";

import { formatPercent, removeTailingZero } from "@/shared/number";
import { useAiUsageByKey, useAiUsageDaily, useAiUsageSummary, useRelayKeys } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
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
import { formatTokens, StatCard } from "@/web/pages/ai-usage/helpers";

const AiUsageDetailPage = lazy(() => import("@/web/pages/ai-usage-detail"));
const AiUsageUserDetailPage = lazy(() => import("@/web/pages/ai-usage-user-detail"));

const DailyTrendChart = lazy(() =>
  import("@/web/pages/ai-usage/charts").then((m) => ({ default: m.DailyTrendChart })),
);
const ModelDistributionChart = lazy(() =>
  import("@/web/pages/ai-usage/charts").then((m) => ({ default: m.ModelDistributionChart })),
);

const LIVE_REFETCH_MS = 5_000;

export default function AiUsagePage() {
  const [searchParams] = useSearchParams();
  const keyParam = searchParams.get("key");
  const userParam = searchParams.get("user");

  if (keyParam) {
    return (
      <Suspense fallback={null}>
        <AiUsageDetailPage />
      </Suspense>
    );
  }

  if (userParam) {
    return (
      <Suspense fallback={null}>
        <AiUsageUserDetailPage />
      </Suspense>
    );
  }

  return <AiUsageList />;
}

// ── List View ──────────────────────────────────────────────────────

function AiUsageList() {
  const { t } = useTranslation();
  const { data: summary, isLoading: summaryLoading } = useAiUsageSummary(LIVE_REFETCH_MS);
  const { data: daily = [], isLoading: dailyLoading } = useAiUsageDaily(30, LIVE_REFETCH_MS);
  const { data: byKeyData = [], isLoading: byKeyLoading } = useAiUsageByKey();
  const { data: relayKeys = [] } = useRelayKeys();

  // Build lookup map: consumerKeyId -> key info
  const keyMap = useMemo(() => keyBy(relayKeys, "id"), [relayKeys]);

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
                <Suspense fallback={<Skeleton className="h-[220px] w-full" />}>
                  <DailyTrendChart data={daily} height={220} />
                </Suspense>
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
                <Suspense fallback={<Skeleton className="h-[220px] w-full" />}>
                  <ModelDistributionChart summary={summary} height={220} />
                </Suspense>
              )}
            </CardContent>
          </Card>
        </div>

        {/* By Consumer Key */}
        {byKeyLoading ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.by-key.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            </CardContent>
          </Card>
        ) : (
          byKeyData.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("ai-usage.by-key.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("ai-usage.th.key-name")}</TableHead>
                      <TableHead className="text-right">{t("ai-usage.th.requests")}</TableHead>
                      <TableHead className="text-right">{t("ai-usage.th.input")}</TableHead>
                      <TableHead className="text-right">{t("ai-usage.th.output")}</TableHead>
                      <TableHead className="text-right">{t("ai-usage.th.total")}</TableHead>
                      <TableHead className="text-right">{t("ai-usage.th.cost")}</TableHead>
                      <TableHead className="w-[48px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byKeyData.map((row) => {
                      const keyInfo = keyMap[row.consumerKeyId];
                      return (
                        <TableRow key={row.consumerKeyId}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {keyInfo?.name ?? `Key #${row.consumerKeyId}`}
                              {keyInfo && (
                                <Badge variant="outline" className="font-mono text-xs">
                                  {keyInfo.apiKeyPrefix}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
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
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                              <LocaleLink to={`/admin/ai-usage?key=${row.consumerKeyId}`}>
                                <ArrowRight className="h-3.5 w-3.5" />
                              </LocaleLink>
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        )}

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

        {/* Recent requests moved to /ai-logs -- dedicated log page with pagination + filters */}
      </div>
    </div>
  );
}
