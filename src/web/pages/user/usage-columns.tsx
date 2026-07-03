import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import { formatPercent } from "@/shared/number";
import type { AiDailyUsage, AiUsageSummary } from "@/web/api/schemas";
import { dataTableMeta, DataTableText } from "@/web/components/data-table";

import { UserCountText, UserCurrencyText, UserTokenText } from "./table-helpers";

type AiUsageByEndpointRow = AiUsageSummary["byEndpoint"][number];
type AiUsageByModelRow = AiUsageSummary["byModel"][number];

export function buildUserUsageDailyColumns(t: TFunction): ColumnDef<AiDailyUsage>[] {
  return [
    {
      accessorKey: "date",
      cell: ({ row }) => <DataTableText nowrap>{row.original.date.slice(0, 10)}</DataTableText>,
      header: t("ai-usage.th.date"),
      meta: {
        headerClassName: "w-[12%]",
      },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => <UserCountText value={row.original.requests} />,
      header: t("ai-usage.th.requests"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.inputTokens} />,
      header: t("ai-usage.th.input"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.outputTokens} />,
      header: t("ai-usage.th.output"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
    {
      accessorKey: "reasoningTokens",
      cell: ({ row }) => <UserTokenText value={row.original.reasoningTokens} />,
      header: t("ai-usage.th.reasoning"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
    {
      accessorKey: "cacheReadInputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.cacheReadInputTokens} />,
      header: t("ai-usage.th.cache-read"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
    {
      accessorKey: "cacheCreationInputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.cacheCreationInputTokens} />,
      header: t("ai-usage.th.cache-write"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <UserTokenText value={row.original.totalTokens} />,
      header: t("ai-usage.th.total"),
      meta: {
        headerClassName: "w-[11%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText digits={4} value={row.original.estimatedCost} />,
      header: t("ai-usage.th.cost"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "errorRate",
      cell: ({ row }) => (
        <DataTableText mono numeric>
          {formatPercent(row.original.errorRate)}
        </DataTableText>
      ),
      header: t("ai-usage.th.error-rate"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.rightHiddenOnMobile,
      },
    },
  ];
}

export function buildUserUsageEndpointColumns(t: TFunction): ColumnDef<AiUsageByEndpointRow>[] {
  return [
    {
      accessorKey: "endpointId",
      cell: ({ row }) => (
        <DataTableText className="font-medium">{row.original.endpointId}</DataTableText>
      ),
      header: t("ai-usage.th.endpoint"),
      meta: {
        headerClassName: "w-[24%]",
      },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => <UserCountText value={row.original.requests} />,
      header: t("ai-usage.th.requests"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.inputTokens} />,
      header: t("ai-usage.th.input"),
      meta: {
        headerClassName: "w-[14%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.outputTokens} />,
      header: t("ai-usage.th.output"),
      meta: {
        headerClassName: "w-[14%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <UserTokenText value={row.original.totalTokens} />,
      header: t("ai-usage.th.total"),
      meta: {
        headerClassName: "w-[16%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText digits={4} value={row.original.estimatedCost} />,
      header: t("ai-usage.th.cost"),
      meta: {
        headerClassName: "w-[20%]",
        ...dataTableMeta.right,
      },
    },
  ];
}

export function buildUserUsageModelColumns(t: TFunction): ColumnDef<AiUsageByModelRow>[] {
  return [
    {
      accessorKey: "endpointId",
      cell: ({ row }) => (
        <DataTableText className="font-medium">{row.original.endpointId}</DataTableText>
      ),
      header: t("ai-usage.th.endpoint"),
      meta: {
        headerClassName: "w-[16%]",
      },
    },
    {
      accessorKey: "modelId",
      cell: ({ row }) => <DataTableText mono>{row.original.modelId}</DataTableText>,
      header: t("ai-usage.th.model"),
      meta: {
        headerClassName: "w-[24%]",
      },
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => <UserCountText value={row.original.requests} />,
      header: t("ai-usage.th.requests"),
      meta: {
        headerClassName: "w-[10%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "inputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.inputTokens} />,
      header: t("ai-usage.th.input"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "outputTokens",
      cell: ({ row }) => <UserTokenText value={row.original.outputTokens} />,
      header: t("ai-usage.th.output"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <UserTokenText value={row.original.totalTokens} />,
      header: t("ai-usage.th.total"),
      meta: {
        headerClassName: "w-[12%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText digits={4} value={row.original.estimatedCost} />,
      header: t("ai-usage.th.cost"),
      meta: {
        headerClassName: "w-[14%]",
        ...dataTableMeta.right,
      },
    },
  ];
}
