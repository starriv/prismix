import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { Ban, CheckCircle2, Search, Wallet } from "lucide-react";
import { toast } from "sonner";
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

export default function AdminTopupOrdersPage() {
  const { t, i18n } = useTranslation();
  const { getChainDisplayByNetworkId } = useChainRegistry();
  const [draftStatus, setDraftStatus] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TopUpOrder | null>(null);

  const { data, isLoading } = useTopupOrders({
    status: status !== "all" ? status : undefined,
    page,
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
    setPage(0);
  }, [draftStatus]);

  const resetFilters = useCallback(() => {
    setDraftStatus("all");
    setStatus("all");
    setPage(0);
  }, []);

  const orders = data?.items ?? [];

  return (
    <div>
      <Header title={t("topup.title")} description={t("topup.desc")} />
      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("topup.card-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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

            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("topup.table-empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>{t("common.th.name")}</TableHead>
                    <TableHead>{t("common.th.amount")}</TableHead>
                    <TableHead>{t("common.th.network")}</TableHead>
                    <TableHead>{t("common.th.status")}</TableHead>
                    <TableHead>{t("topup.detail.note")}</TableHead>
                    <TableHead>{t("common.th.time")}</TableHead>
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
                          {order.userUuid ?? `Agent #${order.agentId}`}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        ${removeTailingZero(order.amount)} USDC
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {order.network
                          ? (getChainDisplayByNetworkId(order.network)?.name ?? order.network)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} colorMap={statusColorMap} />
                      </TableCell>
                      <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                        {order.adminNote ? (
                          <span className="line-clamp-2">{order.adminNote}</span>
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
                  ${removeTailingZero(order.amount)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">USDC</span>
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
            <InfoRow label={t("topup.detail.address")} value={order.toAddress || "—"} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("topup.detail.chain")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <InfoRow
              label={t("common.th.network")}
              value={
                order.network
                  ? (getChainDisplayByNetworkId(order.network)?.name ?? order.network)
                  : "—"
              }
            />
            <InfoRow label={t("topup.detail.txhash")} value={order.txHash || "—"} mono />
            <InfoRow label={t("topup.detail.method")} value={order.paymentMethod || "—"} />
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
    .min(1)
    .regex(/^\d+(\.\d+)?$/),
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
      amount: order.amount,
      note: t("topup.action.settle-default-note", { id: order.id }),
    },
  });

  const handleSubmit = useCallback(
    async (data: z.infer<typeof settleSchema>) => {
      try {
        await settleOrder.mutateAsync({
          id: order.id,
          amount: data.amount,
          note: data.note || undefined,
        });
        toast.success(t("topup.action.settle-success", {}));
        onClose();
        onDone();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("topup.action.settle-error"));
      }
    },
    [settleOrder, order.id, t, onClose, onDone],
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
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.th.amount")}</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="decimal" />
                    </FormControl>
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
