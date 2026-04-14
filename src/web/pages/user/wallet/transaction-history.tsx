import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OnChangeFn, PaginationState } from "@tanstack/react-table";
import { functionalUpdate } from "@tanstack/react-table";
import { Receipt, Search } from "lucide-react";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { useWalletTransactions } from "@/web/api/user-hooks";
import { DataTable, DataTableToolbar } from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { useChainRegistry } from "@/web/shared/chains";

import { buildTransactionHistoryColumns } from "./transaction-history-columns";

const TX_PAGE_SIZE = DEFAULT_PAGE_SIZE;

export function TransactionHistory() {
  const { t, i18n } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();

  // Draft filters
  const [draftType, setDraftType] = useState("all");

  // Applied filters + pagination
  const [type, setType] = useState<string | undefined>();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: TX_PAGE_SIZE,
  });

  const { data, isLoading, isFetching } = useWalletTransactions({
    type,
    limit: TX_PAGE_SIZE,
    offset: pagination.pageIndex * TX_PAGE_SIZE,
  });
  const transactions = data?.items ?? [];

  const hasFilters = draftType !== "all";

  const applyFilters = useCallback(() => {
    setType(draftType !== "all" ? draftType : undefined);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftType]);

  const resetFilters = useCallback(() => {
    setDraftType("all");
    setType(undefined);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>((updater) => {
    setPagination((prev) => ({
      ...functionalUpdate(updater, prev),
      pageSize: TX_PAGE_SIZE,
    }));
  }, []);
  const columns = useMemo(
    () =>
      buildTransactionHistoryColumns({
        getChainDisplayByNetworkId,
        language: i18n.language,
        t,
      }),
    [getChainDisplayByNetworkId, i18n.language, t],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {t("user.wallet.transactions")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <DataTable
          columns={columns}
          data={transactions}
          emptyText={t("user.wallet.tx-empty")}
          loading={{ initial: isLoading, fetching: isFetching }}
          manualPagination
          onPaginationChange={handlePaginationChange}
          pagination={pagination}
          rowCount={data?.total ?? 0}
          tableClassName="min-w-[980px]"
          toolbar={
            <DataTableToolbar>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Select value={draftType} onValueChange={setDraftType}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("user.wallet.filter.all-types")}</SelectItem>
                    <SelectItem value="top_up">{t("user.wallet.tx-type.top_up")}</SelectItem>
                    <SelectItem value="ai_usage">{t("user.wallet.tx-type.ai_usage")}</SelectItem>
                    <SelectItem value="withdraw">{t("user.wallet.tx-type.withdraw")}</SelectItem>
                    <SelectItem value="payment">{t("user.wallet.tx-type.payment")}</SelectItem>
                    <SelectItem value="admin_debit">
                      {t("user.wallet.tx-type.admin_debit")}
                    </SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex gap-2">
                  <Button size="sm" onClick={applyFilters}>
                    <Search className="mr-1 h-3.5 w-3.5" />
                    {t("common.btn.search")}
                  </Button>
                  {hasFilters && (
                    <Button size="sm" variant="outline" onClick={resetFilters}>
                      {t("common.btn.reset")}
                    </Button>
                  )}
                </div>
              </div>
            </DataTableToolbar>
          }
        />
      </CardContent>
    </Card>
  );
}
