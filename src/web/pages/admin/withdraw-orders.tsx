import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
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
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { DataTable, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
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
import { Textarea } from "@/web/components/ui/textarea";
import { useChainRegistry } from "@/web/shared/chains";

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
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
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

  const { data: ordersData, isLoading } = useAdminWithdrawals({
    status: appliedStatus !== "all" ? appliedStatus : undefined,
    userUuid: appliedUserUuid || undefined,
    page: pagination.pageIndex,
  });
  const orders = useMemo(() => ordersData?.items ?? [], [ordersData?.items]);
  const orderPageCount = Math.ceil((ordersData?.total ?? 0) / DEFAULT_PAGE_SIZE);

  const hasFilters = draftStatus !== "all" || draftUserUuid !== "" || appliedUserUuid !== "";

  const applyFilters = useCallback(() => {
    setAppliedStatus(draftStatus);
    setAppliedUserUuid(draftUserUuid.trim());
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftStatus, draftUserUuid]);

  const resetFilters = useCallback(() => {
    setDraftStatus("all");
    setAppliedStatus("all");
    setDraftUserUuid("");
    setAppliedUserUuid("");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
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
  const columns = useMemo<ColumnDef<WithdrawOrder>[]>(
    () => [
      {
        accessorKey: "id",
        cell: ({ row }) => <DataTableText mono>#{row.original.id}</DataTableText>,
        header: t("common.th.id"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        id: "user",
        cell: ({ row }) => (
          <div>
            <DataTableText>{row.original.userName ?? "—"}</DataTableText>
            <DataTableText mono muted>
              {row.original.userUuid ??
                (row.original.userId ? `User #${row.original.userId}` : "—")}
            </DataTableText>
          </div>
        ),
        header: t("admin.withdraw.th.user"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "amount",
        cell: ({ row }) => (
          <DataTableText mono>{`$${removeTailingZero(row.original.amount)} USDC`}</DataTableText>
        ),
        header: t("admin.withdraw.th.amount"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "type",
        cell: ({ row }) => (
          <DataTableText>{t(`user.wallet.type-${row.original.type}`)}</DataTableText>
        ),
        header: t("admin.withdraw.th.type"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "network",
        cell: ({ row }) => (
          <DataTableText muted>
            {row.original.network
              ? (getChainDisplayByNetworkId(row.original.network)?.name ?? row.original.network)
              : row.original.paymentMethod || "—"}
          </DataTableText>
        ),
        header: t("common.th.network"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} colorMap={withdrawStatusColorMap} />
        ),
        header: t("admin.withdraw.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "failReason",
        cell: ({ row }) => (
          <DataTableText className="max-w-[240px]" muted truncate>
            {row.original.failReason || "—"}
          </DataTableText>
        ),
        header: t("admin.withdraw.detail.note"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("admin.withdraw.th.time"),
        meta: { headerClassName: "w-[12%]" },
      },
    ],
    [getChainDisplayByNetworkId, i18n.language, t, withdrawStatusColorMap],
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

            <DataTable
              columns={columns}
              data={orders}
              emptyText={t("admin.withdraw.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              manualPagination
              onPaginationChange={setPagination}
              onRowClick={setSelected}
              pageCount={orderPageCount}
              pagination={pagination}
              tableClassName="min-w-[980px]"
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
