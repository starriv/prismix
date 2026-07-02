import type { TFunction } from "i18next";

import { formatPercent } from "@/shared/number";
import type { AiUsageRecord, AiUsageSummary } from "@/web/api/schemas";
import { DataTableText } from "@/web/components/data-table";

export function formatDurationMs(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${removeTrailingZero(value / 1000, 1)}s`;
  return `${removeTrailingZero(value / 60_000, 1)}m`;
}

export function formatBytes(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${removeTrailingZero(value / 1024, 1)}KB`;
  return `${removeTrailingZero(value / (1024 * 1024), 1)}MB`;
}

export function formatTokensPerSecond(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "-";
  if (value < 1) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return Math.round(value).toString();
}

export function formatGatewayCacheHitRate(
  summary: Pick<AiUsageSummary, "cacheEligibleRequests" | "cacheHitRate"> | null | undefined,
): string {
  return (summary?.cacheEligibleRequests ?? 0) > 0
    ? formatPercent(summary?.cacheHitRate ?? 0)
    : "—";
}

export function formatProviderPromptCacheReadRate(
  summary:
    | Pick<
        AiUsageSummary,
        "promptCacheCreationInputTokens" | "promptCacheReadInputTokens" | "promptCacheReadRate"
      >
    | null
    | undefined,
): string {
  const observedTokens =
    (summary?.promptCacheCreationInputTokens ?? 0) + (summary?.promptCacheReadInputTokens ?? 0);
  return observedTokens > 0 ? formatPercent(summary?.promptCacheReadRate ?? 0) : "—";
}

export function hasPerformanceMetrics(log: AiUsageRecord): boolean {
  return [
    log.cacheStatus,
    log.cacheLookupMs,
    log.queueWaitMs,
    log.upstreamTtfbMs,
    log.upstreamBodyMs,
    log.firstChunkMs,
    log.firstTokenMs,
    log.tokensPerSecond,
    log.requestBytes,
    log.responseBytes,
    log.streamChunks,
    log.streamBytes,
    log.retryCount,
    log.cacheCreationInputTokens,
    log.cacheReadInputTokens,
  ].some((value) => value != null && value !== 0);
}

export function LatencySummary({ log, t }: { log: AiUsageRecord; t: TFunction }) {
  return (
    <DataTableText className="block min-w-[110px] text-xs leading-5" muted numeric>
      <span className="block font-mono text-foreground">{formatDurationMs(log.latencyMs)}</span>
      <span className="block">
        {t("ai-logs.perf.ttfb-short")}: {formatDurationMs(log.upstreamTtfbMs)}
      </span>
      {log.firstChunkMs != null ? (
        <span className="block">
          {t("ai-logs.perf.first-chunk-short")}: {formatDurationMs(log.firstChunkMs)}
        </span>
      ) : null}
      {log.firstTokenMs != null ? (
        <span className="block">
          {t("ai-logs.perf.ttft-short")}: {formatDurationMs(log.firstTokenMs)}
        </span>
      ) : null}
      {log.tokensPerSecond != null ? (
        <span className="block">
          {t("ai-logs.perf.tps-short")}: {formatTokensPerSecond(log.tokensPerSecond)} tok/s
        </span>
      ) : null}
    </DataTableText>
  );
}

export function CacheTokenSummary({ log }: { log: AiUsageRecord }) {
  const read = log.cacheReadInputTokens ?? 0;
  const write = log.cacheCreationInputTokens ?? 0;
  if (read === 0 && write === 0) {
    return <DataTableText mono>{formatCompactNumber(log.totalTokens)}</DataTableText>;
  }
  return (
    <DataTableText className="block min-w-[96px] text-xs leading-5" numeric>
      <span className="block font-mono">{formatCompactNumber(log.totalTokens)}</span>
      <span className="block text-muted-foreground">R {formatCompactNumber(read)}</span>
      <span className="block text-muted-foreground">W {formatCompactNumber(write)}</span>
    </DataTableText>
  );
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function removeTrailingZero(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}
