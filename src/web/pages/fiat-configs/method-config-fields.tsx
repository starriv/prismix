import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";

import type { FiatMethod } from "./constants";

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

  if (method === "bank_transfer") {
    return (
      <>
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
            value={config.qrCodeUrl ?? ""}
            onChange={(e) => set("qrCodeUrl", e.target.value)}
            placeholder={t("fiat.form.qr-code-url-ph")}
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

  if (method === "paypal") {
    return (
      <>
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
