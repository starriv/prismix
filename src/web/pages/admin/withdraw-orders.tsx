import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Ban, CheckCircle2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import { useAdminWithdrawals, useApproveWithdraw, useRejectWithdraw } from "@/web/api/admin-hooks";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { usePayAgents } from "@/web/api/pay-agent-hooks";
import type { WithdrawOrder } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { InfoLinkRow, InfoRow } from "@/web/components/dashboard/info-row";
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
import { Input } from "@/web/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/web/components/ui/sheet";
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
import { useChainRegistry } from "@/web/shared/chains";
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
  const { getChainDisplayByNetworkId } = useChainRegistry();

  // Draft + applied filter state
  const [draftStatus, setDraftStatus] = useState("all");
  const [appliedStatus, setAppliedStatus] = useState("all");
  const [draftUserUuid, setDraftUserUuid] = useState("");
  const [appliedUserUuid, setAppliedUserUuid] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<WithdrawOrder | null>(null);

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
    userUuid: appliedUserUuid || undefined,
    page,
  });

  const hasFilters = draftStatus !== "all" || draftUserUuid !== "" || appliedUserUuid !== "";

  const applyFilters = useCallback(() => {
    setAppliedStatus(draftStatus);
    setAppliedUserUuid(draftUserUuid.trim());
    setPage(0);
  }, [draftStatus, draftUserUuid]);

  const resetFilters = useCallback(() => {
    setDraftStatus("all");
    setAppliedStatus("all");
    setDraftUserUuid("");
    setAppliedUserUuid("");
    setPage(0);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  const handleUserUuidChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftUserUuid(e.target.value),
    [],
  );

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
                  <SelectItem value="processing">
                    {t("admin.withdraw.status.processing")}
                  </SelectItem>
                  <SelectItem value="completed">{t("admin.withdraw.filter.completed")}</SelectItem>
                  <SelectItem value="failed">{t("admin.withdraw.filter.failed")}</SelectItem>
                  <SelectItem value="cancelled">{t("admin.withdraw.filter.cancelled")}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={t("admin.withdraw.filter-uuid-ph")}
                value={draftUserUuid}
                onChange={handleUserUuidChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[240px]"
              />

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
                    <TableHead>{t("admin.withdraw.th.type")}</TableHead>
                    <TableHead>{t("common.th.network")}</TableHead>
                    <TableHead>{t("admin.withdraw.th.status")}</TableHead>
                    <TableHead>{t("admin.withdraw.detail.note")}</TableHead>
                    <TableHead>{t("admin.withdraw.th.time")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(order)}
                    >
                      <TableCell className="font-mono text-xs">#{order.id}</TableCell>
                      <TableCell className="text-xs">
                        <div>{order.userName ?? "—"}</div>
                        <div className="text-muted-foreground font-mono">
                          {order.userUuid ?? (order.userId ? `User #${order.userId}` : "—")}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        ${removeTailingZero(order.amount)} USDC
                      </TableCell>
                      <TableCell className="text-xs">
                        {t(`user.wallet.type-${order.type}`)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {order.network
                          ? (getChainDisplayByNetworkId(order.network)?.name ?? order.network)
                          : order.paymentMethod || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} colorMap={withdrawStatusColorMap} />
                      </TableCell>
                      <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                        {order.failReason ? (
                          <span className="line-clamp-2">{order.failReason}</span>
                        ) : (
                          "—"
                        )}
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

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-[520px]">
          {selected && (
            <WithdrawOrderDetailSheet
              order={selected}
              statusColorMap={withdrawStatusColorMap}
              onClose={() => setSelected(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function WithdrawOrderDetailSheet({
  order,
  statusColorMap,
  onClose,
}: {
  order: WithdrawOrder;
  statusColorMap: Record<string, { label: string; className: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const { data: agents = [] } = usePayAgents();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isPending = order.status === "pending";
  const agentName = agents.find((agent) => agent.id === order.agentId)?.name ?? `#${order.agentId}`;

  return (
    <>
      <SheetHeader className="border-b pb-4">
        <SheetTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          {t("admin.withdraw.title")} #{order.id}
        </SheetTitle>
      </SheetHeader>

      <SheetBody className="space-y-5">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("admin.withdraw.detail.amount")}</p>
                <p className="text-2xl font-bold">
                  ${removeTailingZero(order.amount)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">USDC</span>
                </p>
              </div>
              <StatusBadge status={order.status} colorMap={statusColorMap} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {isPending
                ? t("admin.withdraw.detail.pending-hint")
                : t("admin.withdraw.detail.readonly-hint")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.withdraw.detail.user")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label={t("admin.withdraw.detail.user-name")} value={order.userName || "—"} />
            <InfoRow label={t("admin.withdraw.detail.user-uuid")} value={order.userUuid || "—"} />
            <InfoLinkRow
              label={t("admin.withdraw.detail.agent-id")}
              href={`/admin/pay-agents?id=${order.agentId}`}
              value={agentName}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.withdraw.detail.chain")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {match(order.type)
              .with("crypto", () => (
                <>
                  <InfoRow
                    label={t("admin.withdraw.detail.type")}
                    value={t("user.wallet.type-crypto")}
                  />
                  <InfoRow
                    label={t("common.th.network")}
                    value={
                      getChainDisplayByNetworkId(order.network || "")?.name ?? order.network ?? "—"
                    }
                  />
                  <InfoRow
                    label={t("admin.withdraw.detail.address")}
                    value={order.toAddress || "—"}
                    mono
                  />
                  <InfoRow
                    label={t("admin.withdraw.detail.txhash")}
                    value={order.txHash || "—"}
                    mono
                  />
                  <InfoRow label={t("admin.withdraw.detail.fee")} value={order.fee || "—"} />
                </>
              ))
              .with("fiat", () => (
                <>
                  <InfoRow
                    label={t("admin.withdraw.detail.type")}
                    value={t("user.wallet.type-fiat")}
                  />
                  <InfoRow
                    label={t("admin.withdraw.detail.method")}
                    value={order.paymentMethod || "—"}
                  />
                  <InfoRow
                    label={t("user.wallet.fiat-withdraw-info")}
                    value={order.toAddress || "—"}
                  />
                  <InfoRow
                    label={t("user.wallet.fiat-withdraw-note")}
                    value={order.userNote || "—"}
                  />
                </>
              ))
              .exhaustive()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.withdraw.detail.timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label={t("admin.withdraw.detail.created")}
              value={new Date(order.createdAt).toLocaleString()}
            />
            <InfoRow
              label={t("admin.withdraw.detail.updated")}
              value={order.updatedAt ? new Date(order.updatedAt).toLocaleString() : "—"}
            />
            <InfoRow
              label={t("admin.withdraw.detail.reviewed")}
              value={order.reviewedAt ? new Date(order.reviewedAt).toLocaleString() : "—"}
            />
            <InfoRow
              label={t("admin.withdraw.detail.reviewer")}
              value={order.reviewedBy ? `#${order.reviewedBy}` : "—"}
            />
            <InfoRow
              label={t("admin.withdraw.detail.note")}
              value={order.adminNote || order.failReason || "—"}
            />
          </CardContent>
        </Card>
      </SheetBody>

      <SheetFooter>
        {isPending ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              {t("admin.withdraw.btn.reject")}
            </Button>
            <Button size="sm" onClick={() => setApproveOpen(true)}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {t("admin.withdraw.btn.approve")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.btn.close")}
          </Button>
        )}
      </SheetFooter>

      <ApproveDialog
        order={approveOpen ? order : null}
        onClose={() => setApproveOpen(false)}
        onDone={onClose}
      />
      <RejectDialog
        order={rejectOpen ? order : null}
        onClose={() => setRejectOpen(false)}
        onDone={onClose}
      />
    </>
  );
}

// ── Approve Dialog ──────────────────────────────────────

function ApproveDialog({
  order,
  onClose,
  onDone,
}: {
  order: WithdrawOrder | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const approve = useApproveWithdraw();

  const handleApprove = useCallback(async () => {
    if (!order) return;
    try {
      await approve.mutateAsync(order.id);
      toast.success(t("admin.withdraw.toast.approved"));
      onClose();
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.withdraw.toast.approve-error"));
    }
  }, [order, approve, onClose, onDone, t]);

  return (
    <Dialog open={!!order} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("admin.withdraw.approve-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {order && (
            <div className="space-y-2 text-sm">
              {order.type === "fiat" ? (
                <p>
                  {t("admin.withdraw.approve-confirm-fiat", {
                    amount: `$${removeTailingZero(order.amount)}`,
                    name: order.userName || order.userUuid || t("common.user"),
                  })}
                </p>
              ) : (
                <p>
                  {t("admin.withdraw.approve-confirm", {
                    amount: `$${removeTailingZero(order.amount)}`,
                    address: order.toAddress
                      ? `${order.toAddress.slice(0, 6)}…${order.toAddress.slice(-4)}`
                      : (order.paymentMethod ?? "wallet"),
                  })}
                </p>
              )}
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

function RejectDialog({
  order,
  onClose,
  onDone,
}: {
  order: WithdrawOrder | null;
  onClose: () => void;
  onDone: () => void;
}) {
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
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.withdraw.toast.reject-error"));
    }
  }, [order, reject, reason, onClose, onDone, t]);

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
