import { useCallback } from "react";

import { toast } from "sonner";

import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import type { FiatMethod } from "./constants";

const SAFE_IMAGE_MIME_RE = /^data:image\/(png|jpeg|gif|webp);base64,/;

interface MethodConfigFieldsProps {
  method: FiatMethod;
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
  t: (key: string) => string;
}

export function MethodConfigFields({ method, config, onChange, t }: MethodConfigFieldsProps) {
  function set(key: string, value: string) {
    onChange({ ...config, [key]: value });
  }

  const handleQrCodeUpload = useCallback(
    async (file: File | null) => {
      if (!file) return;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      if (!SAFE_IMAGE_MIME_RE.test(dataUrl)) {
        toast.error(t("fiat.valid.unsupported-image-type"));
        return;
      }

      onChange({ ...config, qrCodeUrl: dataUrl });
    },
    [config, onChange, t],
  );

  const clearQrCode = useCallback(() => {
    const next = { ...config };
    delete next.qrCodeUrl;
    onChange(next);
  }, [config, onChange]);

  // Currency is shared across all methods
  const currencyField = (
    <div className="space-y-2">
      <Label>{t("fiat.form.currency")}</Label>
      <Input
        value={config.currency ?? ""}
        onChange={(e) => set("currency", e.target.value.toUpperCase())}
        placeholder={t("fiat.form.currency-ph")}
      />
    </div>
  );

  if (method === "bank_transfer") {
    return (
      <>
        {currencyField}
        <div className="space-y-2">
          <Label>{t("fiat.form.bank-name")}</Label>
          <Input
            value={config.bankName ?? ""}
            onChange={(e) => set("bankName", e.target.value)}
            placeholder={t("fiat.form.bank-name-ph")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.account-name")}</Label>
          <Input
            value={config.accountName ?? ""}
            onChange={(e) => set("accountName", e.target.value)}
            placeholder={t("fiat.form.account-name-ph")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.account-number")}</Label>
          <Input
            value={config.accountNumber ?? ""}
            onChange={(e) => set("accountNumber", e.target.value)}
            placeholder={t("fiat.form.account-number-ph")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.note")}</Label>
          <Input
            value={config.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
            placeholder={t("fiat.form.note-ph")}
          />
        </div>
      </>
    );
  }

  if (method === "alipay" || method === "wechat") {
    return (
      <>
        {currencyField}
        <div className="space-y-2">
          <Label>{t("fiat.form.account-id")}</Label>
          <Input
            value={config.accountId ?? ""}
            onChange={(e) => set("accountId", e.target.value)}
            placeholder={t("fiat.form.account-id-ph")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.qr-code-url")}</Label>
          <Input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              void handleQrCodeUpload(file);
            }}
          />
          <p className="text-xs text-muted-foreground">{t("fiat.form.qr-code-upload-hint")}</p>
          {config.qrCodeUrl ? (
            <div className="space-y-3">
              <div className="flex justify-center rounded-xl border border-border/70 bg-muted/20 p-4">
                <img
                  src={config.qrCodeUrl}
                  alt={t("fiat.form.qr-code-preview-alt")}
                  className="max-h-48 rounded-lg object-contain"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={clearQrCode}>
                {t("fiat.btn.delete")}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.note")}</Label>
          <Input
            value={config.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
            placeholder={t("fiat.form.note-ph")}
          />
        </div>
      </>
    );
  }

  if (method === "paypal") {
    return (
      <>
        {currencyField}
        <div className="space-y-2">
          <Label>{t("fiat.form.email")}</Label>
          <Input
            type="email"
            value={config.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
            placeholder={t("fiat.form.email-ph")}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("fiat.form.note")}</Label>
          <Input
            value={config.note ?? ""}
            onChange={(e) => set("note", e.target.value)}
            placeholder={t("fiat.form.note-ph")}
          />
        </div>
      </>
    );
  }

  return null;
}
