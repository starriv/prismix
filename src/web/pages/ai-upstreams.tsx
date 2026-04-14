import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { orderBy } from "lodash-es";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  Pencil,
  Plus,
  Server,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { z } from "zod";

import { removeTailingZero, safeMultipliedBy } from "@/shared/number";
import {
  useAiUpstreamRecent,
  useAiUpstreamsOverview,
  useCreateAiUpstream,
  useDeleteAiUpstream,
  useUpdateAiUpstream,
} from "@/web/api/hooks";
import type { AiUpstreamOverviewItem } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { StatCard } from "@/web/components/dashboard/stat-card";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
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
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import { Switch } from "@/web/components/ui/switch";
import { formatTokens, StatusBadge } from "@/web/pages/ai-usage/helpers";

function HealthBadge({
  status,
  label,
}: {
  status: AiUpstreamOverviewItem["healthStatus"];
  label: string;
}) {
  const config = match(status)
    .with("healthy", () => ({
      variant: "default" as const,
      Icon: CheckCircle2,
    }))
    .with("degraded", () => ({
      variant: "destructive" as const,
      Icon: ShieldAlert,
    }))
    .with("idle", () => ({
      variant: "secondary" as const,
      Icon: PauseCircle,
    }))
    .with("no-key", () => ({
      variant: "outline" as const,
      Icon: AlertTriangle,
    }))
    .with("disabled", () => ({
      variant: "outline" as const,
      Icon: PauseCircle,
    }))
    .exhaustive();

  return (
    <DataTableBadge variant={config.variant} className="gap-1">
      <config.Icon className="h-3 w-3" />
      {label}
    </DataTableBadge>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AiUpstreamOverviewItem["healthStatus"], number> = {
  degraded: 0,
  "no-key": 1,
  idle: 2,
  healthy: 3,
  disabled: 4,
};

export default function AiUpstreamsPage() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useAiUpstreamsOverview(24, 10_000);
  const updateUpstream = useUpdateAiUpstream();
  const [selected, setSelected] = useState<AiUpstreamOverviewItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiUpstreamOverviewItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiUpstreamOverviewItem | null>(null);
  const { data: recent = [], isLoading: recentLoading } = useAiUpstreamRecent(
    selected?.id ?? null,
    10,
    10_000,
  );

  const sortedUpstreams = useMemo(
    () =>
      orderBy(
        data?.upstreams ?? [],
        [(u) => SEVERITY_RANK[u.healthStatus], (u) => u.requests24h],
        ["asc", "desc"],
      ),
    [data?.upstreams],
  );

  const handleToggleUpstream = useCallback(
    async (upstream: AiUpstreamOverviewItem, enabled: boolean) => {
      try {
        await updateUpstream.mutateAsync({ id: upstream.id, enabled });
        toast.success(t("ai-upstreams.toast.updated"));
        if (selected?.id === upstream.id) {
          setSelected({
            ...selected,
            enabled,
            healthStatus: enabled ? selected.healthStatus : "disabled",
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("ai-upstreams.toast.update-error"));
      }
    },
    [updateUpstream, selected, t],
  );

  const upstreamColumns = useMemo<ColumnDef<AiUpstreamOverviewItem>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="max-w-[340px]">
            <DataTableText className="font-medium">{row.original.name}</DataTableText>
            <DataTableText className="truncate" mono muted>
              {row.original.baseUrl}
            </DataTableText>
          </div>
        ),
        header: t("ai-upstreams.th.upstream"),
        meta: { headerClassName: "w-[26%]" },
      },
      {
        accessorKey: "healthStatus",
        cell: ({ row }) => (
          <HealthBadge
            status={row.original.healthStatus}
            label={t(`ai-upstreams.health.${row.original.healthStatus}`)}
          />
        ),
        header: t("ai-upstreams.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "assignmentCount",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.assignmentCount}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.assignments"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "enabledKeys",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.enabledKeys}/{row.original.totalKeys}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.keys"),
        meta: { headerClassName: "w-[7%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "requests24h",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.requests24h.toLocaleString(i18n.language)}
          </DataTableText>
        ),
        header: t("ai-upstreams.th.requests"),
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "errorRate24h",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {removeTailingZero(safeMultipliedBy(row.original.errorRate24h, 100), 1)}%
          </DataTableText>
        ),
        header: t("ai-upstreams.th.error-rate"),
        meta: { headerClassName: "w-[7%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "lastSeenAt",
        cell: ({ row }) =>
          row.original.lastSeenAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastSeenAt} />
          ) : (
            <DataTableText muted>{t("ai-upstreams.never")}</DataTableText>
          ),
        header: t("ai-upstreams.th.last-seen"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => (
          <div className="flex justify-center">
            <Switch
              checked={row.original.enabled}
              disabled={updateUpstream.isPending}
              onCheckedChange={(enabled) => void handleToggleUpstream(row.original, enabled)}
            />
          </div>
        ),
        header: t("ai-upstreams.th.enabled"),
        meta: { headerClassName: "w-[6%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setEditTarget(row.original)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(row.original)}>
              {t("ai-upstreams.actions.details")}
            </Button>
          </div>
        ),
        header: "",
        enableHiding: false,
        meta: { headerClassName: "w-[10%]", ...dataTableMeta.right },
      },
    ],
    [handleToggleUpstream, i18n.language, t, updateUpstream.isPending],
  );

  const recentColumns = useMemo<ColumnDef<(typeof recent)[number]>[]>(
    () => [
      {
        accessorKey: "modelId",
        cell: ({ row }) => <DataTableText mono>{row.original.modelId ?? "-"}</DataTableText>,
        header: t("ai-upstreams.detail.model"),
        meta: { headerClassName: "w-[32%]" },
      },
      {
        accessorKey: "totalTokens",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {formatTokens(row.original.totalTokens)}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.tokens"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "latencyMs",
        cell: ({ row }) => (
          <DataTableText mono numeric>
            {row.original.latencyMs != null ? `${row.original.latencyMs}ms` : "-"}
          </DataTableText>
        ),
        header: t("ai-upstreams.detail.latency"),
        meta: { headerClassName: "w-[18%]", ...dataTableMeta.right },
      },
      {
        accessorKey: "statusCode",
        cell: ({ row }) => (
          <StatusBadge code={row.original.statusCode} error={row.original.error} />
        ),
        header: t("ai-upstreams.detail.status"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("ai-upstreams.detail.time"),
        meta: { headerClassName: "w-[16%]" },
      },
    ],
    [i18n.language, t],
  );

  return (
    <div>
      <Header title={t("ai-upstreams.title")} description={t("ai-upstreams.desc")} />

      <div className="space-y-6 p-4 md:p-8">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("ai-upstreams.btn.new")}
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title={t("ai-upstreams.stats.total")}
            value={String(data?.totals.totalUpstreams ?? 0)}
            subtitle={t("ai-upstreams.stats.total-subtitle")}
            icon={Server}
          />
          <StatCard
            title={t("ai-upstreams.stats.enabled")}
            value={String(data?.totals.enabledUpstreams ?? 0)}
            subtitle={t("ai-upstreams.stats.enabled-subtitle")}
            icon={CheckCircle2}
          />
          <StatCard
            title={t("ai-upstreams.stats.active")}
            value={String(data?.totals.activeUpstreams24h ?? 0)}
            subtitle={t("ai-upstreams.stats.active-subtitle")}
            icon={Activity}
          />
          <StatCard
            title={t("ai-upstreams.stats.degraded")}
            value={String(data?.totals.degradedUpstreams24h ?? 0)}
            subtitle={t("ai-upstreams.stats.degraded-subtitle")}
            icon={ShieldAlert}
          />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("ai-upstreams.table.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={upstreamColumns}
              data={sortedUpstreams}
              emptyText={t("ai-upstreams.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              showPagination={false}
              tableClassName="min-w-[1320px]"
            />
          </CardContent>
        </Card>

        {/* ── Detail Sheet ───────────────────────────────────── */}
        <Sheet open={!!selected} onOpenChange={() => setSelected(null)}>
          <SheetContent className="w-full sm:w-[520px]">
            <SheetHeader>
              <SheetTitle>{selected?.name ?? t("ai-upstreams.detail.title")}</SheetTitle>
            </SheetHeader>
            <SheetBody className="space-y-5">
              {selected && (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Card>
                      <CardContent className="space-y-2 pt-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.base-url")}:{" "}
                          </span>
                          <span className="font-mono break-all text-xs">{selected.baseUrl}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.assignments")}:{" "}
                          </span>
                          {selected.assignmentCount}
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="space-y-2 pt-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.health")}:{" "}
                          </span>
                          <HealthBadge
                            status={selected.healthStatus}
                            label={t(`ai-upstreams.health.${selected.healthStatus}`)}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.enabled")}:{" "}
                          </span>
                          <Switch
                            checked={selected.enabled}
                            disabled={updateUpstream.isPending}
                            onCheckedChange={(enabled) =>
                              void handleToggleUpstream(selected, enabled)
                            }
                          />
                          {updateUpstream.isPending && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.keys")}:{" "}
                          </span>
                          {selected.enabledKeys}/{selected.totalKeys}
                        </div>
                        <div>
                          <span className="text-muted-foreground">
                            {t("ai-upstreams.detail.tokens-24h")}:{" "}
                          </span>
                          {formatTokens(selected.totalTokens24h)}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelected(null);
                        setEditTarget(selected);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      {t("ai-upstreams.btn.edit")}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setSelected(null);
                        setDeleteTarget(selected);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      {t("ai-upstreams.btn.delete")}
                    </Button>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">
                        {t("ai-upstreams.detail.recent-title")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DataTable
                        columns={recentColumns}
                        data={recent}
                        emptyText={t("ai-upstreams.detail.recent-empty")}
                        getRowId={(row) => String(row.id)}
                        loading={recentLoading}
                        showPagination={false}
                        tableClassName="min-w-[760px]"
                      />
                    </CardContent>
                  </Card>
                </>
              )}
            </SheetBody>
          </SheetContent>
        </Sheet>

        {/* ── Create / Edit Dialog ────────────────────────── */}
        <UpstreamFormDialog
          open={createOpen || !!editTarget}
          onOpenChange={(open) => {
            if (!open) {
              setCreateOpen(false);
              setEditTarget(null);
            }
          }}
          editTarget={editTarget}
        />

        {/* ── Delete Confirmation ─────────────────────────── */}
        <DeleteUpstreamDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      </div>
    </div>
  );
}

// ── Create / Edit Dialog ────────────────────────────────────────────

const createUpstreamSchema = z.object({
  name: z.string().min(1, "common.valid.required").max(100),
  baseUrl: z.string().url("common.valid.invalid-url").max(500),
  enabled: z.boolean(),
});

type CreateUpstreamForm = z.infer<typeof createUpstreamSchema>;

function UpstreamFormDialog({
  open,
  onOpenChange,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: AiUpstreamOverviewItem | null;
}) {
  const { t } = useTranslation();
  const createUpstream = useCreateAiUpstream();
  const updateUpstream = useUpdateAiUpstream();
  const isEdit = !!editTarget;

  const form = useForm<CreateUpstreamForm>({
    resolver: zodResolver(createUpstreamSchema),
    defaultValues: { name: "", baseUrl: "", enabled: true },
  });

  useEffect(() => {
    if (editTarget) {
      form.reset({
        name: editTarget.name,
        baseUrl: editTarget.baseUrl,
        enabled: editTarget.enabled,
      });
    } else {
      form.reset({ name: "", baseUrl: "", enabled: true });
    }
  }, [editTarget, form]);

  const onSubmit = useCallback(
    async (values: CreateUpstreamForm) => {
      try {
        if (isEdit) {
          await updateUpstream.mutateAsync({
            id: editTarget.id,
            name: values.name,
            baseUrl: values.baseUrl,
            enabled: values.enabled,
          });
          toast.success(t("ai-upstreams.toast.updated"));
        } else {
          await createUpstream.mutateAsync(values);
          toast.success(t("ai-upstreams.toast.created"));
        }
        onOpenChange(false);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t(isEdit ? "ai-upstreams.toast.update-error" : "ai-upstreams.toast.create-error"),
        );
      }
    },
    [isEdit, editTarget, createUpstream, updateUpstream, onOpenChange, t],
  );

  const isPending = createUpstream.isPending || updateUpstream.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? "ai-upstreams.dialog.edit-title" : "ai-upstreams.dialog.create-title")}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-upstreams.form.name")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("ai-upstreams.form.name-ph")} />
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
                    <FormLabel>{t("ai-upstreams.form.base-url")}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t("ai-upstreams.form.base-url-ph")} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-3">
                    <FormLabel>{t("ai-upstreams.form.enabled")}</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t(isEdit ? "ai-upstreams.btn.save" : "ai-upstreams.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Confirmation ─────────────────────────────────────────────

function DeleteUpstreamDialog({
  target,
  onClose,
}: {
  target: AiUpstreamOverviewItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteUpstream = useDeleteAiUpstream();

  const handleDelete = useCallback(async () => {
    if (!target) return;
    try {
      await deleteUpstream.mutateAsync(target.id);
      toast.success(t("ai-upstreams.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-upstreams.toast.delete-error"));
    }
  }, [target, deleteUpstream, onClose, t]);

  return (
    <Dialog open={!!target} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ai-upstreams.dialog.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">{t("ai-upstreams.dialog.delete-body")}</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleteUpstream.isPending}>
            {deleteUpstream.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("ai-upstreams.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
