import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiProviders,
  useCreateAiProvider,
  useDeleteAiProvider,
  useUpdateAiProvider,
} from "@/web/api/hooks";
import type { AiProvider } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader } from "@/web/components/ui/card";
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
import { Skeleton } from "@/web/components/ui/skeleton";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

// ── AWS Bedrock regions (runtime endpoints) ─────────────────────────

const BEDROCK_REGIONS = [
  { code: "us-east-1", label: "US East (N. Virginia)" },
  { code: "us-east-2", label: "US East (Ohio)" },
  { code: "us-west-2", label: "US West (Oregon)" },
  { code: "ap-south-1", label: "Asia Pacific (Mumbai)" },
  { code: "ap-south-2", label: "Asia Pacific (Hyderabad)" },
  { code: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  { code: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
  { code: "ap-northeast-3", label: "Asia Pacific (Osaka)" },
  { code: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { code: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
  { code: "ca-central-1", label: "Canada (Central)" },
  { code: "eu-central-1", label: "Europe (Frankfurt)" },
  { code: "eu-central-2", label: "Europe (Zurich)" },
  { code: "eu-west-1", label: "Europe (Ireland)" },
  { code: "eu-west-2", label: "Europe (London)" },
  { code: "eu-west-3", label: "Europe (Paris)" },
  { code: "eu-south-1", label: "Europe (Milan)" },
  { code: "eu-south-2", label: "Europe (Spain)" },
  { code: "eu-north-1", label: "Europe (Stockholm)" },
  { code: "sa-east-1", label: "South America (São Paulo)" },
  { code: "us-gov-east-1", label: "AWS GovCloud (US-East)" },
  { code: "us-gov-west-1", label: "AWS GovCloud (US-West)" },
] as const;

// ── Form schema ──────────────────────────────────────────────────────

const providerFormSchema = z
  .object({
    providerId: z.string().min(1, "common.valid.required"),
    name: z.string().min(1, "common.valid.name-required"),
    baseUrl: z.string().url("common.valid.invalid-url"),
    apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]),
    authType: z.enum(["bearer", "api-key", "sigv4"]),
    enabled: z.boolean(),
    sigv4Region: z.string().optional(),
    sigv4AccessKeyId: z.string().optional(),
  })
  .refine((d) => d.apiFormat !== "bedrock" || !!d.sigv4Region, {
    message: "common.valid.required",
    path: ["sigv4Region"],
  })
  .refine((d) => d.authType !== "sigv4" || !!d.sigv4AccessKeyId, {
    message: "common.valid.required",
    path: ["sigv4AccessKeyId"],
  });
type ProviderFormValues = z.infer<typeof providerFormSchema>;

// ── Page ─────────────────────────────────────────────────────────────

export default function AiProvidersPage() {
  const { t } = useTranslation();
  const { data: providers = [], isLoading } = useAiProviders();
  const updateProvider = useUpdateAiProvider();
  const deleteProvider = useDeleteAiProvider();

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiProvider | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProvider | null>(null);

  const handleToggle = useCallback(
    async (p: AiProvider) => {
      try {
        await updateProvider.mutateAsync({
          id: p.id,
          enabled: !p.enabled,
        });
        toast.success(t("ai-providers.toast.updated"));
      } catch {
        toast.error(t("ai-providers.toast.update-error"));
      }
    },
    [updateProvider, t],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteProvider.mutateAsync(deleteTarget.id);
      toast.success(t("ai-providers.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai-providers.toast.delete-error"));
    }
  }, [deleteTarget, deleteProvider, t]);

  return (
    <div>
      <Header title={t("ai-providers.title")} description={t("ai-providers.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Button size="sm" onClick={() => setAddOpen(true)} className="ml-auto">
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-providers.btn.new")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : providers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("ai-providers.empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("ai-providers.th.name")}</TableHead>
                    <TableHead>{t("ai-providers.th.provider-id")}</TableHead>
                    <TableHead>{t("ai-providers.th.api-format")}</TableHead>
                    <TableHead>{t("ai-providers.th.auth-type")}</TableHead>
                    <TableHead>{t("ai-providers.th.enabled")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {p.providerId}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.apiFormat}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{p.authType}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={p.enabled}
                          onCheckedChange={() => handleToggle(p)}
                          disabled={updateProvider.isPending}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditTarget(p)}
                            aria-label={t("common.btn.edit")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(p)}
                            aria-label={t("common.btn.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ProviderFormDialog open={addOpen} onOpenChange={setAddOpen} />

      <ProviderFormDialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
        provider={editTarget}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-providers.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-providers.dialog.delete-body", { name: deleteTarget?.name })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteProvider.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Provider Form Dialog ─────────────────────────────────────────────

function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider?: AiProvider | null;
}) {
  const { t } = useTranslation();
  const createProvider = useCreateAiProvider();
  const updateProvider = useUpdateAiProvider();
  const isEdit = !!provider;

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      providerId: "",
      name: "",
      baseUrl: "",
      apiFormat: "openai",
      authType: "bearer",
      enabled: true,
      sigv4Region: "",
      sigv4AccessKeyId: "",
    },
  });

  useEffect(() => {
    if (open && provider) {
      const ac = (provider.authConfig ?? {}) as Record<string, unknown>;
      form.reset({
        providerId: provider.providerId,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiFormat: provider.apiFormat as ProviderFormValues["apiFormat"],
        authType: provider.authType as ProviderFormValues["authType"],
        enabled: provider.enabled,
        sigv4Region: (ac.region as string) ?? "",
        sigv4AccessKeyId: (ac.accessKeyId as string) ?? "",
      });
    } else if (open) {
      form.reset({
        providerId: "",
        name: "",
        baseUrl: "",
        apiFormat: "openai",
        authType: "bearer",
        enabled: true,
        sigv4Region: "",
        sigv4AccessKeyId: "",
      });
    }
  }, [open, provider, form]);

  // Auto-link: Bedrock apiFormat → default region + baseUrl
  const watchedApiFormat = form.watch("apiFormat");
  const watchedRegion = form.watch("sigv4Region");

  useEffect(() => {
    if (watchedApiFormat === "bedrock" && !form.getValues("sigv4Region")) {
      form.setValue("sigv4Region", "us-east-1");
    }
  }, [watchedApiFormat, form]);

  useEffect(() => {
    if (watchedApiFormat === "bedrock" && watchedRegion) {
      form.setValue("baseUrl", `https://bedrock-runtime.${watchedRegion}.amazonaws.com`);
    }
  }, [watchedApiFormat, watchedRegion, form]);

  const handleSubmit = form.handleSubmit(async (data) => {
    const { sigv4Region, sigv4AccessKeyId, ...rest } = data;

    let authConfig: Record<string, unknown> | undefined;
    if (data.authType === "sigv4" && sigv4Region) {
      authConfig = {
        region: sigv4Region,
        service: "bedrock",
        ...(sigv4AccessKeyId ? { accessKeyId: sigv4AccessKeyId } : {}),
      };
    } else if (data.apiFormat === "bedrock" && sigv4Region) {
      authConfig = { region: sigv4Region };
    }

    try {
      if (isEdit) {
        await updateProvider.mutateAsync({ id: provider.id, ...rest, authConfig });
        toast.success(t("ai-providers.toast.updated"));
      } else {
        await createProvider.mutateAsync({ ...rest, authConfig });
        toast.success(t("ai-providers.toast.created"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-providers.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("ai-providers.dialog.edit-title") : t("ai-providers.dialog.add-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="providerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.provider-id")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("ai-providers.form.provider-id-ph")}
                        {...field}
                        disabled={isEdit}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-providers.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="baseUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.base-url")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-providers.form.base-url-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="apiFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.api-format")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="gemini">Gemini</SelectItem>
                        <SelectItem value="azure-openai">Azure OpenAI</SelectItem>
                        <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="authType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.auth-type")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bearer">Bearer</SelectItem>
                        <SelectItem value="api-key">API Key</SelectItem>
                        <SelectItem value="sigv4">AWS SigV4</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.watch("apiFormat") === "bedrock" && (
                <FormField
                  control={form.control}
                  name="sigv4Region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.form.sigv4-region")}</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("ai-providers.form.sigv4-region-ph")} />
                        </SelectTrigger>
                        <SelectContent>
                          {BEDROCK_REGIONS.map((r) => (
                            <SelectItem key={r.code} value={r.code}>
                              {r.code} — {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-providers.form.sigv4-region-hint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {form.watch("authType") === "sigv4" && (
                <FormField
                  control={form.control}
                  name="sigv4AccessKeyId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.form.sigv4-access-key-id")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("ai-providers.form.sigv4-access-key-id-ph")}
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-providers.form.sigv4-access-key-id-hint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createProvider.isPending || updateProvider.isPending}>
                {isEdit ? t("common.btn.save") : t("ai-providers.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
