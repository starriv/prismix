import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Check, Search, X } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useAdminWithdrawals, useApproveWithdraw, useRejectWithdraw } from "@/web/api/admin-hooks";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import type { WithdrawOrder } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Pagination } from "@/web/components/dashboard/pagination";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { Textarea } from "@/web/components/ui/textarea";
import { getDateLocale } from "@/web/shared/date-locale";

const WITHDRAW_STATUS_COLORS = {
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  processing: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  completed: "border-green-500/30 bg-green-500/10 text-green-600",
  failed: "border-red-500/30 bg-red-500/10 text-red-600",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-600",
};

export default function AdminWithdrawOrdersPage() {
  const { t, i18n } = useTranslation();

  // Draft + applied filter state
  const [draftStatus, setDraftStatus] = useState("all");
  const [appliedStatus, setAppliedStatus] = useState("all");
  const [page, setPage] = useState(0);

  const withdrawStatusColorMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(WITHDRAW_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`admin.withdraw.status.${key}`), className },
        ]),
      ),
    [t],
  );

  const { data: orders = [], isLoading } = useAdminWithdrawals({
    status: appliedStatus !== "all" ? appliedStatus : undefined,
    page,
  });

  const hasFilters = draftStatus !== "all";

  const applyFilters = useCallback(() => {
    setAppliedStatus(draftStatus);
    setPage(0);
  }, [draftStatus]);

  const resetFilters = useCallback(() => {
    setDraftStatus("all");
    setAppliedStatus("all");
    setPage(0);
  }, []);

  // Approve / Reject state
  const [approveTarget, setApproveTarget] = useState<WithdrawOrder | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WithdrawOrder | null>(null);

  return (
    <div>
      <Header title={t("admin.withdraw.title")} description={t("admin.withdraw.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.withdraw.card-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              <Select value={draftStatus} onValueChange={setDraftStatus}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("admin.withdraw.filter.all")}</SelectItem>
                  <SelectItem value="pending">{t("admin.withdraw.filter.pending")}</SelectItem>
                  <SelectItem value="completed">{t("admin.withdraw.filter.completed")}</SelectItem>
                  <SelectItem value="failed">{t("admin.withdraw.filter.failed")}</SelectItem>
                  <SelectItem value="cancelled">{t("admin.withdraw.filter.cancelled")}</SelectItem>
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

            {/* Table */}
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("admin.withdraw.empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">ID</TableHead>
                    <TableHead>{t("admin.withdraw.th.user")}</TableHead>
                    <TableHead>{t("admin.withdraw.th.amount")}</TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t("admin.withdraw.th.address")}
                    </TableHead>
                    <TableHead>{t("admin.withdraw.th.status")}</TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t("admin.withdraw.th.time")}
                    </TableHead>
                    <TableHead className="w-[140px]">{t("admin.withdraw.th.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">#{order.id}</TableCell>
                      <TableCell className="text-xs">
                        {order.userId ? `User #${order.userId}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">
                        ${removeTailingZero(order.amount)} USDC
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-xs">
                        {order.toAddress.slice(0, 6)}…{order.toAddress.slice(-4)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} colorMap={withdrawStatusColorMap} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(order.createdAt), {
                          addSuffix: true,
                          locale: getDateLocale(i18n.language),
                        })}
                      </TableCell>
                      <TableCell>
                        {order.status === "pending" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 px-2 text-xs"
                              onClick={() => setApproveTarget(order)}
                            >
                              <Check className="mr-1 h-3 w-3" />
                              {t("admin.withdraw.btn.approve")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => setRejectTarget(order)}
                            >
                              <X className="mr-1 h-3 w-3" />
                              {t("admin.withdraw.btn.reject")}
                            </Button>
                          </div>
                        )}
                        {order.status === "completed" && order.txHash && (
                          <span className="font-mono text-xs text-muted-foreground">
                            {order.txHash.slice(0, 10)}…
                          </span>
                        )}
                        {order.status === "cancelled" && order.failReason && (
                          <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                            {order.failReason}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Pagination */}
            <Pagination
              page={page}
              onPageChange={setPage}
              currentCount={orders.length}
              pageSize={DEFAULT_PAGE_SIZE}
            />
          </CardContent>
        </Card>
      </div>

      {/* Approve Confirmation Dialog */}
      <ApproveDialog order={approveTarget} onClose={() => setApproveTarget(null)} />

      {/* Reject Dialog */}
      <RejectDialog order={rejectTarget} onClose={() => setRejectTarget(null)} />
    </div>
  );
}

// ── Approve Dialog ──────────────────────────────────────

function ApproveDialog({ order, onClose }: { order: WithdrawOrder | null; onClose: () => void }) {
  const { t } = useTranslation();
  const approve = useApproveWithdraw();

  const handleApprove = useCallback(async () => {
    if (!order) return;
    try {
      await approve.mutateAsync(order.id);
      toast.success(t("admin.withdraw.toast.approved"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.withdraw.toast.approve-error"));
    }
  }, [order, approve, onClose, t]);

  return (
    <Dialog open={!!order} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.withdraw.approve-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {order && (
            <div className="space-y-2 text-sm">
              <p>
                {t("admin.withdraw.approve-confirm", {
                  amount: `$${removeTailingZero(order.amount)}`,
                  address: `${order.toAddress.slice(0, 6)}…${order.toAddress.slice(-4)}`,
                })}
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleApprove} disabled={approve.isPending}>
            {approve.isPending
              ? t("admin.withdraw.btn.approving")
              : t("admin.withdraw.btn.approve")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reject Dialog ──────────────────────────────────────

function RejectDialog({ order, onClose }: { order: WithdrawOrder | null; onClose: () => void }) {
  const { t } = useTranslation();
  const reject = useRejectWithdraw();
  const [reason, setReason] = useState("");

  const handleReject = useCallback(async () => {
    if (!order) return;
    try {
      await reject.mutateAsync({ id: order.id, reason: reason.trim() || undefined });
      toast.success(t("admin.withdraw.toast.rejected"));
      setReason("");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.withdraw.toast.reject-error"));
    }
  }, [order, reject, reason, onClose, t]);

  const handleReasonChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value),
    [],
  );

  return (
    <Dialog
      open={!!order}
      onOpenChange={() => {
        setReason("");
        onClose();
      }}
    >
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("admin.withdraw.reject-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {order && (
            <div className="space-y-3">
              <p className="text-sm">
                {t("admin.withdraw.reject-confirm", {
                  amount: `$${removeTailingZero(order.amount)}`,
                })}
              </p>
              <Textarea
                placeholder={t("admin.withdraw.reject-reason-ph")}
                value={reason}
                onChange={handleReasonChange}
                rows={3}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              onClose();
            }}
          >
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleReject} disabled={reject.isPending}>
            {reject.isPending ? t("admin.withdraw.btn.rejecting") : t("admin.withdraw.btn.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
