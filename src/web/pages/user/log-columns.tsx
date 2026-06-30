import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import type { AiUsageRecord } from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { CacheTokenSummary, LatencySummary } from "@/web/pages/ai-logs/performance";
import { StatusBadge } from "@/web/pages/ai-usage/helpers";

import { UserCurrencyText } from "./table-helpers";

export function buildUserLogColumns(t: TFunction, language: string): ColumnDef<AiUsageRecord>[] {
  return [
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
        headerClassName: "w-[22%]",
        visibilityLabel: t("ai-logs.th.model"),
      },
    },
    {
      accessorKey: "endpointId",
      cell: ({ row }) => <DataTableText>{row.original.endpointId ?? "—"}</DataTableText>,
      header: t("ai-logs.th.endpoint"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.hiddenOnMobile,
        visibilityLabel: t("ai-logs.th.endpoint"),
      },
    },
    {
      accessorKey: "upstreamName",
      cell: ({ row }) => (
        <DataTableText className="max-w-[160px]" truncate>
          {row.original.upstreamName ?? row.original.upstreamBaseUrl ?? "—"}
        </DataTableText>
      ),
      header: t("ai-logs.th.upstream"),
      meta: {
        headerClassName: "w-[14%]",
        ...dataTableMeta.hiddenOnMobile,
        visibilityLabel: t("ai-logs.th.upstream"),
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <CacheTokenSummary log={row.original} />,
      header: t("ai-logs.th.tokens"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.hiddenOnMobile,
        visibilityLabel: t("ai-logs.th.tokens"),
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText value={row.original.estimatedCost} />,
      header: t("ai-logs.th.cost"),
      meta: {
        headerClassName: "w-[12%]",
        visibilityLabel: t("ai-logs.th.cost"),
      },
    },
    {
      accessorKey: "latencyMs",
      cell: ({ row }) => <LatencySummary log={row.original} t={t} />,
      header: t("ai-logs.th.latency"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.hiddenOnMobile,
        visibilityLabel: t("ai-logs.th.latency"),
      },
    },
    {
      accessorKey: "statusCode",
      cell: ({ row }) => <StatusBadge code={row.original.statusCode} error={row.original.error} />,
      enableHiding: false,
      header: t("ai-logs.th.status"),
      meta: {
        headerClassName: "w-[10%]",
        visibilityLabel: t("ai-logs.th.status"),
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
        headerClassName: "w-[14%]",
        visibilityLabel: t("ai-logs.th.time"),
      },
    },
  ];
}
