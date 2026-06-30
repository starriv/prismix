import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowDownToLine, ArrowRight, FileText, Gauge, Info } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import type { AiUsageRecord } from "@/web/api/schemas";
import { DetailRow } from "@/web/components/dashboard/detail-row";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent } from "@/web/components/ui/card";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";

import { DetailCard, formatRaw, JsonBlock, safeParseJson } from "./log-detail-helpers";
import { formatBytes, formatDurationMs, hasPerformanceMetrics } from "./performance";

// ── Types ───────────────────────────────────────────────────────────

interface LogDetailProps {
  log: AiUsageRecord;
  /** Resolved consumer key name (admin only). */
  keyName?: string;
  /** Request/response body data from the request-log endpoint. */
  requestLog?: { requestBody?: string; responseBody?: string } | null;
  /** Whether the request-log query is still loading. */
  bodyLoading: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function LogDetail({ log, keyName, requestLog, bodyLoading }: LogDetailProps) {
  const { t } = useTranslation();

  const costDisplay = useMemo(() => {
    if (!log.estimatedCost) return null;
    const hasMarkup = log.upstreamCost && log.markupPercent;
    const markupLabel = log.markupPercent
      ? new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(
          log.markupPercent / 100,
        )
      : null;
    return {
      upstream: log.upstreamCost ? `$${removeTailingZero(log.upstreamCost)}` : null,
      final: `$${removeTailingZero(log.estimatedCost)}`,
      markupLabel: hasMarkup ? `+${markupLabel}` : null,
    };
  }, [log.estimatedCost, log.upstreamCost, log.markupPercent]);

  return (
    <div className="space-y-2">
      {/* Overview */}
      <DetailCard title={t("ai-logs.detail.overview")} icon={Info} defaultOpen>
        <div className="space-y-3">
          {log.requestId && (
            <DetailRow label={t("ai-logs.detail.request-id")}>
              <span className="font-mono text-xs">{log.requestId}</span>
            </DetailRow>
          )}
          <DetailRow label={t("ai-logs.detail.model")}>
            <span className="font-mono text-xs">{log.modelId ?? "—"}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.endpoint")}>
            <span className="text-xs">{log.endpointId ?? "—"}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.upstream")}>
            <span className="text-xs">{log.upstreamName ?? "—"}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.upstream-url")}>
            <span className="font-mono text-xs break-all">{log.upstreamBaseUrl ?? "—"}</span>
          </DetailRow>
          {keyName && (
            <DetailRow label={t("ai-logs.detail.consumer-key")}>
              <span className="text-xs">{keyName}</span>
            </DetailRow>
          )}
          <DetailRow label={t("ai-logs.detail.input-tokens")}>
            <span className="font-mono text-xs">{formatTokens(log.inputTokens)}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.output-tokens")}>
            <span className="font-mono text-xs">{formatTokens(log.outputTokens)}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.total-tokens")}>
            <span className="font-mono text-xs">{formatTokens(log.totalTokens)}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.cost")}>
            {costDisplay ? (
              <span className="flex items-center gap-1.5 font-mono text-xs">
                {costDisplay.upstream && costDisplay.markupLabel ? (
                  <>
                    <span>{costDisplay.upstream}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{costDisplay.final}</span>
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
                      {costDisplay.markupLabel}
                    </Badge>
                  </>
                ) : (
                  <span>{costDisplay.final}</span>
                )}
              </span>
            ) : (
              <span className="text-xs">—</span>
            )}
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.latency")}>
            <span className="text-xs">{formatDurationMs(log.latencyMs)}</span>
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.status")}>
            <StatusBadge code={log.statusCode} error={log.error} />
          </DetailRow>
          <DetailRow label={t("ai-logs.detail.time")}>
            <span className="text-xs">{new Date(log.createdAt).toLocaleString()}</span>
          </DetailRow>
        </div>
      </DetailCard>

      {hasPerformanceMetrics(log) && (
        <DetailCard title={t("ai-logs.detail.performance")} icon={Gauge} defaultOpen>
          <div className="space-y-3">
            <PerformanceRow label={t("ai-logs.detail.route-type")} value={log.routeType} />
            <PerformanceRow
              label={t("ai-logs.detail.stream")}
              value={
                log.isStream == null
                  ? null
                  : log.isStream
                    ? t("ai-logs.detail.yes")
                    : t("ai-logs.detail.no")
              }
            />
            <PerformanceRow
              label={t("ai-logs.detail.cache-status")}
              value={log.cacheStatus ? t(`ai-logs.cache.${log.cacheStatus}`) : null}
            />
            <PerformanceRow
              label={t("ai-logs.detail.cache-lookup")}
              value={formatDurationMs(log.cacheLookupMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.cache-write")}
              value={formatDurationMs(log.cacheWriteMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.routing")}
              value={formatDurationMs(log.routingMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.queue-wait")}
              value={formatDurationMs(log.queueWaitMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.upstream-ttfb")}
              value={formatDurationMs(log.upstreamTtfbMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.upstream-body")}
              value={formatDurationMs(log.upstreamBodyMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.transform")}
              value={formatDurationMs(log.transformMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.billing")}
              value={formatDurationMs(log.billingMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.first-chunk")}
              value={formatDurationMs(log.firstChunkMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.first-token")}
              value={formatDurationMs(log.firstTokenMs)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.attempts")}
              value={
                log.attemptCount == null
                  ? null
                  : `${log.attemptCount} / ${t("ai-logs.detail.retries")}: ${log.retryCount ?? 0}`
              }
            />
            <PerformanceRow
              label={t("ai-logs.detail.request-bytes")}
              value={formatBytes(log.requestBytes)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.response-bytes")}
              value={formatBytes(log.responseBytes)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.stream-chunks")}
              value={log.streamChunks == null ? null : String(log.streamChunks)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.stream-bytes")}
              value={formatBytes(log.streamBytes)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.stream-pings")}
              value={log.streamPingCount == null ? null : String(log.streamPingCount)}
            />
            <PerformanceRow
              label={t("ai-logs.detail.abort-reason")}
              value={log.streamAbortReason}
            />
            <PerformanceRow
              label={t("ai-logs.detail.cache-read-tokens")}
              value={
                log.cacheReadInputTokens == null ? null : formatTokens(log.cacheReadInputTokens)
              }
            />
            <PerformanceRow
              label={t("ai-logs.detail.cache-write-tokens")}
              value={
                log.cacheCreationInputTokens == null
                  ? null
                  : formatTokens(log.cacheCreationInputTokens)
              }
            />
          </div>
        </DetailCard>
      )}

      {/* Error */}
      {log.error && (
        <DetailCard
          title={t("ai-logs.detail.error")}
          icon={AlertTriangle}
          variant="destructive"
          copyText={log.error}
          defaultOpen
        >
          <pre className="text-xs overflow-auto whitespace-pre-wrap break-all text-destructive">
            {log.error}
          </pre>
        </DetailCard>
      )}

      {/* Request Body */}
      {requestLog ? (
        <>
          {requestLog.requestBody && (
            <DetailCard
              title={t("ai-logs.detail.req-body")}
              icon={FileText}
              copyText={formatRaw(requestLog.requestBody)}
            >
              <JsonBlock
                data={safeParseJson(requestLog.requestBody)}
                raw={requestLog.requestBody}
              />
            </DetailCard>
          )}
          {requestLog.responseBody && (
            <DetailCard
              title={t("ai-logs.detail.res-body")}
              icon={ArrowDownToLine}
              copyText={formatRaw(requestLog.responseBody)}
            >
              <JsonBlock
                data={safeParseJson(requestLog.responseBody)}
                raw={requestLog.responseBody}
              />
            </DetailCard>
          )}
        </>
      ) : log.requestId && !bodyLoading ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground text-center">
              {t("ai-logs.detail.no-body")}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PerformanceRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <DetailRow label={label}>
      <span className="font-mono text-xs">{value && value !== "-" ? value : "—"}</span>
    </DetailRow>
  );
}
