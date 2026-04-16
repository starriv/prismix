import React, { useCallback, useState } from "react";
import JsonView from "react18-json-view";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  Cpu,
  DollarSign,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { formatPercent, removeTailingZero } from "@/shared/number";
import {
  useAiRequestLog,
  useAiUsageDailyByKey,
  useAiUsageRecentByKey,
  useAiUsageSummaryByKey,
  useRelayKeyOptions,
} from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { DataTable } from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { ScrollArea } from "@/web/components/ui/scroll-area";
import { Skeleton } from "@/web/components/ui/skeleton";
import { DailyTrendChart, ModelDistributionChart } from "@/web/pages/ai-usage/charts";
import { formatTokens, StatCard } from "@/web/pages/ai-usage/helpers";

import { buildAiUsageModelColumns, buildAiUsageRecentColumns } from "./ai-usage/columns";

const RECENT_COLLAPSED_LIMIT = 10;
const LIVE_REFETCH_MS = 5_000;

export default function AiUsageDetailPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const keyId = Number(searchParams.get("key"));

  const { data: relayKeys = [] } = useRelayKeyOptions();
  const keyInfo = relayKeys.find((k) => k.id === keyId);

  const { data: summary, isLoading: summaryLoading } = useAiUsageSummaryByKey(
    keyId,
    LIVE_REFETCH_MS,
  );
  const { data: recent = [], isLoading: recentLoading } = useAiUsageRecentByKey(
    keyId,
    LIVE_REFETCH_MS,
  );
  const { data: daily = [], isLoading: dailyLoading } = useAiUsageDailyByKey(keyId);

  const [recentExpanded, setRecentExpanded] = useState(false);
  const toggleRecent = useCallback(() => setRecentExpanded((v) => !v), []);
  const visibleRecent = recentExpanded ? recent : recent.slice(0, RECENT_COLLAPSED_LIMIT);
  const hasMore = recent.length > RECENT_COLLAPSED_LIMIT;
  const byModelColumns = React.useMemo(() => buildAiUsageModelColumns(t), [t]);
  const recentColumns = React.useMemo(
    () => buildAiUsageRecentColumns({ language: i18n.language, t }),
    [i18n.language, t],
  );

  const keyName = keyInfo?.name ?? `Key #${keyId}`;

  return (
    <div>
      <Header
        title={t("ai-usage.detail.title", { name: keyName })}
        description={keyInfo?.apiKeyPrefix}
      />

      <div className="p-4 md:p-8 space-y-6">
        {/* Back link */}
        <Button variant="ghost" size="sm" asChild>
          <LocaleLink to="/admin/ai-usage">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            {t("ai-usage.detail.back")}
          </LocaleLink>
        </Button>

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
          {/* Daily Trend Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.detail.daily-title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : daily.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">
                  {t("ai-usage.detail.daily-empty")}
                </p>
              ) : (
                <DailyTrendChart data={daily} height={260} />
              )}
            </CardContent>
          </Card>

          {/* Model Distribution Chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.chart.model-title")}</CardTitle>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : !summary || summary.byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-12">
                  {t("ai-usage.detail.daily-empty")}
                </p>
              ) : (
                <ModelDistributionChart summary={summary} height={260} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* By Model */}
        {summary && summary.byModel.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("ai-usage.by-model.title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={byModelColumns}
                data={summary.byModel}
                emptyText={t("ai-usage.detail.daily-empty")}
                getRowId={(row) => `${row.providerId}-${row.modelId}`}
                loading={false}
                showPagination={false}
                tableClassName="min-w-[860px]"
              />
            </CardContent>
          </Card>
        )}

        {/* Recent Requests */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">{t("ai-usage.recent.title")}</CardTitle>
                <span className="relative flex h-2 w-2" title={t("ai-logs.live")}>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
              </div>
              {!recentLoading && recent.length > 0 && (
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {recent.length}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {recentLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : recent.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {t("ai-usage.recent.empty")}
              </p>
            ) : (
              <>
                <ScrollArea className={recentExpanded ? "max-h-[600px]" : undefined}>
                  <DataTable
                    columns={recentColumns}
                    data={visibleRecent}
                    emptyText={t("ai-usage.recent.empty")}
                    getRowId={(row) => String(row.id)}
                    loading={false}
                    renderExpandedRow={(row) =>
                      row.requestId ? <RequestLogDetail requestId={row.requestId} /> : null
                    }
                    showPagination={false}
                    tableClassName="min-w-[900px]"
                  />
                </ScrollArea>
                {hasMore && (
                  <div className="flex justify-center pt-3 border-t mt-3">
                    <Button variant="ghost" size="sm" onClick={toggleRecent}>
                      <ChevronDown
                        className={
                          "h-3.5 w-3.5 mr-1 transition-transform " +
                          (recentExpanded ? "rotate-180" : "")
                        }
                      />
                      {recentExpanded
                        ? t("ai-usage.recent.collapse")
                        : t("ai-usage.recent.show-all", { count: recent.length })}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Request Log Detail (expanded row) ──────────────────────────────

function RequestLogDetail({ requestId }: { requestId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useAiRequestLog(requestId);

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="p-4 text-xs text-muted-foreground">{t("ai-usage.request-log.not-found")}</p>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <JsonBlock
        title={t("ai-usage.request-log.request")}
        raw={data.requestBody}
        maxH="max-h-[240px]"
      />
      <JsonBlock
        title={t("ai-usage.request-log.response")}
        raw={data.responseBody}
        maxH="max-h-[360px]"
      />
    </div>
  );
}

// ── JSON Block with tree viewer + copy ───────────────

function JsonBlock({
  title,
  raw,
  maxH = "max-h-64",
}: {
  title: string;
  raw: string;
  maxH?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  const formatted = parsed ? JSON.stringify(parsed, null, 2) : raw;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(formatted);
    setCopied(true);
    toast.success(t("common.copied"));
    setTimeout(() => setCopied(false), 2000);
  }, [formatted, t]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">{title}</p>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCopy}>
          {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
        </Button>
      </div>
      <div
        className={`${maxH} overflow-auto rounded-lg bg-muted p-3 text-xs [&_.json-view]:!bg-transparent`}
      >
        {parsed ? (
          <JsonView
            src={parsed}
            collapsed={2}
            theme="default"
            collapseStringsAfterLength={80}
            enableClipboard={false}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono">{raw}</pre>
        )}
      </div>
    </div>
  );
}
