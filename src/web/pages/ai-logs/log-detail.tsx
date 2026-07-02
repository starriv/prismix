import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { TFunction } from "i18next";
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
            {buildPerformanceDetailRows(log, t).map((row) => (
              <PerformanceRow key={row.key} label={row.label} value={row.value} />
            ))}
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

interface PerformanceDetailRow {
  key: string;
  label: string;
  value: string;
}

export function buildPerformanceDetailRows(
  log: AiUsageRecord,
  t: TFunction,
): PerformanceDetailRow[] {
  const rows: PerformanceDetailRow[] = [];
  const isStream = log.isStream === true;
  const hasCacheLookup =
    log.cacheLookupMs != null || log.cacheStatus === "hit" || log.cacheStatus === "miss";

  const addText = (key: string, labelKey: string, value: string | null | undefined) => {
    if (value) rows.push({ key, label: t(labelKey), value });
  };
  const addDuration = (
    key: string,
    labelKey: string,
    value: number | null | undefined,
    include = value != null,
  ) => {
    if (include && value != null) {
      rows.push({ key, label: t(labelKey), value: formatDurationMs(value) });
    }
  };
  const addBytes = (
    key: string,
    labelKey: string,
    value: number | null | undefined,
    include = value != null,
  ) => {
    if (include && value != null) {
      rows.push({ key, label: t(labelKey), value: formatBytes(value) });
    }
  };
  const addCount = (
    key: string,
    labelKey: string,
    value: number | null | undefined,
    include = value != null,
  ) => {
    if (include && value != null) rows.push({ key, label: t(labelKey), value: String(value) });
  };

  addText("route-type", "ai-logs.detail.route-type", log.routeType);
  addText(
    "stream",
    "ai-logs.detail.stream",
    log.isStream == null ? null : log.isStream ? t("ai-logs.detail.yes") : t("ai-logs.detail.no"),
  );
  addText(
    "cache-status",
    "ai-logs.detail.cache-status",
    log.cacheStatus ? t(`ai-logs.cache.${log.cacheStatus}`) : null,
  );

  addDuration("cache-lookup", "ai-logs.detail.cache-lookup", log.cacheLookupMs, hasCacheLookup);
  addDuration("cache-write", "ai-logs.detail.cache-write", log.cacheWriteMs);
  addDuration("routing", "ai-logs.detail.routing", log.routingMs);
  addDuration("queue-wait", "ai-logs.detail.queue-wait", log.queueWaitMs);
  addDuration("upstream-ttfb", "ai-logs.detail.upstream-ttfb", log.upstreamTtfbMs);
  addDuration("upstream-body", "ai-logs.detail.upstream-body", log.upstreamBodyMs, !isStream);
  addDuration("transform", "ai-logs.detail.transform", log.transformMs);
  addDuration("billing", "ai-logs.detail.billing", log.billingMs);
  addDuration("first-chunk", "ai-logs.detail.first-chunk", log.firstChunkMs, isStream);

  if (log.attemptCount != null) {
    rows.push({
      key: "attempts",
      label: t("ai-logs.detail.attempts"),
      value: `${log.attemptCount} / ${t("ai-logs.detail.retries")}: ${log.retryCount ?? 0}`,
    });
  }

  addBytes("request-bytes", "ai-logs.detail.request-bytes", log.requestBytes);
  addBytes("response-bytes", "ai-logs.detail.response-bytes", log.responseBytes, !isStream);

  addCount("stream-chunks", "ai-logs.detail.stream-chunks", log.streamChunks, isStream);
  addBytes("stream-bytes", "ai-logs.detail.stream-bytes", log.streamBytes, isStream);
  addCount(
    "stream-pings",
    "ai-logs.detail.stream-pings",
    log.streamPingCount,
    isStream && (log.streamPingCount ?? 0) > 0,
  );
  addText("abort-reason", "ai-logs.detail.abort-reason", isStream ? log.streamAbortReason : null);

  if ((log.cacheReadInputTokens ?? 0) > 0) {
    rows.push({
      key: "cache-read-tokens",
      label: t("ai-logs.detail.cache-read-tokens"),
      value: formatTokens(log.cacheReadInputTokens ?? 0),
    });
  }
  if ((log.cacheCreationInputTokens ?? 0) > 0) {
    rows.push({
      key: "cache-write-tokens",
      label: t("ai-logs.detail.cache-write-tokens"),
      value: formatTokens(log.cacheCreationInputTokens ?? 0),
    });
  }

  return rows;
}

function PerformanceRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <DetailRow label={label}>
      <span className="font-mono text-xs">{value && value !== "-" ? value : "—"}</span>
    </DetailRow>
  );
}
