import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";

import { removeTailingZero } from "@/shared/number";
import { useWalletWithdrawals } from "@/web/api/user-hooks";
import { Pagination } from "@/web/components/dashboard/pagination";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { useChainRegistry } from "@/web/shared/chains";
import { getDateLocale } from "@/web/shared/date-locale";

const WITHDRAW_PAGE_SIZE = 5;

const WITHDRAW_ORDER_STATUS_COLORS = {
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  processing: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  completed: "border-green-500/30 bg-green-500/10 text-green-600",
  failed: "border-red-500/30 bg-red-500/10 text-red-600",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-600",
};

export function PendingWithdrawals() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(0);
  const withdrawOrderStatusMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(WITHDRAW_ORDER_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`user.wallet.pending-status.${key}`), className },
        ]),
      ),
    [t],
  );

  const { data: orders = [] } = useWalletWithdrawals({
    excludeStatus: "completed",
    limit: WITHDRAW_PAGE_SIZE,
    offset: page * WITHDRAW_PAGE_SIZE,
  });
  const { getChainDisplayByNetworkId } = useChainRegistry();

  if (orders.length === 0 && page === 0) return null;

  const hasNext = orders.length === WITHDRAW_PAGE_SIZE;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("user.wallet.pending-title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("user.wallet.pending-th.amount")}</TableHead>
              <TableHead>{t("user.wallet.pending-th.address")}</TableHead>
              <TableHead>{t("user.wallet.pending-th.network")}</TableHead>
              <TableHead>{t("user.wallet.pending-th.status")}</TableHead>
              <TableHead>{t("user.wallet.pending-th.remark")}</TableHead>
              <TableHead>{t("user.wallet.pending-th.time")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => {
              const chain = getChainDisplayByNetworkId(o.network);
              return (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-sm font-medium">
                    ${removeTailingZero(o.amount)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {o.toAddress.slice(0, 6)}…{o.toAddress.slice(-4)}
                  </TableCell>
                  <TableCell className="text-xs">{chain?.name ?? o.network}</TableCell>
                  <TableCell>
                    <StatusBadge status={o.status} colorMap={withdrawOrderStatusMap} />
                  </TableCell>
                  <TableCell className="text-xs max-w-[200px]">
                    {o.failReason && (o.status === "cancelled" || o.status === "failed") ? (
                      <span className="text-destructive truncate block">{o.failReason}</span>
                    ) : o.txHash && o.status === "completed" ? (
                      <span className="font-mono text-muted-foreground">
                        {o.txHash.slice(0, 10)}…
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(o.createdAt), {
                      addSuffix: true,
                      locale: getDateLocale(i18n.language),
                    })}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination */}
        <Pagination
          page={page}
          onPageChange={setPage}
          currentCount={orders.length}
          pageSize={WITHDRAW_PAGE_SIZE}
        />
      </CardContent>
    </Card>
  );
}
