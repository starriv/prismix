import { formatDistanceToNow } from "date-fns";
import type { TFunction } from "i18next";

import { removeTailingZero } from "@/shared/number";
import type { AiUsageRecord } from "@/web/api/schemas";
import type { DataTableColumn } from "@/web/components/dashboard/data-table";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";
import { getDateLocale } from "@/web/shared/date-locale";

export function buildLogColumns(t: TFunction, language: string): DataTableColumn<AiUsageRecord>[] {
  return [
    {
      header: t("ai-logs.th.model"),
      width: "w-[22%]",
      cell: (r) => (
        <span className="font-mono text-xs truncate block max-w-[180px]">{r.modelId ?? "—"}</span>
      ),
    },
    {
      header: t("ai-logs.th.provider"),
      width: "w-[12%]",
      hiddenOnMobile: true,
      cell: (r) => <span className="text-xs">{r.providerId ?? "—"}</span>,
    },
    {
      header: t("ai-logs.th.upstream"),
      width: "w-[14%]",
      hiddenOnMobile: true,
      cell: (r) => (
        <span className="block max-w-[160px] truncate text-xs">
          {r.upstreamName ?? r.upstreamBaseUrl ?? "—"}
        </span>
      ),
    },
    {
      header: t("ai-logs.th.tokens"),
      width: "w-[10%]",
      hiddenOnMobile: true,
      cell: (r) => <span className="font-mono text-xs">{formatTokens(r.totalTokens)}</span>,
    },
    {
      header: t("ai-logs.th.cost"),
      width: "w-[12%]",
      cell: (r) => (
        <span className="font-mono text-xs">
          {r.estimatedCost ? `$${removeTailingZero(r.estimatedCost)}` : "—"}
        </span>
      ),
    },
    {
      header: t("ai-logs.th.latency"),
      width: "w-[8%]",
      hiddenOnMobile: true,
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.latencyMs != null ? `${r.latencyMs}ms` : "—"}
        </span>
      ),
    },
    {
      header: t("ai-logs.th.status"),
      width: "w-[10%]",
      cell: (r) => <StatusBadge code={r.statusCode} error={r.error} />,
    },
    {
      header: t("ai-logs.th.time"),
      width: "w-[14%]",
      cell: (r) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(r.createdAt), {
            addSuffix: true,
            locale: getDateLocale(language),
          })}
        </span>
      ),
    },
  ];
}
