import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import type { UserWalletTopupOrder } from "@/web/api/schemas";
import { useWalletTopupOrders } from "@/web/api/user-hooks";
import { DataTable } from "@/web/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { useChainRegistry } from "@/web/shared/chains";

import { buildStatusColorMap, walletStatusClassNames } from "./table-helpers";
import { buildTopupOrderColumns } from "./topup-order-columns";

export function WalletTopupOrders({
  onSelectOrder,
}: {
  onSelectOrder?: (order: UserWalletTopupOrder) => void;
}) {
  const { t, i18n } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { data, isLoading, isFetching } = useWalletTopupOrders({
    limit: pagination.pageSize,
    offset: pagination.pageIndex * pagination.pageSize,
  });
  const orders = data?.items ?? [];
  const handleSelectOrder = useCallback(
    (order: UserWalletTopupOrder) => {
      if (order.status !== "pending") return;
      onSelectOrder?.(order);
    },
    [onSelectOrder],
  );
  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>((updater) => {
    setPagination((prev) => ({
      ...functionalUpdate(updater, prev),
      pageSize: DEFAULT_PAGE_SIZE,
    }));
  }, []);

  const statusColorMap = useMemo(
    () =>
      buildStatusColorMap(t, "topup.status", {
        confirmed: walletStatusClassNames.success,
        expired: walletStatusClassNames.neutral,
        pending: walletStatusClassNames.warning,
        rejected: walletStatusClassNames.danger,
      }),
    [t],
  );
  const columns = useMemo(
    () =>
      buildTopupOrderColumns({
        getChainDisplayByNetworkId,
        handleSelectOrder,
        language: i18n.language,
        statusColorMap,
        t,
      }),
    [getChainDisplayByNetworkId, handleSelectOrder, i18n.language, statusColorMap, t],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("user.wallet.deposit-orders")}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={orders}
          emptyText={t("user.wallet.deposit-orders-empty")}
          loading={{ initial: isLoading, fetching: isFetching }}
          manualPagination
          onPaginationChange={handlePaginationChange}
          pagination={pagination}
          rowCount={data?.total ?? 0}
          tableClassName="min-w-[940px]"
        />
      </CardContent>
    </Card>
  );
}
