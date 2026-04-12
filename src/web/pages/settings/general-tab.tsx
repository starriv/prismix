import { useCallback } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useAccount, useBalance, useChainId } from "wagmi";
import { z } from "zod";

import { removeTailingZero } from "@/shared/number";
import {
  useAiDefaultMarkup,
  useAiRequestLogging,
  useUpdateAiDefaultMarkup,
  useUpdateAiRequestLogging,
} from "@/web/api/hooks";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { useAdminAuthContext } from "@/web/providers/admin-auth-provider";
import { useChainRegistry } from "@/web/shared/chains";

export function GeneralTab() {
  const { t } = useTranslation();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { admin } = useAdminAuthContext();
  const { getChainDisplay } = useChainRegistry();
  const chainDisplay = getChainDisplay(chainId);
  const chainName = chainDisplay?.name ?? `Chain ${chainId}`;

  return (
    <div
      className="grid gap-6 mt-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" }}
    >
      {/* Account Info Card */}
      {admin && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.admin.title")}</CardTitle>
            <CardDescription>{t("settings.admin.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.admin.name")}</Label>
              <Input readOnly value={admin.name} className="text-xs" />
            </div>
            {admin.email && (
              <div className="space-y-2">
                <Label>{t("auth.email-label")}</Label>
                <Input readOnly value={admin.email} className="text-xs" />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("settings.admin.name")}</Label>
              <Input readOnly value={admin?.name ?? ""} className="text-xs" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Gateway Settings */}
      <AiSettingsCard />

      {/* Wallet Card — only show when wallet is connected */}
      {isConnected && address && (
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.wallet.title")}</CardTitle>
            <CardDescription>{t("settings.wallet.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.wallet.address")}</Label>
              <Input readOnly value={address} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.wallet.chain")}</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={chainName} className="text-xs" />
                <Badge variant="outline" className="whitespace-nowrap">
                  {chainDisplay?.testnet ? t("common.testnet") : t("common.mainnet")}
                </Badge>
              </div>
            </div>
            {balance && (
              <div className="space-y-2">
                <Label>{t("settings.wallet.balance")}</Label>
                <Input
                  readOnly
                  value={`${removeTailingZero(balance.formatted)} ${balance.symbol}`}
                  className="font-mono text-xs"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── AI Settings Card ────────────────────────────────────────────────

const markupSchema = z.object({
  markup: z.number().min(0).max(1000),
});

type MarkupForm = z.infer<typeof markupSchema>;

function AiSettingsCard() {
  const { t } = useTranslation();
  const { data: loggingData } = useAiRequestLogging();
  const updateLogging = useUpdateAiRequestLogging();

  const { data: markupData } = useAiDefaultMarkup();
  const updateMarkup = useUpdateAiDefaultMarkup();

  const serverValue = markupData?.defaultMarkupPercent ?? 0;

  const form = useForm<MarkupForm>({
    resolver: zodResolver(markupSchema),
    values: { markup: serverValue },
  });

  const handleToggleLogging = useCallback(
    (checked: boolean) => {
      updateLogging.mutate(checked);
    },
    [updateLogging],
  );

  const handleSaveMarkup = useCallback(
    (values: MarkupForm) => {
      updateMarkup.mutate(values.markup, {
        onSuccess: () => toast.success(t("settings.ai.default-markup-saved")),
      });
    },
    [updateMarkup, t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.ai.title")}</CardTitle>
        <CardDescription>{t("settings.ai.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>{t("settings.ai.request-logging")}</Label>
            <p className="text-xs text-muted-foreground">{t("settings.ai.request-logging-desc")}</p>
          </div>
          <Switch
            checked={loggingData?.enabled ?? false}
            onCheckedChange={handleToggleLogging}
            disabled={updateLogging.isPending}
          />
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5 flex-1">
              <Label>{t("settings.ai.default-markup")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.ai.default-markup-desc")}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input
                type="number"
                min={0}
                max={1000}
                {...form.register("markup", { valueAsNumber: true })}
                className="w-20 text-xs text-right"
              />
              <span className="text-xs text-muted-foreground">%</span>
              <Button
                size="sm"
                onClick={form.handleSubmit(handleSaveMarkup)}
                disabled={updateMarkup.isPending || !form.formState.isDirty}
              >
                {t("common.btn.save")}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
