import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import type { AiDailyUsage, AiUsageRecord } from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { StatusBadge } from "@/web/pages/ai-usage/helpers";

import { UserCountText, UserCurrencyText, UserTokenText } from "./table-helpers";

export function buildUserDashboardDailyColumns(t: TFunction): ColumnDef<AiDailyUsage>[] {
  return [
    {
      accessorKey: "date",
      cell: ({ row }) => <DataTableText nowrap>{row.original.date.slice(0, 10)}</DataTableText>,
      header: t("user.usage.th.date"),
    },
    {
      accessorKey: "requests",
      cell: ({ row }) => <UserCountText value={row.original.requests} />,
      header: t("user.usage.th.requests"),
      meta: dataTableMeta.right,
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <UserCountText value={Number(row.original.totalTokens)} />,
      header: t("user.usage.th.tokens"),
      meta: dataTableMeta.right,
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText value={row.original.estimatedCost} />,
      header: t("user.usage.th.spend"),
      meta: dataTableMeta.right,
    },
  ];
}

export function buildUserDashboardRecentRequestColumns({
  language,
  t,
}: {
  language: string;
  t: TFunction;
}): ColumnDef<AiUsageRecord>[] {
  return [
    {
      accessorKey: "modelId",
      cell: ({ row }) => <DataTableText mono>{row.original.modelId ?? "—"}</DataTableText>,
      header: t("user.logs.th.model"),
      meta: {
        headerClassName: "w-[38%]",
      },
    },
    {
      accessorKey: "totalTokens",
      cell: ({ row }) => <UserTokenText value={row.original.totalTokens} />,
      header: t("user.logs.th.tokens"),
      meta: {
        headerClassName: "w-[16%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "estimatedCost",
      cell: ({ row }) => <UserCurrencyText value={row.original.estimatedCost} />,
      header: t("user.logs.th.cost"),
      meta: {
        headerClassName: "w-[16%]",
        ...dataTableMeta.right,
      },
    },
    {
      accessorKey: "statusCode",
      cell: ({ row }) => <StatusBadge code={row.original.statusCode} error={null} />,
      header: t("user.logs.th.status"),
      meta: {
        headerClassName: "w-[12%]",
      },
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("user.logs.th.time"),
      meta: {
        headerClassName: "w-[18%]",
        ...dataTableMeta.right,
      },
    },
  ];
}
