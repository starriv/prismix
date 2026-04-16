import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import { removeTailingZero } from "@/shared/number";
import type { AiUsageRecord } from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";

export function buildLogColumns(t: TFunction, language: string): ColumnDef<AiUsageRecord>[] {
  return [
    {
      accessorKey: "requestId",
      cell: ({ row }) => (
        <DataTableText
          className="max-w-[180px]"
          mono
          truncate
          title={row.original.requestId ?? undefined}
        >
          {row.original.requestId ?? "—"}
        </DataTableText>
      ),
      enableHiding: false,
      header: t("ai-logs.th.request-id"),
      meta: {
        headerClassName: "w-[15%]",
      },
    },
    {
      accessorKey: "modelId",
      cell: ({ row }) => (
        <DataTableText className="max-w-[180px]" mono truncate>
          {row.original.modelId ?? "—"}
        </DataTableText>
      ),
      enableHiding: false,
      header: t("ai-logs.th.model"),
      meta: {
        headerClassName: "w-[15%]",
      },
    },
    {
      accessorKey: "providerId",
      cell: ({ row }) => <DataTableText>{row.original.providerId ?? "—"}</DataTableText>,
      header: t("ai-logs.th.provider"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.hiddenOnMobile,
      },
    },
    {
      accessorKey: "upstreamName",
      cell: ({ row }) => (
        <DataTableText className="max-w-[140px]" truncate>
          {row.original.upstreamName ?? row.original.upstreamBaseUrl ?? "—"}
        </DataTableText>
      ),
      header: t("ai-logs.th.upstream"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.hiddenOnMobile,
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => (
        <DataTableText mono>{formatTokens(row.original.totalTokens)}</DataTableText>
      ),
      header: t("ai-logs.th.tokens"),
      meta: {
        headerClassName: "w-[8%]",
        ...dataTableMeta.hiddenOnMobile,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => (
        <DataTableText mono>
          {row.original.estimatedCost ? `$${removeTailingZero(row.original.estimatedCost)}` : "—"}
        </DataTableText>
      ),
      header: t("ai-logs.th.cost"),
      meta: {
        headerClassName: "w-[8%]",
      },
    },
    {
      accessorKey: "latencyMs",
      cell: ({ row }) => (
        <DataTableText muted>
          {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "—"}
        </DataTableText>
      ),
      header: t("ai-logs.th.latency"),
      meta: {
        headerClassName: "w-[7%]",
        ...dataTableMeta.hiddenOnMobile,
      },
    },
    {
      accessorKey: "statusCode",
      cell: ({ row }) => <StatusBadge code={row.original.statusCode} error={row.original.error} />,
      enableHiding: false,
      header: t("ai-logs.th.status"),
      meta: {
        headerClassName: "w-[7%]",
      },
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      enableHiding: false,
      header: t("ai-logs.th.time"),
      meta: {
        headerClassName: "w-[10%]",
      },
    },
  ];
}
