import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { groupBy, orderBy } from "lodash-es";
import {
  Activity,
  ArrowLeft,
  Key,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiProviderAssignments,
  useAiProviderKeys,
  useAiProviders,
  useAiUpstreams,
  useCreateAiKey,
  useCreateAiProvider,
  useCreateAiProviderAssignment,
  useDeleteAiKey,
  useDeleteAiProvider,
  useDeleteAiProviderAssignment,
  useKeyProviders,
  useTestAiKey,
  useUpdateAiKey,
  useUpdateAiProvider,
  useUpdateAiProviderAssignment,
} from "@/web/api/hooks";
import type { AiKey, AiProvider, AiUpstreamAssignment } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { CopyableText } from "@/web/components/ui/copyable-text";
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
import { SecretInput } from "@/web/components/ui/secret-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Skeleton } from "@/web/components/ui/skeleton";
import { Switch } from "@/web/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { cn } from "@/web/shared/utils";

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

// ── Form schemas ────────────────────────────────────────────────────

const providerFormSchema = z
  .object({
    providerId: z.string().min(1, "common.valid.required"),
    name: z.string().min(1, "common.valid.name-required"),
    baseUrl: z.string().url("common.valid.invalid-url"),
    apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]),
    authType: z.enum(["bearer", "api-key", "sigv4", "cloudflare"]),
    upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]),
    enabled: z.boolean(),
    sigv4Region: z.string().optional(),
    sigv4AccessKeyId: z.string().optional(),
    cloudflareClientId: z.string().optional(),
  })
  .refine((d) => d.apiFormat !== "bedrock" || !!d.sigv4Region, {
    message: "common.valid.required",
    path: ["sigv4Region"],
  })
  .refine((d) => d.authType !== "sigv4" || !!d.sigv4AccessKeyId, {
    message: "common.valid.required",
    path: ["sigv4AccessKeyId"],
  })
  .refine((d) => d.authType !== "cloudflare" || !!d.cloudflareClientId?.trim(), {
    message: "common.valid.required",
    path: ["cloudflareClientId"],
  });
type ProviderFormValues = z.infer<typeof providerFormSchema>;

const assignUpstreamFormSchema = z.object({
  upstreamId: z.coerce.number().min(1, "common.valid.required"),
  priority: z.coerce.number().int().min(0).max(10_000),
  weight: z.coerce.number().int().min(0).max(100),
  enabled: z.boolean(),
});
type AssignUpstreamFormInput = z.input<typeof assignUpstreamFormSchema>;
type AssignUpstreamFormValues = z.output<typeof assignUpstreamFormSchema>;

const editAssignmentFormSchema = z.object({
  priority: z.coerce.number().int().min(0).max(10_000),
  weight: z.coerce.number().int().min(0).max(100),
  enabled: z.boolean(),
});
type EditAssignmentFormInput = z.input<typeof editAssignmentFormSchema>;
type EditAssignmentFormValues = z.output<typeof editAssignmentFormSchema>;

// ── Page ────────────────────────────────────────────────────────────

export default function AiProvidersPage() {
  const { t } = useTranslation();
  const { data: providers = [], isLoading } = useAiProviders();
  const [selectedId, setSelectedId] = useQueryState("providerId", parseAsInteger);

  const [addOpen, setAddOpen] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedId) ?? null;

  const handleBack = useCallback(() => setSelectedId(null), [setSelectedId]);
  const handleSelect = useCallback((p: AiProvider) => setSelectedId(p.id), [setSelectedId]);

  return (
    <div>
      <Header title={t("ai-providers.title")} description={t("ai-providers.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {selectedProvider ? (
          <ProviderDetail provider={selectedProvider} onBack={handleBack} />
        ) : (
          <>
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-providers.btn.new")}
              </Button>
            </div>
            <ProviderGrid providers={providers} loading={isLoading} onSelect={handleSelect} />
          </>
        )}
      </div>

      <ProviderFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ── Provider Grid ───────────────────────────────────────────────────

function ProviderGrid({
  providers,
  loading,
  onSelect,
}: {
  providers: AiProvider[];
  loading: boolean;
  onSelect: (p: AiProvider) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-4 w-48 mb-2" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </Card>
        ))}
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Server className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("ai-providers.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          upstreamCount={provider.upstreamCount ?? 0}
          onClick={() => onSelect(provider)}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  upstreamCount,
  onClick,
}: {
  provider: AiProvider;
  upstreamCount: number;
  onClick: () => void;
}) {
  const { t } = useTranslation();

  const upstreamLabel =
    upstreamCount > 0
      ? t("ai-providers.card.upstreams", { count: upstreamCount })
      : t("ai-providers.card.no-upstreams");

  return (
    <button
      type="button"
      className={cn(
        "block w-full rounded-xl text-left touch-manipulation",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      onClick={onClick}
      aria-label={t("ai-providers.card.open-provider", { name: provider.name })}
    >
      <Card
        className={cn(
          "h-full transition-[box-shadow,border-color,opacity] hover:shadow-md hover:border-primary/30",
          "flex flex-col justify-between",
          !provider.enabled && "opacity-60",
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {provider.iconUrl ? (
                <img
                  src={provider.iconUrl}
                  alt={provider.name}
                  className="h-8 w-8 rounded-md object-contain"
                  width={32}
                  height={32}
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
                </div>
              )}
              <h3 className="truncate text-sm font-semibold">{provider.name}</h3>
            </div>
            <div
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                provider.enabled ? "bg-green-500" : "bg-yellow-500",
              )}
              title={provider.enabled ? t("common.status.active") : t("common.status.disabled")}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4 pt-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-xs">
              {provider.apiFormat}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {provider.authType}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Server aria-hidden="true" className="h-3 w-3 shrink-0" />
            <span>{upstreamLabel}</span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

// ── Provider Detail ─────────────────────────────────────────────────

function ProviderDetail({ provider, onBack }: { provider: AiProvider; onBack: () => void }) {
  const { t } = useTranslation();
  const updateProvider = useUpdateAiProvider();
  const deleteProvider = useDeleteAiProvider();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleToggle = useCallback(async () => {
    try {
      await updateProvider.mutateAsync({ id: provider.id, enabled: !provider.enabled });
      toast.success(t("ai-providers.toast.updated"));
    } catch {
      toast.error(t("ai-providers.toast.update-error"));
    }
  }, [updateProvider, provider, t]);

  const handleConfirmDelete = useCallback(async () => {
    try {
      await deleteProvider.mutateAsync(provider.id);
      toast.success(t("ai-providers.toast.deleted"));
      onBack();
    } catch {
      toast.error(t("ai-providers.toast.delete-error"));
    }
  }, [deleteProvider, provider, onBack, t]);

  return (
    <>
      {/* Info Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label={t("common.btn.back")}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {provider.iconUrl ? (
                <img
                  src={provider.iconUrl}
                  alt={provider.name}
                  className="h-6 w-6 rounded object-contain"
                  width={24}
                  height={24}
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <CardTitle className="text-base">{provider.name}</CardTitle>
              <Badge variant="secondary" className="font-mono text-xs">
                {provider.providerId}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={provider.enabled}
                onCheckedChange={handleToggle}
                disabled={updateProvider.isPending}
              />
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t("common.btn.edit")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
                {t("common.btn.delete")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-providers.form.base-url")}
              </div>
              <div className="font-mono text-xs break-all">{provider.baseUrl}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-providers.th.api-format")}
              </div>
              <div>{provider.apiFormat}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-providers.th.auth-type")}
              </div>
              <div>{provider.authType}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-providers.th.routing")}
              </div>
              <div>
                {provider.upstreamRoutingStrategy === "weighted-random"
                  ? t("ai-providers.strategy.weighted-random")
                  : t("ai-providers.strategy.priority")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upstreams */}
      <ProviderUpstreamsSection provider={provider} />

      {/* Key Pools */}
      <ProviderKeyBucketsSection provider={provider} />

      {/* Edit dialog */}
      <ProviderFormDialog open={editOpen} onOpenChange={setEditOpen} provider={provider} />

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-providers.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-providers.dialog.delete-body", { name: provider.name })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
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
    </>
  );
}

// ── Provider Upstreams Section ───────────────────────────────────────

function ProviderUpstreamsSection({ provider }: { provider: AiProvider }) {
  const { t } = useTranslation();
  const { data: assignments = [], isLoading } = useAiProviderAssignments(provider.id);
  const updateAssignment = useUpdateAiProviderAssignment();
  const deleteAssignment = useDeleteAiProviderAssignment();

  const [editTarget, setEditTarget] = useState<AiUpstreamAssignment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiUpstreamAssignment | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const sortedAssignments = useMemo(
    () =>
      [...assignments].sort(
        (a, b) =>
          a.priority - b.priority ||
          b.weight - a.weight ||
          a.upstream.name.localeCompare(b.upstream.name),
      ),
    [assignments],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteAssignment.mutateAsync({
        providerId: provider.id,
        assignmentId: deleteTarget.id,
      });
      toast.success(t("ai-providers.toast.upstream-deleted"));
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-providers.toast.upstream-delete-error"),
      );
    }
  }, [deleteTarget, deleteAssignment, provider, t]);

  const columns = useMemo<ColumnDef<AiUpstreamAssignment>[]>(
    () => [
      {
        accessorFn: (a) => a.upstream.name,
        id: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.upstream.name}</DataTableText>
        ),
        header: t("ai-providers.upstreams.th.name"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorFn: (a) => a.upstream.upstreamId,
        id: "upstreamId",
        cell: ({ row }) => (
          <CopyableText
            value={row.original.upstream.upstreamId}
            className="font-mono text-xs break-all"
          >
            {row.original.upstream.upstreamId}
          </CopyableText>
        ),
        header: t("ai-providers.upstreams.th.upstream-id"),
        meta: { headerClassName: "w-[26%]" },
      },
      {
        accessorFn: (a) => a.upstream.kind,
        id: "kind",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">{row.original.upstream.kind}</DataTableBadge>
        ),
        header: t("ai-providers.upstreams.th.kind"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        accessorFn: (a) => a.upstream.baseUrl,
        id: "baseUrl",
        cell: ({ row }) => (
          <DataTableText className="max-w-[280px]" mono truncate>
            {row.original.upstream.baseUrl}
          </DataTableText>
        ),
        header: t("ai-providers.upstreams.th.base-url"),
        meta: { headerClassName: "w-[20%]" },
      },
      {
        accessorKey: "priority",
        cell: ({ row }) => <DataTableText>{row.original.priority}</DataTableText>,
        header: t("ai-providers.upstreams.th.priority"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        accessorKey: "weight",
        cell: ({ row }) => <DataTableText>{row.original.weight}</DataTableText>,
        header: t("ai-providers.upstreams.th.weight"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={(enabled) => {
              void updateAssignment
                .mutateAsync({
                  providerId: provider.id,
                  assignmentId: row.original.id,
                  enabled,
                })
                .then(() => toast.success(t("ai-providers.toast.upstream-updated")))
                .catch((err: unknown) =>
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : t("ai-providers.toast.upstream-update-error"),
                  ),
                );
            }}
          />
        ),
        header: t("ai-providers.upstreams.th.enabled"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditTarget(row.original)}
              aria-label={t("common.btn.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("common.btn.delete")}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
    ],
    [provider.id, t, updateAssignment],
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">{t("ai-providers.upstreams.section-title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("ai-providers.upstreams.desc")}</p>
            </div>
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("ai-providers.btn.assign-upstream")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {sortedAssignments.length === 0 && !isLoading ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t("ai-providers.upstreams.empty")}
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={sortedAssignments}
              emptyText={t("ai-providers.upstreams.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              showPagination={false}
              tableClassName="min-w-[980px]"
            />
          )}
        </CardContent>
      </Card>

      <AssignUpstreamDialog
        provider={provider}
        existingAssignments={assignments}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />

      <EditAssignmentDialog
        provider={provider}
        assignment={editTarget}
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
                name: deleteTarget?.upstream.name ?? "",
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
              disabled={deleteAssignment.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Provider Form Dialog ────────────────────────────────────────────

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
      cloudflareClientId: "",
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
        cloudflareClientId: (ac.clientId as string) ?? "",
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
        cloudflareClientId: "",
      });
    }
  }, [open, provider, form]);

  // Auto-link: Bedrock apiFormat → default region + baseUrl
  const watchedApiFormat = useWatch({ control: form.control, name: "apiFormat" });
  const watchedAuthType = useWatch({ control: form.control, name: "authType" });
  const watchedRegion = useWatch({ control: form.control, name: "sigv4Region" });

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
    const { sigv4Region, sigv4AccessKeyId, cloudflareClientId, ...rest } = data;

    let authConfig: Record<string, unknown> | undefined;
    if (data.authType === "cloudflare") {
      authConfig = { clientId: cloudflareClientId?.trim() ?? "" };
    } else if (data.authType === "sigv4" && sigv4Region) {
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
                        <SelectItem value="cloudflare">Cloudflare Access</SelectItem>
                        <SelectItem value="sigv4">AWS SigV4</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {watchedApiFormat === "bedrock" && (
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
              {watchedAuthType === "cloudflare" && (
                <FormField
                  control={form.control}
                  name="cloudflareClientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.form.cloudflare-client-id")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("ai-providers.form.cloudflare-client-id-ph")}
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-providers.form.cloudflare-client-id-hint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {watchedAuthType === "sigv4" && (
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

// ── Assign Upstream Dialog ──────────────────────────────────────────

function AssignUpstreamDialog({
  provider,
  existingAssignments,
  open,
  onOpenChange,
}: {
  provider: AiProvider | null;
  existingAssignments: AiUpstreamAssignment[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: allUpstreams = [] } = useAiUpstreams();
  const createAssignment = useCreateAiProviderAssignment();

  const assignedUpstreamIds = useMemo(
    () => new Set(existingAssignments.map((a) => a.upstream.id)),
    [existingAssignments],
  );

  const availableUpstreams = useMemo(
    () => allUpstreams.filter((u) => !assignedUpstreamIds.has(u.id)),
    [allUpstreams, assignedUpstreamIds],
  );

  const form = useForm<AssignUpstreamFormInput, unknown, AssignUpstreamFormValues>({
    resolver: zodResolver(assignUpstreamFormSchema),
    defaultValues: {
      upstreamId: 0,
      priority: 100,
      weight: 1,
      enabled: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ upstreamId: 0, priority: 100, weight: 1, enabled: true });
    }
  }, [form, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!provider) return;
    try {
      await createAssignment.mutateAsync({
        providerId: provider.id,
        upstreamId: values.upstreamId,
        priority: values.priority,
        weight: values.weight,
        enabled: values.enabled,
      });
      toast.success(t("ai-providers.toast.upstream-assigned"));
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-providers.toast.upstream-assign-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-providers.dialog.assign-upstream-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="upstreamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.upstreams.form.upstream")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : ""}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("ai-providers.upstreams.form.upstream-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableUpstreams.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name} ({u.upstreamId})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {availableUpstreams.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-providers.upstreams.form.no-available")}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
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
              <Button type="submit" disabled={createAssignment.isPending}>
                {t("ai-providers.btn.assign-upstream")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Assignment Dialog ──────────────────────────────────────────

function EditAssignmentDialog({
  provider,
  assignment,
  open,
  onOpenChange,
}: {
  provider: AiProvider | null;
  assignment: AiUpstreamAssignment | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const updateAssignment = useUpdateAiProviderAssignment();

  const form = useForm<EditAssignmentFormInput, unknown, EditAssignmentFormValues>({
    resolver: zodResolver(editAssignmentFormSchema),
    defaultValues: {
      priority: 100,
      weight: 1,
      enabled: true,
    },
  });

  useEffect(() => {
    if (!open || !assignment) return;
    form.reset({
      priority: assignment.priority,
      weight: assignment.weight,
      enabled: assignment.enabled,
    });
  }, [form, open, assignment]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!provider || !assignment) return;
    try {
      await updateAssignment.mutateAsync({
        providerId: provider.id,
        assignmentId: assignment.id,
        priority: values.priority,
        weight: values.weight,
        enabled: values.enabled,
      });
      toast.success(t("ai-providers.toast.upstream-updated"));
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-providers.toast.upstream-update-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-providers.dialog.edit-upstream-title")}</DialogTitle>
        </DialogHeader>
        {assignment && (
          <div className="px-6 pb-2">
            <p className="text-sm text-muted-foreground">
              {assignment.upstream.name}{" "}
              <Badge variant="secondary" className="ml-1 font-mono text-xs">
                {assignment.upstream.upstreamId}
              </Badge>
            </p>
          </div>
        )}
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
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
              <Button type="submit" disabled={updateAssignment.isPending}>
                {t("common.btn.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Key Pools Section ──────────────────────────────────────────────

interface KeyBucket {
  id: string;
  name: string;
  kind: string | null;
  baseUrl: string;
  upstreamId: number | null;
  priority: number;
  weight: number;
  enabled: boolean;
  keys: AiKey[];
}

function ProviderKeyBucketsSection({ provider }: { provider: AiProvider }) {
  const { t } = useTranslation();
  const { data: keys = [], isLoading: keysLoading } = useAiProviderKeys(provider.id);
  const { data: assignments = [] } = useAiProviderAssignments(provider.id);
  const updateKey = useUpdateAiKey();
  const deleteKey = useDeleteAiKey();
  const testKey = useTestAiKey();
  const updateProvider = useUpdateAiProvider();

  const [addBucket, setAddBucket] = useState<KeyBucket | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiKey | null>(null);

  const buckets = useMemo<KeyBucket[]>(() => {
    const grouped = groupBy(keys, (k) => k.upstreamId ?? "official");

    const officialBucket: KeyBucket = {
      id: "official",
      name: t("ai-providers.keys.official-bucket"),
      kind: null,
      baseUrl: provider.baseUrl,
      upstreamId: null,
      priority: 1000,
      weight: 0,
      enabled: true,
      keys: orderBy(
        grouped["official"] ?? [],
        [
          (k) => -(k.weight ?? 1),
          (k) => -(k.lastUsedAt ? new Date(k.lastUsedAt).getTime() : 0),
          "name",
        ],
        ["asc", "asc", "asc"],
      ),
    };

    const sortedAssignments = [...assignments].sort(
      (a, b) =>
        a.priority - b.priority ||
        b.weight - a.weight ||
        a.upstream.name.localeCompare(b.upstream.name),
    );

    const assignmentBuckets: KeyBucket[] = sortedAssignments.map((a) => ({
      id: String(a.upstream.id),
      name: a.upstream.name,
      kind: a.upstream.kind,
      baseUrl: a.upstream.baseUrl,
      upstreamId: a.upstream.id,
      priority: a.priority,
      weight: a.weight,
      enabled: a.enabled && a.upstream.enabled,
      keys: orderBy(
        grouped[String(a.upstream.id)] ?? [],
        [
          (k) => -(k.weight ?? 1),
          (k) => -(k.lastUsedAt ? new Date(k.lastUsedAt).getTime() : 0),
          "name",
        ],
        ["asc", "asc", "asc"],
      ),
    }));

    return [officialBucket, ...assignmentBuckets];
  }, [keys, assignments, provider.baseUrl, t]);

  const strategy = provider.loadBalanceStrategy ?? "round-robin";

  const handleToggle = useCallback(
    async (key: AiKey) => {
      try {
        await updateKey.mutateAsync({ id: key.id, enabled: !key.enabled });
        toast.success(t("ai-providers.keys.toast.updated"));
      } catch {
        toast.error(t("ai-providers.keys.toast.update-error"));
      }
    },
    [updateKey, t],
  );

  const handleWeightChange = useCallback(
    async (key: AiKey, delta: number) => {
      const newWeight = Math.max(0, Math.min(100, (key.weight ?? 1) + delta));
      if (newWeight === key.weight) return;
      try {
        await updateKey.mutateAsync({ id: key.id, weight: newWeight });
      } catch {
        toast.error(t("ai-providers.keys.toast.update-error"));
      }
    },
    [updateKey, t],
  );

  const handleTest = useCallback(
    async (key: AiKey) => {
      try {
        const result = await testKey.mutateAsync(key.id);
        if (result.success) {
          toast.success(t("ai-providers.keys.toast.test-ok", { ms: result.latencyMs ?? 0 }));
        } else {
          toast.error(result.error ?? t("ai-providers.keys.toast.test-error"));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("ai-providers.keys.toast.test-error"));
      }
    },
    [testKey, t],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteKey.mutateAsync(deleteTarget.id);
      toast.success(t("ai-providers.keys.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai-providers.keys.toast.delete-error"));
    }
  }, [deleteTarget, deleteKey, t]);

  const handleStrategyChange = useCallback(
    async (newStrategy: string) => {
      try {
        await updateProvider.mutateAsync({ id: provider.id, loadBalanceStrategy: newStrategy });
        toast.success(t("ai-providers.toast.updated"));
      } catch {
        toast.error(t("ai-providers.toast.update-error"));
      }
    },
    [updateProvider, provider.id, t],
  );

  const totalKeys = keys.length;
  const showPool = totalKeys > 1;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">{t("ai-providers.keys.section-title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("ai-providers.keys.desc")}</p>
            </div>
            <div className="flex items-center gap-2">
              {showPool && (
                <Select value={strategy} onValueChange={handleStrategyChange}>
                  <SelectTrigger className="h-7 w-auto gap-1 border-dashed px-2 text-xs">
                    <RefreshCw className="h-3 w-3" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round-robin">
                      {t("ai-providers.keys.strategy.round-robin")}
                    </SelectItem>
                    <SelectItem value="random">{t("ai-providers.keys.strategy.random")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {keysLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            buckets.map((bucket) => (
              <BucketCard
                key={bucket.id}
                bucket={bucket}
                showPool={showPool}
                onToggle={handleToggle}
                onWeightChange={handleWeightChange}
                onTest={handleTest}
                onDelete={setDeleteTarget}
                onAdd={() => {
                  if (!bucket.enabled) return;
                  setAddBucket(bucket);
                }}
                isToggling={updateKey.isPending}
                isTesting={testKey.isPending}
              />
            ))
          )}
        </CardContent>
      </Card>

      <AddKeyToBucketDialog
        open={!!addBucket}
        onOpenChange={(v) => {
          if (!v) setAddBucket(null);
        }}
        provider={provider}
        bucket={addBucket}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-providers.keys.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-providers.keys.dialog.delete-body", { name: deleteTarget?.name ?? "" })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteKey.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Bucket Card ────────────────────────────────────────────────────

function BucketCard({
  bucket,
  showPool,
  onToggle,
  onWeightChange,
  onTest,
  onDelete,
  onAdd,
  isToggling,
  isTesting,
}: {
  bucket: KeyBucket;
  showPool: boolean;
  onToggle: (key: AiKey) => void;
  onWeightChange: (key: AiKey, delta: number) => void;
  onTest: (key: AiKey) => void;
  onDelete: (key: AiKey) => void;
  onAdd: () => void;
  isToggling: boolean;
  isTesting: boolean;
}) {
  const { t } = useTranslation();
  const isOfficial = bucket.upstreamId === null;
  const enabledCount = bucket.keys.filter((k) => k.enabled).length;
  const enabledPool = bucket.keys.filter((k) => k.enabled);
  const nextKeyId =
    enabledPool.length > 0
      ? orderBy(enabledPool, [(k) => k.lastUsedAt ?? ""], ["asc"])[0].id
      : null;

  return (
    <div className={cn("rounded-lg border", !bucket.enabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{bucket.name}</span>
          {bucket.kind && (
            <Badge variant="outline" className="text-[10px]">
              {bucket.kind}
            </Badge>
          )}
          {isOfficial && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="text-[10px]">
                  P1000
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{t("ai-providers.keys.official-hint")}</TooltipContent>
            </Tooltip>
          )}
          {!isOfficial && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              P{bucket.priority} W{bucket.weight}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {t("ai-providers.keys.count", { enabled: enabledCount, total: bucket.keys.length })}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={onAdd}
          disabled={!bucket.enabled}
          title={!bucket.enabled ? t("common.status.disabled") : undefined}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t("ai-providers.keys.add")}
        </Button>
      </div>

      <div className="p-2 space-y-1.5">
        {bucket.keys.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t("ai-providers.keys.empty")}
          </div>
        ) : (
          bucket.keys.map((k) => {
            const isNext = k.id === nextKeyId;
            const weight = k.weight ?? 1;
            return (
              <div
                key={k.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  isNext && k.enabled ? "border-primary/30 bg-primary/5" : "bg-muted/20",
                )}
              >
                {/* Row 1: Name + controls */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "flex h-2 w-2 shrink-0 rounded-full",
                            !k.enabled
                              ? "bg-muted-foreground/40"
                              : isNext
                                ? "bg-green-500 shadow-[0_0_6px_1px] shadow-green-500/40"
                                : "bg-green-500",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {!k.enabled
                          ? t("common.status.disabled")
                          : isNext
                            ? t("ai-providers.keys.next")
                            : t("common.status.active")}
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-medium truncate">{k.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {showPool && (
                      <div className="flex items-center gap-0.5 mr-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(k, -1)}
                          disabled={weight <= 0}
                          aria-label={t("ai-providers.keys.weight-down")}
                        >
                          <span className="text-xs font-bold">−</span>
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-8 text-center text-xs font-mono tabular-nums">
                              {weight}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{t("ai-providers.keys.weight-hint")}</TooltipContent>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(k, 1)}
                          disabled={weight >= 100}
                          aria-label={t("ai-providers.keys.weight-up")}
                        >
                          <span className="text-xs font-bold">+</span>
                        </Button>
                      </div>
                    )}
                    <Switch
                      checked={k.enabled}
                      onCheckedChange={() => onToggle(k)}
                      disabled={isToggling}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onTest(k)}
                      disabled={isTesting}
                      aria-label={t("common.a11y.test")}
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onDelete(k)}
                      aria-label={t("common.btn.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                {/* Row 2: Prefix + owner + last used */}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <code className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-[160px] truncate inline-block">
                    {k.keyPrefix}****
                  </code>
                  <Badge
                    variant={k.ownerName ? "secondary" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {k.ownerName ?? t("ai-providers.keys.tag.platform")}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {k.lastUsedAt
                      ? formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })
                      : t("ai-providers.keys.never")}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Add Key to Bucket Dialog ───────────────────────────────────────

const addKeyToBucketSchema = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  apiKey: z.string().min(1, "common.valid.required"),
  ownerId: z.number().int().positive().nullable().optional(),
});
type AddKeyToBucketValues = z.infer<typeof addKeyToBucketSchema>;

function AddKeyToBucketDialog({
  open,
  onOpenChange,
  provider,
  bucket,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: AiProvider;
  bucket: KeyBucket | null;
}) {
  const { t } = useTranslation();
  const createKey = useCreateAiKey();
  const { data: keyProviders = [] } = useKeyProviders();
  const activeKeyProviders = useMemo(
    () => keyProviders.filter((kp) => kp.status === "active"),
    [keyProviders],
  );
  const isSigV4 = provider.authType === "sigv4";
  const isCloudflare = provider.authType === "cloudflare";

  const form = useForm<AddKeyToBucketValues>({
    resolver: zodResolver(addKeyToBucketSchema),
    defaultValues: { name: "", apiKey: "", ownerId: null },
  });

  useEffect(() => {
    if (open) form.reset({ name: "", apiKey: "", ownerId: null });
  }, [open, form]);

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!bucket || !bucket.enabled) {
      toast.error(t("ai-providers.keys.toast.create-error"));
      return;
    }

    try {
      await createKey.mutateAsync({
        providerId: provider.id,
        upstreamId: bucket.upstreamId ?? null,
        name: data.name,
        apiKey: data.apiKey,
        ownerId: data.ownerId,
      });
      toast.success(t("ai-providers.keys.toast.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-providers.keys.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {t("ai-providers.keys.dialog.add-title", { upstream: bucket?.name ?? "" })}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-providers.keys.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-providers.keys.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isCloudflare
                        ? t("ai-providers.keys.form.cloudflare-client-secret")
                        : isSigV4
                          ? t("ai-providers.keys.form.secret-access-key")
                          : t("ai-providers.keys.form.api-key")}
                    </FormLabel>
                    <FormControl>
                      <SecretInput
                        placeholder={
                          isCloudflare
                            ? t("ai-providers.keys.form.cloudflare-client-secret-ph")
                            : isSigV4
                              ? t("ai-providers.keys.form.secret-access-key-ph")
                              : t("ai-providers.keys.form.api-key-ph")
                        }
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      {isCloudflare
                        ? t("ai-providers.keys.form.cloudflare-client-secret-hint")
                        : isSigV4
                          ? t("ai-providers.keys.form.secret-access-key-hint")
                          : t("ai-providers.keys.form.api-key-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {activeKeyProviders.length > 0 && (
                <FormField
                  control={form.control}
                  name="ownerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-providers.keys.form.owner")}</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("ai-providers.keys.form.owner-ph")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {t("ai-providers.keys.form.owner-none")}
                          </SelectItem>
                          {activeKeyProviders.map((kp) => (
                            <SelectItem key={kp.id} value={String(kp.id)}>
                              {kp.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-providers.keys.form.owner-hint")}
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
              <Button type="submit" disabled={createKey.isPending || !bucket?.enabled}>
                {t("ai-providers.keys.add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
