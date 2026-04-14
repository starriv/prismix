import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import { removeTailingZero } from "@/shared/number";
import type { WithdrawOrder } from "@/web/api/schemas";
import type { StatusBadgeColorMap } from "@/web/components/dashboard/status-badge";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import type { ChainDisplay } from "@/web/shared/chains";

type GetChainDisplayByNetworkId = (networkId: string) => ChainDisplay | undefined;

export function buildPendingWithdrawalColumns({
  getChainDisplayByNetworkId,
  language,
  statusColorMap,
  t,
}: {
  getChainDisplayByNetworkId: GetChainDisplayByNetworkId;
  language: string;
  statusColorMap: StatusBadgeColorMap;
  t: TFunction;
}): ColumnDef<WithdrawOrder>[] {
  return [
    {
      accessorKey: "amount",
      cell: ({ row }) => (
        <DataTableText mono numeric className="text-sm font-medium">
          ${removeTailingZero(row.original.amount)}
        </DataTableText>
      ),
      header: t("user.wallet.pending-th.amount"),
      meta: dataTableMeta.right,
    },
    {
      accessorKey: "type",
      cell: ({ row }) => (
        <DataTableText>{t(`user.wallet.type-${row.original.type}`)}</DataTableText>
      ),
      header: t("user.wallet.order-type"),
    },
    {
      accessorKey: "toAddress",
      cell: ({ row }) => (
        <DataTableText mono muted>
          {row.original.toAddress
            ? row.original.type === "fiat"
              ? row.original.toAddress
              : `${row.original.toAddress.slice(0, 6)}…${row.original.toAddress.slice(-4)}`
            : "—"}
        </DataTableText>
      ),
      header: t("user.wallet.pending-th.address"),
    },
    {
      accessorKey: "network",
      cell: ({ row }) => {
        const chain = row.original.network
          ? getChainDisplayByNetworkId(row.original.network)
          : null;
        return (
          <DataTableText>
            {row.original.network
              ? (chain?.name ?? row.original.network)
              : row.original.paymentMethod || "—"}
          </DataTableText>
        );
      },
      header: t("user.wallet.pending-th.network"),
    },
    {
      accessorKey: "status",
      cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={statusColorMap} />,
      header: t("user.wallet.pending-th.status"),
    },
    {
      id: "remark",
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          {row.original.failReason &&
          (row.original.status === "cancelled" || row.original.status === "failed") ? (
            <DataTableText className="block text-destructive" truncate>
              {row.original.failReason}
            </DataTableText>
          ) : row.original.adminNote ? (
            <DataTableText className="block" muted truncate>
              {row.original.adminNote}
            </DataTableText>
          ) : row.original.txHash && row.original.status === "completed" ? (
            <DataTableText mono muted>
              {row.original.txHash.slice(0, 10)}…
            </DataTableText>
          ) : (
            <DataTableText muted>—</DataTableText>
          )}
        </div>
      ),
      header: t("user.wallet.pending-th.remark"),
      meta: dataTableMeta.wrap,
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <DataTableRelativeTime language={language} value={row.original.createdAt} />
      ),
      header: t("user.wallet.pending-th.time"),
    },
  ];
}
