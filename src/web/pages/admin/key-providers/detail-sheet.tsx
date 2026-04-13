import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useDeleteKeyProvider, useKeyProviderDetail, useUpdateKeyProvider } from "@/web/api/hooks";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { SheetBody, SheetFooter, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { cn } from "@/web/shared/utils";

import { TransactionList } from "./transaction-list";

export function KeyProviderDetailSheet({
  providerId,
  onClose,
}: {
  providerId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const {
    data: provider,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useKeyProviderDetail(providerId);
  const updateMutation = useUpdateKeyProvider();
  const deleteMutation = useDeleteKeyProvider();
  const keyLabels = useMemo(
    () => Object.fromEntries(provider?.keySummaries.map((row) => [row.keyId, row.keyName]) ?? []),
    [provider?.keySummaries],
  );

  const handleToggleStatus = useCallback(async () => {
    if (!provider) return;
    const newStatus = provider.status === "active" ? "suspended" : "active";
    try {
      await updateMutation.mutateAsync({ id: provider.id, status: newStatus });
      toast.success(t("admin.key-providers.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.update-error"));
    }
  }, [provider, updateMutation, t]);

  const handleDelete = useCallback(async () => {
    if (!provider) return;
    try {
      await deleteMutation.mutateAsync(provider.id);
      toast.success(t("admin.key-providers.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.delete-error"));
    }
  }, [provider, deleteMutation, onClose, t]);

  if (isLoading) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t("admin.key-providers.title")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="flex min-h-[240px] items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </SheetBody>
      </>
    );
  }

  if (isError || !provider) {
    return (
      <>
        <SheetHeader>
          <SheetTitle>{t("admin.key-providers.title")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-3">
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm font-medium">
                  {t("common.error.load-failed", { defaultValue: "Failed to load details." })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {error instanceof Error ? error.message : t("common.valid.unknown-error")}
                </p>
                <Button
                  className="mt-4"
                  size="sm"
                  variant="outline"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                >
                  {t("common.btn.retry", { defaultValue: "Retry" })}
                </Button>
              </CardContent>
            </Card>
          </div>
        </SheetBody>
      </>
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{provider.name}</SheetTitle>
      </SheetHeader>
      <SheetBody>
        <div className="space-y-5">
          {/* Hero Card */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t("admin.key-providers.detail.balance")}
                  </p>
                  <p className="text-2xl font-bold">
                    ${removeTailingZero(provider.balance)}
                    <span className="text-sm text-muted-foreground ml-1">USDC</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {provider.status === "active"
                      ? t("common.status.active")
                      : t("common.status.suspended")}
                  </span>
                  <Switch
                    checked={provider.status === "active"}
                    onCheckedChange={handleToggleStatus}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t("admin.key-providers.detail.info")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                label={t("admin.key-providers.form.share")}
                value={`${provider.revenueSharePercent}%`}
              />
              {provider.email && (
                <InfoRow label={t("admin.key-providers.form.email")} value={provider.email} />
              )}
              {provider.contactInfo && (
                <InfoRow
                  label={t("admin.key-providers.form.contact")}
                  value={provider.contactInfo}
                />
              )}
              <InfoRow
                label={t("admin.key-providers.th.keys", { defaultValue: "Keys" })}
                value={String(provider.keySummaries.length)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {t("admin.key-providers.detail.reconciliation", { defaultValue: "Reconciliation" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                label={t("admin.key-providers.detail.cost", { defaultValue: "Upstream cost" })}
                value={`$${removeTailingZero(provider.totals.upstreamCost)}`}
              />
              <MetricCard
                label={t("admin.key-providers.detail.profit", { defaultValue: "Revenue share" })}
                value={`$${removeTailingZero(provider.totals.revenueShare)}`}
              />
              <MetricCard
                label={t("admin.key-providers.detail.requests", { defaultValue: "Requests" })}
                value={Intl.NumberFormat().format(provider.totals.requests)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {t("admin.key-providers.detail.by-key", { defaultValue: "By key" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 sm:px-6">
              {provider.keySummaries.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground">
                  {t("admin.key-providers.detail.no-keys", {
                    defaultValue: "No keys assigned to this provider.",
                  })}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("common.th.name")}</TableHead>
                        <TableHead>
                          {t("admin.key-providers.detail.cost", { defaultValue: "Upstream cost" })}
                        </TableHead>
                        <TableHead>
                          {t("admin.key-providers.detail.profit", {
                            defaultValue: "Revenue share",
                          })}
                        </TableHead>
                        <TableHead>
                          {t("admin.key-providers.detail.requests", { defaultValue: "Requests" })}
                        </TableHead>
                        <TableHead>{t("common.th.status", { defaultValue: "Status" })}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {provider.keySummaries.map((row) => (
                        <TableRow key={row.keyId}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">{row.keyName}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {row.keyPrefix}
                              </div>
                              {row.lastUsedAt && (
                                <div className="text-xs text-muted-foreground">
                                  {t("admin.key-providers.detail.last-used", {
                                    defaultValue: "Last used {{time}}",
                                    time: formatDistanceToNow(new Date(row.lastUsedAt), {
                                      addSuffix: true,
                                    }),
                                  })}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${removeTailingZero(row.upstreamCost)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            ${removeTailingZero(row.revenueShare)}
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {Intl.NumberFormat().format(row.requests)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs",
                                row.enabled
                                  ? "border-green-500/30 bg-green-500/10 text-green-600"
                                  : "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
                              )}
                            >
                              {row.enabled
                                ? t("common.status.active")
                                : t("common.status.suspended")}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <TransactionList providerId={provider.id} keyLabels={keyLabels} />
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="mr-1 h-4 w-4" />
          {t("common.btn.delete")}
        </Button>
      </SheetFooter>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
