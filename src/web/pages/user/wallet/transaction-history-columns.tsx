import type { ColumnDef } from "@tanstack/react-table";
import type { TFunction } from "i18next";

import { gt, removeTailingZero } from "@/shared/number";
import type { WalletTransaction } from "@/web/api/schemas";
import { dataTableMeta, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import type { ChainDisplay } from "@/web/shared/chains";

import {
  WalletSourceBadge,
  WalletTransactionDetail,
  WalletTransactionTypeBadge,
} from "./table-helpers";

type GetChainDisplayByNetworkId = (networkId: string) => ChainDisplay | undefined;

export function buildTransactionHistoryColumns({
  getChainDisplayByNetworkId,
  language,
  t,
}: {
  getChainDisplayByNetworkId: GetChainDisplayByNetworkId;
  language: string;
  t: TFunction;
}): ColumnDef<WalletTransaction>[] {
  return [
    {
      accessorKey: "type",
      cell: ({ row }) => <WalletTransactionTypeBadge type={row.original.type} t={t} />,
      header: t("common.th.type"),
      meta: {
        headerClassName: "w-[128px] text-xs",
      },
    },
    {
      accessorKey: "amount",
      cell: ({ row }) => {
        const isCredit = gt(row.original.balanceAfter, row.original.balanceBefore);
        return (
          <DataTableText mono nowrap className={isCredit ? "text-green-600" : "text-red-500"}>
            {isCredit ? "+" : "-"}
            {removeTailingZero(row.original.amount)} USDC
          </DataTableText>
        );
      },
      header: t("common.th.amount"),
      meta: {
        headerClassName: "w-[132px] text-xs",
      },
    },
    {
      accessorKey: "balanceAfter",
      cell: ({ row }) => (
        <DataTableText mono muted nowrap>
          {removeTailingZero(row.original.balanceBefore)} →{" "}
          {removeTailingZero(row.original.balanceAfter)}
        </DataTableText>
      ),
      header: t("user.wallet.th.balance"),
      meta: {
        headerClassName: "w-[168px] text-xs",
      },
    },
    {
      accessorKey: "source",
      cell: ({ row }) => <WalletSourceBadge source={row.original.source} t={t} />,
      header: t("common.th.source"),
      meta: {
        headerClassName: "w-[108px] text-xs",
      },
    },
    {
      accessorKey: "network",
      cell: ({ row }) => {
        const chain = row.original.network
          ? getChainDisplayByNetworkId(row.original.network)
          : undefined;
        return (
          <DataTableText muted nowrap>
            {chain?.shortName ?? row.original.network ?? "—"}
          </DataTableText>
        );
      },
      header: t("common.th.network"),
      meta: {
        headerClassName: "w-[96px] text-xs",
      },
    },
    {
      id: "detail",
      cell: ({ row }) => {
        const chain = row.original.network
          ? getChainDisplayByNetworkId(row.original.network)
          : undefined;
        return (
          <div className="max-w-0 text-muted-foreground">
            <WalletTransactionDetail
              description={row.original.description}
              explorerUrl={chain?.explorerUrl}
              txHash={row.original.txHash}
            />
          </div>
        );
      },
      header: t("user.wallet.th.detail"),
      meta: {
        ...dataTableMeta.wrap,
        headerClassName: "text-xs",
      },
    },
    {
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">
              <DataTableRelativeTime language={language} value={row.original.createdAt} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {new Date(row.original.createdAt).toLocaleString(language)}
          </TooltipContent>
        </Tooltip>
      ),
      header: t("common.th.time"),
      meta: {
        headerClassName: "w-[124px] text-xs",
      },
    },
  ];
}
