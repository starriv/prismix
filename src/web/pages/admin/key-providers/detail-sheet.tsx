import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { BarChart3, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useDeleteKeyProvider, useKeyProviderSummary, useUpdateKeyProvider } from "@/web/api/hooks";
import { LocaleLink } from "@/web/components/locale-link";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { SheetBody, SheetFooter, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";

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
  } = useKeyProviderSummary(providerId);
  const updateMutation = useUpdateKeyProvider();
  const deleteMutation = useDeleteKeyProvider();

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
                value={String(provider.keyCount)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {t("admin.key-providers.detail.reconciliation", { defaultValue: "Reconciliation" })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                label={t("admin.key-providers.detail.cost", { defaultValue: "Upstream cost" })}
                value={`$${removeTailingZero(provider.totals.upstreamCost)}`}
              />
              <InfoRow
                label={t("admin.key-providers.detail.profit", { defaultValue: "Revenue share" })}
                value={`$${removeTailingZero(provider.totals.revenueShare)}`}
              />
              <InfoRow
                label={t("admin.key-providers.detail.requests", { defaultValue: "Requests" })}
                value={Intl.NumberFormat().format(provider.totals.requests)}
              />
            </CardContent>
          </Card>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button variant="outline" size="sm" asChild>
          <LocaleLink to={`/admin/key-provider-usage-detail?id=${provider.id}`}>
            <BarChart3 className="mr-1 h-4 w-4" />
            {t("admin.key-providers.detail.open-report", { defaultValue: "Open report" })}
          </LocaleLink>
        </Button>
        <Button variant="destructive" size="sm" onClick={handleDelete}>
          <Trash2 className="mr-1 h-4 w-4" />
          {t("common.btn.delete")}
        </Button>
      </SheetFooter>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
