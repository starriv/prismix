import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useWalletWithdrawals } from "@/web/api/user-hooks";
import { DataTable } from "@/web/components/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { useChainRegistry } from "@/web/shared/chains";

import { buildPendingWithdrawalColumns } from "./pending-withdrawal-columns";
import { buildStatusColorMap, walletStatusClassNames } from "./table-helpers";

export function PendingWithdrawals() {
  const { t, i18n } = useTranslation();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const withdrawOrderStatusMap = useMemo(
    () =>
      buildStatusColorMap(t, "user.wallet.pending-status", {
        cancelled: walletStatusClassNames.danger,
        completed: walletStatusClassNames.success,
        failed: walletStatusClassNames.danger,
        pending: walletStatusClassNames.warning,
        processing: walletStatusClassNames.warning,
      }),
    [t],
  );

  const { data, isLoading, isFetching } = useWalletWithdrawals({
    limit: DEFAULT_PAGE_SIZE,
    offset: pagination.pageIndex * DEFAULT_PAGE_SIZE,
  });
  const orders = data?.items ?? [];
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>((updater) => {
    setPagination((prev) => ({
      ...functionalUpdate(updater, prev),
      pageSize: DEFAULT_PAGE_SIZE,
    }));
  }, []);
  const columns = useMemo(
    () =>
      buildPendingWithdrawalColumns({
        getChainDisplayByNetworkId,
        language: i18n.language,
        statusColorMap: withdrawOrderStatusMap,
        t,
      }),
    [getChainDisplayByNetworkId, i18n.language, t, withdrawOrderStatusMap],
  );

  if (!isLoading && orders.length === 0 && pagination.pageIndex === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("user.wallet.withdraw-orders-title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataTable
          columns={columns}
          data={orders}
          emptyText={t("user.wallet.tx-empty")}
          loading={{ initial: isLoading, fetching: isFetching }}
          manualPagination
          onPaginationChange={handlePaginationChange}
          pagination={pagination}
          rowCount={data?.total ?? 0}
          tableClassName="min-w-[860px]"
        />
      </CardContent>
    </Card>
  );
}
