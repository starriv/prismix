import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import type { AiUsageSummary } from "@/web/api/schemas";
import { dataTableMeta, DataTableText } from "@/web/components/data-table";

import { UserCountText, UserCurrencyText, UserTokenText } from "./table-helpers";

type AiUsageByEndpointRow = AiUsageSummary["byEndpoint"][number];
type AiUsageByModelRow = AiUsageSummary["byModel"][number];

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
