import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Pencil, Plus, Route, Server, Sparkles, Trash2 } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { toast } from "sonner";
import { z } from "zod";

import type { HealthStatus } from "@/web/api/health-status";
import {
  useAiEndpointAssignments,
  useAiEndpoints,
  useAiEndpointsOverview,
  useAiSuppliers,
  useAiUpstreams,
  useCreateAiEndpoint,
  useCreateAiEndpointAssignment,
  useDeleteAiEndpoint,
  useDeleteAiEndpointAssignment,
  useUpdateAiEndpoint,
  useUpdateAiEndpointAssignment,
} from "@/web/api/hooks";
import type { AiEndpoint, AiEndpointOverviewItem, AiUpstreamAssignment } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableText,
} from "@/web/components/data-table";
import { HealthBadge, healthDotColor } from "@/web/components/health/health-badge";
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

import {
  BEDROCK_REGIONS,
  DEFAULT_UPSTREAM_PRIORITY,
  DEFAULT_UPSTREAM_WEIGHT,
} from "./ai-endpoints/constants";
import { EndpointCredentialBucketsSection } from "./ai-endpoints/credential-buckets";

// ── Form schemas ────────────────────────────────────────────────────

const endpointFormSchema = z
  .object({
    supplierId: z.number().min(1, "common.valid.required"),
    endpointId: z.string().min(1, "common.valid.required"),
    name: z.string().min(1, "common.valid.name-required"),
    baseUrl: z.string().url("common.valid.invalid-url"),
    apiFormat: z.enum(["openai", "anthropic", "gemini", "azure-openai", "bedrock"]),
    authType: z.enum(["bearer", "api-key", "sigv4", "cloudflare"]),
    upstreamRoutingStrategy: z.enum(["priority", "weighted-random"]),
    officialConcurrencyLimit: z
      .string()
      .trim()
      .refine((value) => value === "" || /^[1-9]\d*$/.test(value), "common.valid.invalid-amount")
      .refine((value) => value === "" || Number(value) <= 10_000, "common.valid.invalid-amount"),
    officialQueueTimeoutMs: z
      .string()
      .trim()
      .refine((value) => /^[1-9]\d*$/.test(value), "common.valid.invalid-amount")
      .refine((value) => Number(value) <= 30 * 60 * 1000, "common.valid.invalid-amount"),
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
type EndpointFormValues = z.infer<typeof endpointFormSchema>;

function isEndpointEffectiveEnabled(endpoint: AiEndpoint): boolean {
  return endpoint.enabled && !endpoint.autoDisabled;
}

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

export default function AiEndpointsPage() {
  const { t } = useTranslation();
  const { data: endpoints = [], isLoading } = useAiEndpoints();
  const { data: overview } = useAiEndpointsOverview(24, 30_000);
  const healthMap = useMemo(
    () => new Map(overview?.endpoints.map((p) => [p.id, p]) ?? []),
    [overview?.endpoints],
  );
  const [selectedId, setSelectedId] = useQueryState("endpointId", parseAsInteger);

  const [addOpen, setAddOpen] = useState(false);

  const selectedEndpoint = endpoints.find((p) => p.id === selectedId) ?? null;

  const handleBack = useCallback(() => setSelectedId(null), [setSelectedId]);
  const handleSelect = useCallback((p: AiEndpoint) => setSelectedId(p.id), [setSelectedId]);

  return (
    <div>
      <Header title={t("ai-endpoints.title")} description={t("ai-endpoints.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {selectedEndpoint ? (
          <EndpointDetail
            endpoint={selectedEndpoint}
            onBack={handleBack}
            healthOverview={healthMap.get(selectedEndpoint.id)}
          />
        ) : (
          <>
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("ai-endpoints.btn.new")}
              </Button>
            </div>
            <EndpointGrid
              endpoints={endpoints}
              loading={isLoading}
              onSelect={handleSelect}
              healthMap={healthMap}
            />
          </>
        )}
      </div>

      <EndpointFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

// ── Endpoint Grid ───────────────────────────────────────────────────

function EndpointGrid({
  endpoints,
  loading,
  onSelect,
  healthMap,
}: {
  endpoints: AiEndpoint[];
  loading: boolean;
  onSelect: (p: AiEndpoint) => void;
  healthMap: Map<number, AiEndpointOverviewItem>;
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

  if (endpoints.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Server className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("ai-endpoints.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {endpoints.map((endpoint) => (
        <EndpointCard
          key={endpoint.id}
          endpoint={endpoint}
          upstreamCount={endpoint.upstreamCount ?? 0}
          onClick={() => onSelect(endpoint)}
          healthOverview={healthMap.get(endpoint.id)}
        />
      ))}
    </div>
  );
}

function EndpointCard({
  endpoint,
  upstreamCount,
  onClick,
  healthOverview,
}: {
  endpoint: AiEndpoint;
  upstreamCount: number;
  onClick: () => void;
  healthOverview?: AiEndpointOverviewItem;
}) {
  const { t } = useTranslation();
  const effectiveEnabled = isEndpointEffectiveEnabled(endpoint);
  const healthStatus: HealthStatus = healthOverview?.healthStatus ?? "unknown";

  const upstreamLabel =
    upstreamCount > 0
      ? t("ai-endpoints.card.upstreams", { count: upstreamCount })
      : t("ai-endpoints.card.no-upstreams");

  return (
    <button
      type="button"
      className={cn(
        "block w-full rounded-xl text-left touch-manipulation",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      onClick={onClick}
      aria-label={t("ai-endpoints.card.open-endpoint", { name: endpoint.name })}
    >
      <Card
        className={cn(
          "h-full transition-[box-shadow,border-color,opacity] hover:shadow-md hover:border-primary/30",
          "flex flex-col justify-between",
          !effectiveEnabled && "opacity-60",
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {endpoint.iconUrl ? (
                <img
                  src={endpoint.iconUrl}
                  alt={endpoint.name}
                  className="h-8 w-8 rounded-md object-contain"
                  width={32}
                  height={32}
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-primary" />
                </div>
              )}
              <h3 className="truncate text-sm font-semibold">{endpoint.name}</h3>
            </div>
            <div
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", healthDotColor(healthStatus))}
              title={t(`ai-upstreams.health.${healthStatus}`)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pb-4 pt-0">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-xs">
              {endpoint.apiFormat}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {endpoint.authType}
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

// ── Endpoint Detail ─────────────────────────────────────────────────

function EndpointDetail({
  endpoint,
  onBack,
  healthOverview,
}: {
  endpoint: AiEndpoint;
  onBack: () => void;
  healthOverview?: AiEndpointOverviewItem;
}) {
  const { t } = useTranslation();
  const updateEndpoint = useUpdateAiEndpoint();
  const deleteEndpoint = useDeleteAiEndpoint();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const healthStatus: HealthStatus = healthOverview?.healthStatus ?? "unknown";

  const handleToggle = useCallback(async () => {
    try {
      await updateEndpoint.mutateAsync({
        id: endpoint.id,
        enabled: !isEndpointEffectiveEnabled(endpoint),
      });
      toast.success(t("ai-endpoints.toast.updated"));
    } catch {
      toast.error(t("ai-endpoints.toast.update-error"));
    }
  }, [updateEndpoint, endpoint, t]);

  const handleConfirmDelete = useCallback(async () => {
    try {
      await deleteEndpoint.mutateAsync(endpoint.id);
      toast.success(t("ai-endpoints.toast.deleted"));
      onBack();
    } catch {
      toast.error(t("ai-endpoints.toast.delete-error"));
    }
  }, [deleteEndpoint, endpoint, onBack, t]);

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
              {endpoint.iconUrl ? (
                <img
                  src={endpoint.iconUrl}
                  alt={endpoint.name}
                  className="h-6 w-6 rounded object-contain"
                  width={24}
                  height={24}
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <CardTitle className="text-base">{endpoint.name}</CardTitle>
              <Badge variant="secondary" className="font-mono text-xs">
                {endpoint.endpointId}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={isEndpointEffectiveEnabled(endpoint)}
                onCheckedChange={handleToggle}
                disabled={updateEndpoint.isPending}
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
                {t("ai-endpoints.form.base-url")}
              </div>
              <div className="font-mono text-xs break-all">{endpoint.baseUrl}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-endpoints.th.api-format")}
              </div>
              <div>{endpoint.apiFormat}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-endpoints.th.auth-type")}
              </div>
              <div>{endpoint.authType}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-endpoints.th.routing")}
              </div>
              <div>
                {endpoint.upstreamRoutingStrategy === "weighted-random"
                  ? t("ai-endpoints.strategy.weighted-random")
                  : t("ai-endpoints.strategy.priority")}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4 border-t pt-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-upstreams.detail.health")}
              </div>
              <div className="mt-1">
                <HealthBadge
                  status={healthStatus}
                  label={t(`ai-upstreams.health.${healthStatus}`)}
                />
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-upstreams.detail.last-checked")}
              </div>
              <div>
                {healthOverview?.lastCheckedAt
                  ? formatDistanceToNow(new Date(healthOverview.lastCheckedAt), {
                      addSuffix: true,
                    })
                  : t("ai-upstreams.never")}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-upstreams.detail.consecutive-failures")}
              </div>
              <div>{healthOverview?.consecutiveFailures ?? 0}</div>
            </div>
            <div className="xl:col-span-1 md:col-span-2">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("ai-upstreams.detail.last-error")}
              </div>
              <div
                className="text-destructive truncate text-xs"
                title={healthOverview?.lastError ?? undefined}
              >
                {healthOverview?.lastError ?? "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Upstreams */}
      <EndpointUpstreamsSection endpoint={endpoint} />

      {/* Credential Pools */}
      <EndpointCredentialBucketsSection endpoint={endpoint} />

      {/* Edit dialog */}
      <EndpointFormDialog open={editOpen} onOpenChange={setEditOpen} endpoint={endpoint} />

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-endpoints.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-endpoints.dialog.delete-body", { name: endpoint.name })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteEndpoint.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Endpoint Upstreams Section ───────────────────────────────────────

function EndpointUpstreamsSection({ endpoint }: { endpoint: AiEndpoint }) {
  const { t } = useTranslation();
  const { data: assignments = [], isLoading } = useAiEndpointAssignments(endpoint.id);
  const updateAssignment = useUpdateAiEndpointAssignment();
  const deleteAssignment = useDeleteAiEndpointAssignment();

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
        endpointId: endpoint.id,
        assignmentId: deleteTarget.id,
      });
      toast.success(t("ai-endpoints.toast.upstream-deleted"));
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-endpoints.toast.upstream-delete-error"),
      );
    }
  }, [deleteTarget, deleteAssignment, endpoint, t]);

  const columns = useMemo<ColumnDef<AiUpstreamAssignment>[]>(
    () => [
      {
        accessorFn: (a) => a.upstream.name,
        id: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.upstream.name}</DataTableText>
        ),
        header: t("ai-endpoints.upstreams.th.name"),
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
        header: t("ai-endpoints.upstreams.th.upstream-id"),
        meta: { headerClassName: "w-[26%]" },
      },
      {
        accessorFn: (a) => a.upstream.kind,
        id: "kind",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">{row.original.upstream.kind}</DataTableBadge>
        ),
        header: t("ai-endpoints.upstreams.th.kind"),
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
        header: t("ai-endpoints.upstreams.th.base-url"),
        meta: { headerClassName: "w-[20%]" },
      },
      {
        accessorKey: "priority",
        cell: ({ row }) => <DataTableText>{row.original.priority}</DataTableText>,
        header: t("ai-endpoints.upstreams.th.priority"),
        meta: { headerClassName: "w-[8%]" },
      },
      {
        accessorKey: "weight",
        cell: ({ row }) => <DataTableText>{row.original.weight}</DataTableText>,
        header: t("ai-endpoints.upstreams.th.weight"),
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
                  endpointId: endpoint.id,
                  assignmentId: row.original.id,
                  enabled,
                })
                .then(() => toast.success(t("ai-endpoints.toast.upstream-updated")))
                .catch((err: unknown) =>
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : t("ai-endpoints.toast.upstream-update-error"),
                  ),
                );
            }}
          />
        ),
        header: t("ai-endpoints.upstreams.th.enabled"),
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
    [endpoint.id, t, updateAssignment],
  );

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">{t("ai-endpoints.upstreams.section-title")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("ai-endpoints.upstreams.desc")}</p>
            </div>
            <Button size="sm" onClick={() => setAssignOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("ai-endpoints.btn.assign-upstream")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <OfficialUpstreamRouteCard
            endpoint={endpoint}
            hasAssignments={sortedAssignments.length > 0}
          />
          {(sortedAssignments.length > 0 || isLoading) && (
            <DataTable
              columns={columns}
              data={sortedAssignments}
              emptyText={t("ai-endpoints.upstreams.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              showPagination={false}
              tableClassName="min-w-[980px]"
            />
          )}
        </CardContent>
      </Card>

      <AssignUpstreamDialog
        endpoint={endpoint}
        existingAssignments={assignments}
        open={assignOpen}
        onOpenChange={setAssignOpen}
      />

      <EditAssignmentDialog
        endpoint={endpoint}
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
            <DialogTitle>{t("ai-endpoints.dialog.delete-upstream-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("ai-endpoints.dialog.delete-upstream-body", {
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

function OfficialUpstreamRouteCard({
  endpoint,
  hasAssignments,
}: {
  endpoint: AiEndpoint;
  hasAssignments: boolean;
}) {
  const { t } = useTranslation();
  const enabled = isEndpointEffectiveEnabled(endpoint);

  return (
    <div
      className={cn(
        "rounded-lg border bg-muted/20 p-4 transition-[border-color,background-color,opacity]",
        "border-primary/20 bg-primary/[0.03]",
        !enabled && "opacity-60",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Route aria-hidden="true" className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{t("ai-endpoints.upstreams.official-title")}</h3>
              <Badge variant="secondary" className="text-[10px]">
                {t("ai-endpoints.upstreams.kind.official")}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px]">
                P{DEFAULT_UPSTREAM_PRIORITY} W{DEFAULT_UPSTREAM_WEIGHT}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasAssignments
                ? t("ai-endpoints.upstreams.official-fallback-desc")
                : t("ai-endpoints.upstreams.official-default-desc")}
            </p>
          </div>
        </div>
        <Badge variant={enabled ? "secondary" : "outline"} className="w-fit text-xs">
          {enabled ? t("common.status.active") : t("common.status.disabled")}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_140px_120px_120px_120px]">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("ai-endpoints.upstreams.th.base-url")}
          </div>
          <CopyableText
            value={endpoint.baseUrl}
            className="rounded-sm font-mono text-xs break-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {endpoint.baseUrl}
          </CopyableText>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("ai-endpoints.upstreams.route-role")}
          </div>
          <div>
            {hasAssignments
              ? t("ai-endpoints.upstreams.fallback")
              : t("ai-endpoints.upstreams.default-route")}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("ai-endpoints.upstreams.th.upstream-id")}
          </div>
          <div className="font-mono text-xs">{t("ai-endpoints.upstreams.official-id")}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("ai-endpoints.upstreams.th.concurrency-limit")}
          </div>
          <div className="font-mono text-xs">
            {endpoint.officialConcurrencyLimit ?? t("ai-endpoints.upstreams.unlimited")}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("ai-endpoints.upstreams.th.queue-timeout")}
          </div>
          <div className="font-mono text-xs">{endpoint.officialQueueTimeoutMs ?? 30_000}ms</div>
        </div>
      </div>
    </div>
  );
}

// ── Endpoint Form Dialog ────────────────────────────────────────────

function EndpointFormDialog({
  open,
  onOpenChange,
  endpoint,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  endpoint?: AiEndpoint | null;
}) {
  const { t } = useTranslation();
  const createEndpoint = useCreateAiEndpoint();
  const updateEndpoint = useUpdateAiEndpoint();
  const { data: suppliers = [] } = useAiSuppliers();
  const isEdit = !!endpoint;

  const form = useForm<EndpointFormValues>({
    resolver: zodResolver(endpointFormSchema),
    defaultValues: {
      supplierId: 0,
      endpointId: "",
      name: "",
      baseUrl: "",
      apiFormat: "openai",
      authType: "bearer",
      upstreamRoutingStrategy: "priority",
      officialConcurrencyLimit: "",
      officialQueueTimeoutMs: "30000",
      enabled: true,
      sigv4Region: "",
      sigv4AccessKeyId: "",
      cloudflareClientId: "",
    },
  });

  useEffect(() => {
    if (open && endpoint) {
      const ac = (endpoint.authConfig ?? {}) as Record<string, unknown>;
      form.reset({
        supplierId: endpoint.supplierId,
        endpointId: endpoint.endpointId,
        name: endpoint.name,
        baseUrl: endpoint.baseUrl,
        apiFormat: endpoint.apiFormat as EndpointFormValues["apiFormat"],
        authType: endpoint.authType as EndpointFormValues["authType"],
        upstreamRoutingStrategy:
          endpoint.upstreamRoutingStrategy === "weighted-random" ? "weighted-random" : "priority",
        officialConcurrencyLimit: endpoint.officialConcurrencyLimit
          ? String(endpoint.officialConcurrencyLimit)
          : "",
        officialQueueTimeoutMs: String(endpoint.officialQueueTimeoutMs ?? 30_000),
        enabled: endpoint.enabled,
        sigv4Region: (ac.region as string) ?? "",
        sigv4AccessKeyId: (ac.accessKeyId as string) ?? "",
        cloudflareClientId: (ac.clientId as string) ?? "",
      });
    } else if (open) {
      form.reset({
        supplierId: suppliers[0]?.id ?? 0,
        endpointId: "",
        name: "",
        baseUrl: "",
        apiFormat: "openai",
        authType: "bearer",
        upstreamRoutingStrategy: "priority",
        officialConcurrencyLimit: "",
        officialQueueTimeoutMs: "30000",
        enabled: true,
        sigv4Region: "",
        sigv4AccessKeyId: "",
        cloudflareClientId: "",
      });
    }
  }, [open, endpoint, suppliers, form]);

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
    const {
      sigv4Region,
      sigv4AccessKeyId,
      cloudflareClientId,
      officialConcurrencyLimit: officialConcurrencyLimitInput,
      officialQueueTimeoutMs: officialQueueTimeoutMsInput,
      ...rest
    } = data;
    const officialConcurrencyLimit =
      officialConcurrencyLimitInput === "" ? null : Number(officialConcurrencyLimitInput);
    const officialQueueTimeoutMs = Number(officialQueueTimeoutMsInput);

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
        await updateEndpoint.mutateAsync({
          id: endpoint.id,
          ...rest,
          officialConcurrencyLimit,
          officialQueueTimeoutMs,
          authConfig,
        });
        toast.success(t("ai-endpoints.toast.updated"));
      } else {
        await createEndpoint.mutateAsync({
          ...rest,
          officialConcurrencyLimit,
          officialQueueTimeoutMs,
          authConfig,
        });
        toast.success(t("ai-endpoints.toast.created"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-endpoints.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("ai-endpoints.dialog.edit-title") : t("ai-endpoints.dialog.add-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-endpoints.form.supplier")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : ""}
                      onValueChange={(value) => field.onChange(Number(value))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("ai-endpoints.form.supplier-ph")} />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map((supplier) => (
                          <SelectItem key={supplier.id} value={String(supplier.id)}>
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endpointId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-endpoints.form.endpoint-id")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("ai-endpoints.form.endpoint-id-ph")}
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
                    <FormLabel>{t("ai-endpoints.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-endpoints.form.name-ph")} {...field} />
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
                    <FormLabel>{t("ai-endpoints.form.base-url")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-endpoints.form.base-url-ph")} {...field} />
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
                    <FormLabel>{t("ai-endpoints.form.upstream-routing-strategy")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="priority">
                          {t("ai-endpoints.strategy.priority")}
                        </SelectItem>
                        <SelectItem value="weighted-random">
                          {t("ai-endpoints.strategy.weighted-random")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {t("ai-endpoints.form.upstream-routing-strategy-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="officialConcurrencyLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-endpoints.form.official-concurrency-limit")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          placeholder={t("ai-endpoints.form.official-concurrency-limit-ph")}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-endpoints.form.official-concurrency-limit-desc")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="officialQueueTimeoutMs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-endpoints.form.official-queue-timeout")}</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} step={1000} {...field} />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-endpoints.form.official-queue-timeout-desc")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="apiFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-endpoints.form.api-format")}</FormLabel>
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
                    <FormLabel>{t("ai-endpoints.form.auth-type")}</FormLabel>
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
                      <FormLabel>{t("ai-endpoints.form.sigv4-region")}</FormLabel>
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("ai-endpoints.form.sigv4-region-ph")} />
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
                        {t("ai-endpoints.form.sigv4-region-hint")}
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
                      <FormLabel>{t("ai-endpoints.form.cloudflare-client-id")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("ai-endpoints.form.cloudflare-client-id-ph")}
                          className="font-mono"
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-endpoints.form.cloudflare-client-id-hint")}
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
                      <FormLabel>{t("ai-endpoints.form.sigv4-access-key-id")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("ai-endpoints.form.sigv4-access-key-id-ph")}
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground">
                        {t("ai-endpoints.form.sigv4-access-key-id-hint")}
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
              <Button type="submit" disabled={createEndpoint.isPending || updateEndpoint.isPending}>
                {isEdit ? t("common.btn.save") : t("ai-endpoints.btn.create")}
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
  endpoint,
  existingAssignments,
  open,
  onOpenChange,
}: {
  endpoint: AiEndpoint | null;
  existingAssignments: AiUpstreamAssignment[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { data: allUpstreams = [] } = useAiUpstreams();
  const createAssignment = useCreateAiEndpointAssignment();

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
    if (!endpoint) return;
    try {
      await createAssignment.mutateAsync({
        endpointId: endpoint.id,
        upstreamId: values.upstreamId,
        priority: values.priority,
        weight: values.weight,
        enabled: values.enabled,
      });
      toast.success(t("ai-endpoints.toast.upstream-assigned"));
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-endpoints.toast.upstream-assign-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-endpoints.dialog.assign-upstream-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="upstreamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-endpoints.upstreams.form.upstream")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : ""}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("ai-endpoints.upstreams.form.upstream-ph")} />
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
                        {t("ai-endpoints.upstreams.form.no-available")}
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.priority")}</FormLabel>
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.weight")}</FormLabel>
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.enabled")}</FormLabel>
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
                {t("ai-endpoints.btn.assign-upstream")}
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
  endpoint,
  assignment,
  open,
  onOpenChange,
}: {
  endpoint: AiEndpoint | null;
  assignment: AiUpstreamAssignment | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const updateAssignment = useUpdateAiEndpointAssignment();

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
    if (!endpoint || !assignment) return;
    try {
      await updateAssignment.mutateAsync({
        endpointId: endpoint.id,
        assignmentId: assignment.id,
        priority: values.priority,
        weight: values.weight,
        enabled: values.enabled,
      });
      toast.success(t("ai-endpoints.toast.upstream-updated"));
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : t("ai-endpoints.toast.upstream-update-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-endpoints.dialog.edit-upstream-title")}</DialogTitle>
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.priority")}</FormLabel>
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.weight")}</FormLabel>
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
                      <FormLabel>{t("ai-endpoints.upstreams.form.enabled")}</FormLabel>
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
