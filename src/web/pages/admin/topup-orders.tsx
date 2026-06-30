import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Ban, CheckCircle2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { z } from "zod";

import { removeTailingZero } from "@/shared/number";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import {
  usePayAgents,
  useRejectTopupOrder,
  useSettleTopupOrder,
  useTopupOrders,
} from "@/web/api/pay-agent-hooks";
import type { TopUpOrder } from "@/web/api/schemas";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
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

const TOPUP_STATUS_COLORS = {
  pending: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
  confirmed: "border-green-500/30 bg-green-500/10 text-green-600",
  rejected: "border-red-500/30 bg-red-500/10 text-red-600",
  expired: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600",
};

const REJECT_REASON_KEYS = [
  "duplicate_payment",
  "wrong_network",
  "unsupported_token",
  "payment_not_received",
] as const;

function isImageSource(value: string) {
  return (
    /^data:image\/(png|jpeg|gif|webp);base64,/.test(value) ||
    /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(value)
  );
}

function formatFiatAmount(amount: string | null | undefined, currency: string | null | undefined) {
  if (!amount) return "—";
  return `${removeTailingZero(amount)} ${currency || ""}`.trim();
}

function getOrderPrimaryAmount(order: TopUpOrder) {
  if (order.type === "fiat" && order.status !== "confirmed") {
    return {
      value: formatFiatAmount(order.fiatAmount || order.amount, order.fiatCurrency),
      unit: null,
    };
  }

  return {
    value: `$${removeTailingZero(order.amount)}`,
    unit: "USDC",
  };
}

export default function AdminTopupOrdersPage() {
  const { t, i18n } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const [draftStatus, setDraftStatus] = useState("all");
  const [status, setStatus] = useState("all");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [selected, setSelected] = useState<TopUpOrder | null>(null);

  const { data, isLoading } = useTopupOrders({
    status: status !== "all" ? status : undefined,
    page: pagination.pageIndex,
  });

  const statusColorMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(TOPUP_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`topup.status.${key}`), className },
        ]),
      ),
    [t],
  );

  const applyFilters = useCallback(() => {
    setStatus(draftStatus);
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftStatus]);

  const resetFilters = useCallback(() => {
    setDraftStatus("all");
    setStatus("all");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const orders = data?.items ?? [];
  const columns = useMemo<ColumnDef<TopUpOrder>[]>(
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
            <DataTableText muted>Agent #{row.original.agentId}</DataTableText>
          </div>
        ),
        header: t("common.th.name"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        id: "amount",
        cell: ({ row }) => {
          const primaryAmount = getOrderPrimaryAmount(row.original);
          return (
            <DataTableText mono>
              {primaryAmount.value}
              {primaryAmount.unit ? ` ${primaryAmount.unit}` : ""}
            </DataTableText>
          );
        },
        header: t("common.th.amount"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "type",
        cell: ({ row }) => (
          <DataTableText>{t(`user.wallet.type-${row.original.type}`)}</DataTableText>
        ),
        header: t("topup.detail.type"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "network",
        cell: ({ row }) => (
          <DataTableText muted>
            {row.original.network
              ? (getChainDisplayByNetworkId(row.original.network)?.name ?? row.original.network)
              : row.original.paymentMethod
                ? t(`fiat.method.${row.original.paymentMethod}`, {
                    defaultValue: row.original.paymentMethod,
                  })
                : "—"}
          </DataTableText>
        ),
        header: t("common.th.network"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={statusColorMap} />,
        header: t("common.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "adminNote",
        cell: ({ row }) => (
          <DataTableText className="max-w-[240px]" muted truncate>
            {row.original.adminNote || "—"}
          </DataTableText>
        ),
        header: t("topup.detail.note"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[12%]" },
      },
    ],
    [getChainDisplayByNetworkId, i18n.language, statusColorMap, t],
  );

  return (
    <div>
      <Header title={t("topup.title")} description={t("topup.desc")} />
      <div className="p-4 md:p-8 space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            <Select value={draftStatus} onValueChange={setDraftStatus}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("topup.filter.all")}</SelectItem>
                <SelectItem value="pending">{t("topup.status.pending")}</SelectItem>
                <SelectItem value="confirmed">{t("topup.status.confirmed")}</SelectItem>
                <SelectItem value="rejected">{t("topup.status.rejected")}</SelectItem>
                <SelectItem value="expired">{t("topup.status.expired")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters}>
                <Search className="mr-1 h-3.5 w-3.5" />
                {t("common.btn.search")}
              </Button>
              {draftStatus !== "all" && (
                <Button size="sm" variant="outline" onClick={resetFilters}>
                  {t("common.btn.reset")}
                </Button>
              )}
            </div>
          </div>

          <DataTable
            columns={columns}
            data={orders}
            emptyText={t("topup.table-empty")}
            getRowId={(row) => String(row.id)}
            loading={isLoading}
            manualPagination
            onPaginationChange={setPagination}
            onRowClick={setSelected}
            pagination={pagination}
            rowCount={data?.total ?? 0}
            tableClassName="min-w-[980px]"
          />
        </div>
      </div>

      <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
        <SheetContent className="w-full sm:w-[520px]">
          {selected && (
            <TopupOrderDetailSheet
              order={selected}
              statusColorMap={statusColorMap}
              onClose={() => setSelected(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TopupOrderDetailSheet({
  order,
  statusColorMap,
  onClose,
}: {
  order: TopUpOrder;
  statusColorMap: Record<string, { label: string; className: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const { data: agents = [] } = usePayAgents();
  const [settleOpen, setSettleOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isPending = order.status === "pending";
  const agentName = agents.find((agent) => agent.id === order.agentId)?.name ?? `#${order.agentId}`;
  const primaryAmount = getOrderPrimaryAmount(order);
  const fiatAmountDisplay =
    order.type === "fiat"
      ? formatFiatAmount(
          order.fiatAmount || (order.status !== "confirmed" ? order.amount : null),
          order.fiatCurrency,
        )
      : "—";

  return (
    <>
      <SheetHeader className="border-b pb-4">
        <SheetTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          {t("topup.title")} #{order.id}
        </SheetTitle>
      </SheetHeader>

      <SheetBody className="space-y-5">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("topup.detail.amount")}</p>
                <p className="text-2xl font-bold">
                  {primaryAmount.value}
                  {primaryAmount.unit ? (
                    <>
                      {" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        {primaryAmount.unit}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <StatusBadge status={order.status} colorMap={statusColorMap} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {isPending ? t("topup.detail.pending-hint") : t("topup.detail.readonly-hint")}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("topup.detail.user")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow label={t("topup.detail.user-name")} value={order.userName || "—"} />
            <InfoRow label={t("topup.detail.user-uuid")} value={order.userUuid || "—"} />
            <InfoLinkRow
              label={t("topup.detail.agent-id")}
              href={`/admin/pay-agents?id=${order.agentId}`}
              value={agentName}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("topup.detail.chain")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {match(order.type)
              .with("crypto", () => (
                <>
                  <InfoRow label={t("topup.detail.type")} value={t("user.wallet.type-crypto")} />
                  <InfoRow
                    label={t("common.th.network")}
                    value={
                      getChainDisplayByNetworkId(order.network || "")?.name ?? order.network ?? "—"
                    }
                  />
                  <InfoRow label={t("topup.detail.address")} value={order.toAddress || "—"} mono />
                  <InfoRow label={t("topup.detail.txhash")} value={order.txHash || "—"} mono />
                </>
              ))
              .with("fiat", () => (
                <>
                  <InfoRow label={t("topup.detail.type")} value={t("user.wallet.type-fiat")} />
                  <InfoRow
                    label={t("topup.detail.method")}
                    value={
                      order.paymentMethod
                        ? t(`fiat.method.${order.paymentMethod}`, {
                            defaultValue: order.paymentMethod,
                          })
                        : "—"
                    }
                  />
                  <InfoRow label={t("topup.detail.fiat-amount")} value={fiatAmountDisplay} />
                  <InfoRow
                    label={t("topup.detail.credit-amount")}
                    value={
                      order.status === "confirmed"
                        ? `$${removeTailingZero(order.amount)} USDC`
                        : "—"
                    }
                  />
                  {order.paymentProof ? (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {t("topup.detail.payment-proof")}
                      </p>
                      {isImageSource(order.paymentProof) ? (
                        <div className="flex justify-center rounded-xl border border-border/70 bg-muted/20 p-4">
                          <img
                            src={order.paymentProof}
                            alt={t("user.wallet.fiat-proof-preview-alt")}
                            className="max-h-64 rounded-lg object-contain"
                          />
                        </div>
                      ) : (
                        <p className="break-all text-sm">{order.paymentProof}</p>
                      )}
                    </div>
                  ) : null}
                </>
              ))
              .exhaustive()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("topup.detail.timeline")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label={t("topup.detail.created")}
              value={new Date(order.createdAt).toLocaleString()}
            />
            <InfoRow
              label={t("topup.detail.updated")}
              value={new Date(order.updatedAt).toLocaleString()}
            />
            <InfoRow
              label={t("topup.detail.expires")}
              value={order.expiresAt ? new Date(order.expiresAt).toLocaleString() : "—"}
            />
            <InfoRow label={t("topup.detail.note")} value={order.adminNote || "—"} />
          </CardContent>
        </Card>
      </SheetBody>

      <SheetFooter>
        {isPending ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              {t("topup.action.reject")}
            </Button>
            <Button size="sm" onClick={() => setSettleOpen(true)} disabled={!order.userId}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {t("topup.action.settle")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.btn.close")}
          </Button>
        )}
      </SheetFooter>

      {settleOpen && (
        <SettleOrderDialog order={order} onClose={() => setSettleOpen(false)} onDone={onClose} />
      )}
      {rejectOpen && (
        <RejectOrderDialog order={order} onClose={() => setRejectOpen(false)} onDone={onClose} />
      )}
    </>
  );
}

const settleSchema = z.object({
  amount: z
    .string()
    .min(1, "common.valid.required")
    .regex(/^\d+(\.\d+)?$/, "common.valid.invalid-amount"),
  fiatAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "common.valid.invalid-amount")
    .optional()
    .or(z.literal("")),
  note: z.string().max(500).optional(),
});

function SettleOrderDialog({
  order,
  onClose,
  onDone,
}: {
  order: TopUpOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const settleOrder = useSettleTopupOrder();
  const form = useForm<z.infer<typeof settleSchema>>({
    resolver: zodResolver(settleSchema),
    defaultValues: {
      amount: order.type === "fiat" ? "" : order.amount,
      fiatAmount: order.type === "fiat" ? order.fiatAmount || order.amount : "",
      note: t("topup.action.settle-default-note", { id: order.id }),
    },
  });

  const handleSubmit = useCallback(
    async (data: z.infer<typeof settleSchema>) => {
      if (order.type === "fiat" && !data.fiatAmount) {
        form.setError("fiatAmount", { type: "manual", message: t("common.valid.required") });
        return;
      }

      try {
        await settleOrder.mutateAsync({
          id: order.id,
          amount: data.amount,
          fiatAmount: order.type === "fiat" ? data.fiatAmount || undefined : undefined,
          note: data.note || undefined,
        });
        toast.success(t("topup.action.settle-success", {}));
        onClose();
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("topup.action.settle-error"));
      }
    },
    [form, settleOrder, order.id, order.type, t, onClose, onDone],
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("topup.action.settle")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              {order.type === "fiat" ? (
                <FormField
                  control={form.control}
                  name="fiatAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("topup.action.settle-fiat-amount")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} inputMode="decimal" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {t("topup.action.settle-fiat-hint", { currency: order.fiatCurrency })}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {order.type === "fiat"
                        ? t("topup.action.settle-credit-amount")
                        : t("common.th.amount")}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" />
                    </FormControl>
                    {order.type === "fiat" ? (
                      <p className="text-xs text-muted-foreground">
                        {t("topup.action.settle-credit-hint")}
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("topup.detail.note")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={form.handleSubmit(handleSubmit)} disabled={settleOrder.isPending}>
            {t("common.btn.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const rejectSchema = z.object({
  note: z.string().max(500).optional(),
});

function RejectOrderDialog({
  order,
  onClose,
  onDone,
}: {
  order: TopUpOrder;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const rejectOrder = useRejectTopupOrder();
  const form = useForm<z.infer<typeof rejectSchema>>({
    resolver: zodResolver(rejectSchema),
    defaultValues: {
      note: "",
    },
  });

  const applyReason = useCallback(
    (reasonKey: (typeof REJECT_REASON_KEYS)[number]) => {
      form.setValue("note", t(`topup.reject-reason.${reasonKey}`), {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    },
    [form, t],
  );

  const handleSubmit = useCallback(
    async (data: z.infer<typeof rejectSchema>) => {
      try {
        await rejectOrder.mutateAsync({ id: order.id, note: data.note || undefined });
        toast.success(t("topup.action.reject-success"));
        onClose();
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("topup.action.reject-error"));
      }
    },
    [rejectOrder, order.id, t, onClose, onDone],
  );

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("topup.action.reject")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">{t("topup.action.common-reasons")}</p>
                <div className="flex flex-wrap gap-2">
                  {REJECT_REASON_KEYS.map((reasonKey) => (
                    <Button
                      key={reasonKey}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => applyReason(reasonKey)}
                    >
                      {t(`topup.reject-reason.${reasonKey}`)}
                    </Button>
                  ))}
                </div>
              </div>
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("topup.detail.note")}</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={form.handleSubmit(handleSubmit)}
            disabled={rejectOrder.isPending}
          >
            {t("common.btn.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
