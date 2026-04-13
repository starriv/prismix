import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";

import { removeTailingZero } from "@/shared/number";
import { useWalletTopupOrders } from "@/web/api/user-hooks";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { getDateLocale } from "@/web/shared/date-locale";

const STATUS_COLORS = {
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  confirmed: "border-green-500/30 bg-green-500/10 text-green-600",
  rejected: "border-red-500/30 bg-red-500/10 text-red-600",
  expired: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600",
};

export function WalletTopupOrders() {
  const { t, i18n } = useTranslation();
  const { data: orders = [], isLoading } = useWalletTopupOrders({ limit: 10 });

  const statusColorMap = Object.fromEntries(
    Object.entries(STATUS_COLORS).map(([key, className]) => [
      key,
      { label: t(`topup.status.${key}`), className },
    ]),
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          {t("user.wallet.deposit-orders", "Deposit Orders")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : orders.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            {t("user.wallet.deposit-orders-empty", "No deposit orders yet")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>{t("common.th.amount")}</TableHead>
                <TableHead>{t("common.th.network")}</TableHead>
                <TableHead>{t("common.th.status")}</TableHead>
                <TableHead>{t("common.th.time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">#{order.id}</TableCell>
                  <TableCell className="font-mono text-xs">
                    ${removeTailingZero(order.amount)} USDC
                  </TableCell>
                  <TableCell>
                    {order.network ? (
                      <Badge variant="outline" className="text-xs">
                        {order.network}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} colorMap={statusColorMap} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(order.createdAt), {
                      addSuffix: true,
                      locale: getDateLocale(i18n.language),
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
