import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { removeTailingZero } from "@/shared/number";
import { useDeleteKeyProvider, useUpdateKeyProvider } from "@/web/api/hooks";
import type { KeyProvider } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { SheetBody, SheetFooter, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";

import { TransactionList } from "./transaction-list";

export function KeyProviderDetailSheet({
  provider,
  onClose,
}: {
  provider: KeyProvider;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const updateMutation = useUpdateKeyProvider();
  const deleteMutation = useDeleteKeyProvider();

  const handleToggleStatus = useCallback(async () => {
    const newStatus = provider.status === "active" ? "suspended" : "active";
    try {
      await updateMutation.mutateAsync({ id: provider.id, status: newStatus });
      toast.success(t("admin.key-providers.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.update-error"));
    }
  }, [provider, updateMutation, t]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync(provider.id);
      toast.success(t("admin.key-providers.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("admin.key-providers.toast.delete-error"));
    }
  }, [provider, deleteMutation, onClose, t]);

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
            </CardContent>
          </Card>

          {/* Recent Transactions */}
          <TransactionList providerId={provider.id} />
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
