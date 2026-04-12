import { lazy, Suspense, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { orderBy } from "lodash-es";
import { ArrowRight, Brain, DollarSign, Hash, PercentCircle, Sparkles, Zap } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { useAiUsageDaily, useAiUsageRecent, useAiUsageSummary } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
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
import { DailyTrendChart } from "@/web/pages/ai-usage/charts";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";
import { getDateLocale } from "@/web/shared/date-locale";

const RequestVolumeChart = lazy(() => import("@/web/pages/dashboard/volume-chart"));

export default function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Header title={t("dash.title")} description={t("dash.desc")} />

      <div className="p-4 md:p-8 space-y-6 md:space-y-8">
        <AiGatewayDashboard />
      </div>
    </div>
  );
}

// ── AI Gateway Dashboard ────────────────────────────

function AiGatewayDashboard() {
  const { t, i18n } = useTranslation();
  const { data: summary, isLoading } = useAiUsageSummary();
  const { data: daily = [] } = useAiUsageDaily(30);
  const { data: recent = [] } = useAiUsageRecent();

  const daily7 = useMemo(() => daily.slice(-7), [daily]);
  const recentRequests = recent.slice(0, 5);

  const topModels = useMemo(() => {
    if (!summary?.byModel?.length) return [];
    return orderBy(summary.byModel, "totalTokens", "desc").slice(0, 3);
  }, [summary?.byModel]);

  const maxTokens = topModels[0]?.totalTokens || 1;

  const isEmpty = !isLoading && (!summary || summary.totalRequests === 0);

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dash.ai.requests")}
          value={summary ? formatTokens(summary.totalRequests) : "0"}
          subtitle={t("dash.ai.all-time")}
          icon={Hash}
        />
        <StatCard
          title={t("dash.ai.tokens")}
          value={summary ? formatTokens(summary.totalTokens) : "0"}
          subtitle={t("dash.ai.all-time")}
          icon={Zap}
        />
        <StatCard
          title={t("dash.ai.cost")}
          value={summary ? `$${removeTailingZero(summary.totalEstimatedCost, 4)}` : "$0"}
          subtitle={t("dash.ai.all-time")}
          icon={DollarSign}
        />
        <StatCard
          title={t("dash.ai.error-rate")}
          value={summary ? `${removeTailingZero(summary.errorRate * 100, 1)}%` : "0%"}
          subtitle={t("dash.ai.all-time")}
          icon={PercentCircle}
        />
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-muted-foreground">
              <Brain className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">{t("dash.ai.recent-empty")}</p>
              <p className="text-xs mt-1">{t("dash.ai.recent-empty-hint")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Interactive Bar Chart — 30 days requests / tokens */}
          <Suspense fallback={<Skeleton className="h-[300px] w-full" />}>
            <RequestVolumeChart data={daily} />
          </Suspense>

          {/* Daily Trend (7 days) + Top Models side by side */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("dash.ai.daily-title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <DailyTrendChart data={daily7} height={200} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t("dash.ai.top-models")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topModels.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">-</p>
                ) : (
                  topModels.map((model, idx) => (
                    <div key={model.modelId} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-xs font-mono tabular-nums w-5 justify-center"
                          >
                            {idx + 1}
                          </Badge>
                          <span className="text-sm font-medium truncate max-w-[200px]">
                            {model.modelId}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatTokens(model.totalTokens)} tokens
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${(model.totalTokens / maxTokens) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent AI Requests */}
          <Card>
            <CardHeader>
              <CardTitle>{t("dash.ai.recent-title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ai-usage.th.model")}</TableHead>
                    <TableHead>{t("ai-usage.th.tokens")}</TableHead>
                    <TableHead>{t("ai-usage.th.status")}</TableHead>
                    <TableHead>{t("ai-usage.th.time")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-mono text-xs">{req.modelId ?? "-"}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {formatTokens(req.totalTokens)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge code={req.statusCode} error={req.error} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(req.createdAt), {
                          addSuffix: true,
                          locale: getDateLocale(i18n.language),
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* View Full Report CTA */}
          <div className="flex justify-center">
            <Button variant="outline" size="sm" asChild>
              <LocaleLink to="/admin/ai-usage">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                {t("dash.ai.view-full")}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </LocaleLink>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
