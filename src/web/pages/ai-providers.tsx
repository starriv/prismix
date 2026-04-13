import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiProviders,
  useAiProviderUpstreams,
  useCreateAiProvider,
  useCreateAiProviderUpstream,
  useDeleteAiProvider,
  useDeleteAiProviderUpstream,
  useUpdateAiProvider,
  useUpdateAiProviderUpstream,
} from "@/web/api/hooks";
import type { AiProvider, AiProviderUpstream } from "@/web/api/schemas";
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
    upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]),
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

const upstreamFormSchema = z.object({
  upstreamId: z
    .string()
    .min(1, "common.valid.required")
    .regex(/^[a-z0-9-]+$/, "common.valid.required"),
  name: z.string().min(1, "common.valid.name-required"),
  baseUrl: z.string().url("common.valid.invalid-url"),
  kind: z.enum(["official", "reseller", "openrouter", "custom"]),
  priority: z.coerce.number().int().min(0).max(10_000),
  weight: z.coerce.number().int().min(0).max(100),
  enabled: z.boolean(),
});
type UpstreamFormInput = z.input<typeof upstreamFormSchema>;
type UpstreamFormValues = z.output<typeof upstreamFormSchema>;

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
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("ai-providers.btn.new")}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : providers.length === 0 ? (
          <Card>
            <CardContent>
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("ai-providers.empty")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <Card key={provider.id}>
                <CardHeader>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{provider.name}</h3>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {provider.providerId}
                        </Badge>
                        <Badge variant="outline">{provider.apiFormat}</Badge>
                        <Badge variant="outline">{provider.authType}</Badge>
                        <Badge variant="outline">
                          {provider.upstreamRoutingStrategy === "weighted-random"
                            ? t("ai-providers.strategy.weighted-random")
                            : t("ai-providers.strategy.priority")}
                        </Badge>
                      </div>
                      <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide">
                            {t("ai-providers.form.base-url")}
                          </div>
                          <div className="font-mono text-xs text-foreground break-all">
                            {provider.baseUrl}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide">
                            {t("ai-providers.th.api-format")}
                          </div>
                          <div className="text-foreground">{provider.apiFormat}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide">
                            {t("ai-providers.th.auth-type")}
                          </div>
                          <div className="text-foreground">{provider.authType}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide">
                            {t("ai-providers.th.routing")}
                          </div>
                          <div className="text-foreground">
                            {provider.upstreamRoutingStrategy === "weighted-random"
                              ? t("ai-providers.strategy.weighted-random")
                              : t("ai-providers.strategy.priority")}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start">
                      <Switch
                        checked={provider.enabled}
                        onCheckedChange={() => handleToggle(provider)}
                        disabled={updateProvider.isPending}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditTarget(provider)}
                        aria-label={t("common.btn.edit")}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        {t("common.btn.edit")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTarget(provider)}
                        aria-label={t("common.btn.delete")}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
                        {t("common.btn.delete")}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ProviderUpstreamsSection provider={provider} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
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
      upstreamRoutingStrategy: "priority",
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
        upstreamRoutingStrategy:
          provider.upstreamRoutingStrategy === "weighted-random" ? "weighted-random" : "priority",
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
        upstreamRoutingStrategy: "priority",
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
                name="upstreamRoutingStrategy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.form.upstream-routing-strategy")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority">
                          {t("ai-providers.strategy.priority")}
                        </SelectItem>
                        <SelectItem value="weighted-random">
                          {t("ai-providers.strategy.weighted-random")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {t("ai-providers.form.upstream-routing-strategy-hint")}
                    </p>
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

function ProviderUpstreamsSection({ provider }: { provider: AiProvider }) {
  const { t } = useTranslation();
  const { data: upstreams = [], isLoading } = useAiProviderUpstreams(provider.id);
  const updateUpstream = useUpdateAiProviderUpstream();
  const deleteUpstream = useDeleteAiProviderUpstream();

  const [editTarget, setEditTarget] = useState<AiProviderUpstream | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiProviderUpstream | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sortedUpstreams = useMemo(
    () =>
      [...upstreams].sort(
        (a, b) => a.priority - b.priority || b.weight - a.weight || a.name.localeCompare(b.name),
      ),
    [upstreams],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteUpstream.mutateAsync({ providerId: provider.id, id: deleteTarget.id });
      toast.success(t("ai-providers.toast.upstream-deleted"));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("ai-providers.toast.upstream-delete-error"),
      );
    }
  }, [deleteTarget, deleteUpstream, provider, t]);

  return (
    <>
      <div className="space-y-4 border-t pt-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">{t("ai-providers.upstreams.section-title")}</div>
            <div className="text-sm text-muted-foreground">{t("ai-providers.upstreams.desc")}</div>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("ai-providers.btn.new-upstream")}
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : sortedUpstreams.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t("ai-providers.upstreams.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("ai-providers.upstreams.th.name")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.upstream-id")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.kind")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.base-url")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.priority")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.weight")}</TableHead>
                <TableHead>{t("ai-providers.upstreams.th.enabled")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedUpstreams.map((upstream) => (
                <TableRow key={upstream.id}>
                  <TableCell className="font-medium">{upstream.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-mono text-xs">
                      {upstream.upstreamId}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{upstream.kind}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate font-mono text-xs">
                    {upstream.baseUrl}
                  </TableCell>
                  <TableCell>{upstream.priority}</TableCell>
                  <TableCell>{upstream.weight}</TableCell>
                  <TableCell>
                    <Switch
                      checked={upstream.enabled}
                      onCheckedChange={(enabled) => {
                        updateUpstream
                          .mutateAsync({ providerId: provider.id, id: upstream.id, enabled })
                          .then(() => toast.success(t("ai-providers.toast.upstream-updated")))
                          .catch((err) =>
                            toast.error(
                              err instanceof Error
                                ? err.message
                                : t("ai-providers.toast.upstream-update-error"),
                            ),
                          );
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(upstream)}
                        aria-label={t("common.btn.edit")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(upstream)}
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
      </div>

      <UpstreamFormDialog provider={provider} open={createOpen} onOpenChange={setCreateOpen} />

      <UpstreamFormDialog
        provider={provider}
        upstream={editTarget}
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-providers.dialog.delete-upstream-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-providers.dialog.delete-upstream-body", {
                name: deleteTarget?.name ?? "",
              })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteUpstream.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UpstreamFormDialog({
  provider,
  upstream,
  open,
  onOpenChange,
}: {
  provider: AiProvider | null;
  upstream?: AiProviderUpstream | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const createUpstream = useCreateAiProviderUpstream();
  const updateUpstream = useUpdateAiProviderUpstream();
  const isEdit = !!upstream;

  const form = useForm<UpstreamFormInput, unknown, UpstreamFormValues>({
    resolver: zodResolver(upstreamFormSchema),
    defaultValues: {
      upstreamId: "",
      name: "",
      baseUrl: "",
      kind: "custom",
      priority: 100,
      weight: 1,
      enabled: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    if (upstream) {
      form.reset({
        upstreamId: upstream.upstreamId,
        name: upstream.name,
        baseUrl: upstream.baseUrl,
        kind: upstream.kind as UpstreamFormValues["kind"],
        priority: upstream.priority,
        weight: upstream.weight,
        enabled: upstream.enabled,
      });
      return;
    }
    form.reset({
      upstreamId: "",
      name: "",
      baseUrl: provider?.baseUrl ?? "",
      kind: "custom",
      priority: 100,
      weight: 1,
      enabled: true,
    });
  }, [form, open, provider?.baseUrl, upstream]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!provider) return;
    try {
      if (upstream) {
        await updateUpstream.mutateAsync({ providerId: provider.id, id: upstream.id, ...values });
        toast.success(t("ai-providers.toast.upstream-updated"));
      } else {
        await createUpstream.mutateAsync({ providerId: provider.id, ...values });
        toast.success(t("ai-providers.toast.upstream-created"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isEdit
            ? t("ai-providers.toast.upstream-update-error")
            : t("ai-providers.toast.upstream-create-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t("ai-providers.dialog.edit-upstream-title")
              : t("ai-providers.dialog.add-upstream-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="upstreamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.upstreams.form.upstream-id")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("ai-providers.upstreams.form.upstream-id-ph")}
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
                    <FormLabel>{t("ai-providers.upstreams.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-providers.upstreams.form.name-ph")} {...field} />
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
                    <FormLabel>{t("ai-providers.upstreams.form.base-url")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("ai-providers.upstreams.form.base-url-ph")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.upstreams.form.kind")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="official">
                            {t("ai-providers.upstreams.kind.official")}
                          </SelectItem>
                          <SelectItem value="reseller">
                            {t("ai-providers.upstreams.kind.reseller")}
                          </SelectItem>
                          <SelectItem value="openrouter">
                            {t("ai-providers.upstreams.kind.openrouter")}
                          </SelectItem>
                          <SelectItem value="custom">
                            {t("ai-providers.upstreams.kind.custom")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.upstreams.form.priority")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={10000}
                          value={typeof field.value === "number" ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value)}
                          name={field.name}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="weight"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.upstreams.form.weight")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={typeof field.value === "number" ? field.value : ""}
                          onChange={(e) => field.onChange(e.target.value)}
                          name={field.name}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>{t("ai-providers.upstreams.form.enabled")}</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createUpstream.isPending || updateUpstream.isPending}>
                {isEdit ? t("common.btn.save") : t("ai-providers.btn.create-upstream")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
