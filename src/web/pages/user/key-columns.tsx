import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { Copy } from "lucide-react";

import type { UserKey } from "@/web/api/schemas";
import type { StatusBadgeColorMap } from "@/web/components/dashboard/status-badge";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";

import { UserKeyStatusBadge } from "./table-helpers";

export function buildUserKeyColumns({
  handleCopy,
  isCopyPending,
  keyStatusColorMap,
  language,
  t,
}: {
  handleCopy: (id: number) => void;
  isCopyPending: boolean;
  keyStatusColorMap: StatusBadgeColorMap;
  language: string;
  t: TFunction;
}): ColumnDef<UserKey>[] {
  return [
    {
      accessorKey: "name",
      cell: ({ row }) => <DataTableText className="font-medium">{row.original.name}</DataTableText>,
      header: t("user.keys.th.name"),
    },
    {
      accessorKey: "apiKeyPrefix",
      cell: ({ row }) => <DataTableText mono>{row.original.apiKeyPrefix}...</DataTableText>,
      header: t("user.keys.th.prefix"),
    },
    {
      accessorKey: "status",
      cell: ({ row }) => (
        <UserKeyStatusBadge status={row.original.status} colorMap={keyStatusColorMap} />
      ),
      header: t("user.keys.th.status"),
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("user.keys.th.created"),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => handleCopy(row.original.id)}
            disabled={isCopyPending}
            aria-label={t("common.a11y.copy")}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
      enableHiding: false,
      header: "",
      meta: {
        headerClassName: "w-[52px]",
        ...dataTableMeta.right,
      },
    },
  ];
}
