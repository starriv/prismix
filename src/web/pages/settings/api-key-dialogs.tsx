import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { useCreateApiKey } from "@/web/api/hooks";
import type { ApiKeyWithSecret } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import {
  DialogBody,
  DialogContent,
  DialogDescription,
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
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

// ── Create Key Dialog Content ────────────────────────────────────────

const createKeyFormSchema = z.object({
  name: z.string().min(1, "common.valid.name-required").max(100),
  expiresInDays: z.string(),
});

type CreateKeyFormValues = z.infer<typeof createKeyFormSchema>;

interface CreateKeyDialogContentProps {
  onSuccess: (key: ApiKeyWithSecret) => void;
}

export function CreateKeyDialogContent({ onSuccess }: CreateKeyDialogContentProps) {
  const { t } = useTranslation();
  const createApiKey = useCreateApiKey();

  const form = useForm<CreateKeyFormValues>({
    resolver: zodResolver(createKeyFormSchema),
    defaultValues: {
      name: "",
      expiresInDays: "never",
    },
  });

  const handleSubmit = useCallback(
    async (values: CreateKeyFormValues) => {
      try {
        const body: { name: string; expiresInDays?: number } = { name: values.name };
        if (values.expiresInDays !== "never") {
          body.expiresInDays = Number(values.expiresInDays);
        }
        const result = await createApiKey.mutateAsync(body);
        toast.success(t("settings.api-keys.toast.created"));
        form.reset();
        onSuccess(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(message);
      }
    },
    [createApiKey, t, form, onSuccess],
  );

  const onSubmit = form.handleSubmit(handleSubmit);

  return (
    <DialogContent preventClose>
      <DialogHeader>
        <DialogTitle>{t("settings.api-keys.btn.create")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <Form {...form}>
          <form id="create-api-key-form" onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.api-keys.form.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("settings.api-keys.form.name-ph")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="expiresInDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.api-keys.form.expiration")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">{t("settings.api-keys.form.exp-never")}</SelectItem>
                      <SelectItem value="30">{t("settings.api-keys.form.exp-30d")}</SelectItem>
                      <SelectItem value="90">{t("settings.api-keys.form.exp-90d")}</SelectItem>
                      <SelectItem value="365">{t("settings.api-keys.form.exp-1y")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </DialogBody>
      <DialogFooter>
        <Button
          type="submit"
          form="create-api-key-form"
          disabled={createApiKey.isPending}
          size="sm"
        >
          {createApiKey.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {t("settings.api-keys.btn.create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Secret Display Dialog Content ────────────────────────────────────

interface SecretDisplayDialogContentProps {
  apiKey: ApiKeyWithSecret;
  onClose: () => void;
}

export function SecretDisplayDialogContent({ apiKey, onClose }: SecretDisplayDialogContentProps) {
  const { t } = useTranslation();
  const [copiedField, setCopiedField] = useState<"clientId" | "secret" | null>(null);

  const handleCopyClientId = useCallback(() => {
    navigator.clipboard.writeText(apiKey.clientId);
    setCopiedField("clientId");
    toast.success(t("settings.api-keys.toast.copied"));
    setTimeout(() => setCopiedField(null), 2000);
  }, [apiKey.clientId, t]);

  const handleCopySecret = useCallback(() => {
    navigator.clipboard.writeText(apiKey.secret);
    setCopiedField("secret");
    toast.success(t("common.copied"));
    setTimeout(() => setCopiedField(null), 2000);
  }, [apiKey.secret, t]);

  return (
    <DialogContent preventClose>
      <DialogHeader>
        <DialogTitle>{t("settings.api-keys.created.title")}</DialogTitle>
        <DialogDescription>
          <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("settings.api-keys.created.warn")}
          </span>
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {/* Client ID */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("settings.api-keys.created.client-id")}
          </Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={apiKey.clientId} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleCopyClientId}
              aria-label={t("common.a11y.copy")}
            >
              {copiedField === "clientId" ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Secret */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("settings.api-keys.created.secret")}
          </Label>
          <div className="flex items-center gap-2">
            <Input readOnly value={apiKey.secret} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleCopySecret}
              aria-label={t("common.a11y.copy")}
            >
              {copiedField === "secret" ? (
                <Check className="h-3.5 w-3.5 text-green-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Usage Example */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {t("settings.api-keys.created.usage")}
          </Label>
          <pre className="font-mono text-xs bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre">
            <code>{`curl -H "Authorization: Bearer ${apiKey.secret}" \\
  https://your-gateway.com/api/admin/resources`}</code>
          </pre>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose} size="sm">
          {t("settings.api-keys.created.btn-saved")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Confirm Action Dialog Content ────────────────────────────────────

interface ConfirmActionDialogContentProps {
  type: "revoke" | "rotate" | "delete";
  keyName: string;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialogContent({
  type,
  keyName,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmActionDialogContentProps) {
  const { t } = useTranslation();

  const titles: Record<string, string> = {
    revoke: t("settings.api-keys.confirm-revoke.title"),
    rotate: t("settings.api-keys.confirm-rotate.title"),
    delete: t("settings.api-keys.confirm-delete.title"),
  };

  const descriptions: Record<string, string> = {
    revoke: t("settings.api-keys.confirm-revoke.desc"),
    rotate: t("settings.api-keys.confirm-rotate.desc"),
    delete: t("settings.api-keys.confirm-delete.desc"),
  };

  const isDestructive = type === "revoke" || type === "delete";

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{titles[type]}</DialogTitle>
        <DialogDescription>{descriptions[type]}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <p className="text-sm">
          <span className="text-muted-foreground">Key: </span>
          <span className="font-medium">{keyName}</span>
        </p>
      </DialogBody>
      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isPending}>
          {t("common.btn.cancel")}
        </Button>
        <Button
          variant={isDestructive ? "destructive" : "default"}
          size="sm"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {t("common.btn.confirm")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
