import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";
import { ChevronRight } from "lucide-react";

import type { UserWalletTopupOrder } from "@/web/api/schemas";
import type { StatusBadgeColorMap } from "@/web/components/dashboard/status-badge";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import {
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import type { ChainDisplay } from "@/web/shared/chains";

import { formatWalletTopupOrderAmount, WalletNetworkBadge } from "./table-helpers";

type GetChainDisplayByNetworkId = (networkId: string) => ChainDisplay | undefined;

export function buildTopupOrderColumns({
  getChainDisplayByNetworkId,
  handleSelectOrder,
  language,
  statusColorMap,
  t,
}: {
  getChainDisplayByNetworkId: GetChainDisplayByNetworkId;
  handleSelectOrder: (order: UserWalletTopupOrder) => void;
  language: string;
  statusColorMap: StatusBadgeColorMap;
  t: TFunction;
}): ColumnDef<UserWalletTopupOrder>[] {
  return [
    {
      accessorKey: "id",
      cell: ({ row }) => <DataTableText mono>#{row.original.id}</DataTableText>,
      header: t("common.th.id"),
    },
    {
      id: "amount",
      cell: ({ row }) => (
        <DataTableText mono>{formatWalletTopupOrderAmount(row.original)}</DataTableText>
      ),
      header: t("common.th.amount"),
      meta: dataTableMeta.right,
    },
    {
      accessorKey: "type",
      cell: ({ row }) => (
        <DataTableBadge variant="outline">
          {t(`user.wallet.type-${row.original.type}`)}
        </DataTableBadge>
      ),
      header: t("user.wallet.order-type"),
    },
    {
      accessorKey: "network",
      cell: ({ row }) => (
        <WalletNetworkBadge
          getChainDisplayByNetworkId={getChainDisplayByNetworkId}
          network={row.original.network}
          paymentMethod={row.original.paymentMethod}
          t={t}
        />
      ),
      header: t("common.th.network"),
    },
    {
      accessorKey: "status",
      cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={statusColorMap} />,
      header: t("common.th.status"),
    },
    {
      id: "note",
      cell: ({ row }) => (
        <div className="max-w-[220px]">
          {row.original.adminNote ? (
            <DataTableText className="line-clamp-2" muted>
              {row.original.adminNote}
            </DataTableText>
          ) : (
            <DataTableText muted>—</DataTableText>
          )}
        </div>
      ),
      header: t("topup.detail.note"),
      meta: dataTableMeta.wrap,
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("common.th.time"),
    },
    {
      id: "actions",
      cell: ({ row }) =>
        row.original.status === "pending" ? (
          <div className="text-right">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleSelectOrder(row.original)}
            >
              {t("user.wallet.deposit-open-pending")}
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null,
      enableHiding: false,
      header: "",
      meta: {
        headerClassName: "w-[1%]",
        ...dataTableMeta.right,
      },
    },
  ];
}
