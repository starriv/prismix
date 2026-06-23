import { useCallback, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { BarChart3, Check, Copy, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { z } from "zod";

import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import {
  useCreateRelayKey,
  useDeleteRelayKey,
  useRelayKeyList,
  useRevealRelayKey,
} from "@/web/api/hooks";
import type { RelayConsumerKey } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";

export default function ConsumerKeysPage() {
  const { t, i18n } = useTranslation();
  const deleteKey = useDeleteRelayKey();
  const revealKey = useRevealRelayKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RelayConsumerKey | null>(null);

  // ── Filter + Pagination (draft / applied pattern) ──
  const [draftPrefix, setDraftPrefix] = useState("");
  const [draftUserUuid, setDraftUserUuid] = useState("");
  const [appliedPrefix, setAppliedPrefix] = useState("");
  const [appliedUserUuid, setAppliedUserUuid] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const { data: keysData, isLoading } = useRelayKeyList({
    prefix: appliedPrefix || undefined,
    userUuid: appliedUserUuid || undefined,
    page: pagination.pageIndex,
  });
  const keys = useMemo(() => keysData?.items ?? [], [keysData?.items]);
  const keyPageCount = Math.ceil((keysData?.total ?? 0) / DEFAULT_PAGE_SIZE);

  const hasFilters =
    draftPrefix !== "" || draftUserUuid !== "" || appliedPrefix !== "" || appliedUserUuid !== "";

  const applyFilters = useCallback(() => {
    setAppliedPrefix(draftPrefix.trim());
    setAppliedUserUuid(draftUserUuid.trim());
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftPrefix, draftUserUuid]);

  const resetFilters = useCallback(() => {
    setDraftPrefix("");
    setDraftUserUuid("");
    setAppliedPrefix("");
    setAppliedUserUuid("");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  const handlePrefixChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftPrefix(e.target.value),
    [],
  );
  const handleUserUuidChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftUserUuid(e.target.value),
    [],
  );

  // ── Actions ──
  const handleCopyKey = useCallback(
    async (id: number) => {
      try {
        const { apiKey } = await revealKey.mutateAsync(id);
        await navigator.clipboard.writeText(apiKey);
        toast.success(t("consumer-keys.toast.copied"));
      } catch {
        toast.error(t("consumer-keys.toast.copy-error"));
      }
    },
    [revealKey, t],
  );

  const handleDelete = useCallback((key: RelayConsumerKey) => {
    setDeleteTarget(key);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteKey.mutateAsync(deleteTarget.id);
      toast.success(t("consumer-keys.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("consumer-keys.toast.delete-error"));
    }
  }, [deleteTarget, deleteKey, t]);

  const handleCloseDelete = useCallback(() => setDeleteTarget(null), []);

  const columns = useMemo<ColumnDef<RelayConsumerKey>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("consumer-keys.th.name"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "apiKeyPrefix",
        cell: ({ row }) => <DataTableText mono>{row.original.apiKeyPrefix}...</DataTableText>,
        header: t("consumer-keys.th.prefix"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "userUuid",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.userUuid ??
              (row.original.userId
                ? `#${row.original.userId} ${row.original.userName ?? ""}`
                : "—")}
          </DataTableText>
        ),
        header: t("consumer-keys.th.user"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "agentId",
        cell: ({ row }) => (
          <LocaleLink
            to={`/admin/pay-agents?id=${row.original.agentId}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Agent #{row.original.agentId}
            <ExternalLink className="h-3 w-3" />
          </LocaleLink>
        ),
        header: t("consumer-keys.th.agent"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <DataTableBadge
            variant={match(row.original.status)
              .with("active", () => "default" as const)
              .otherwise(() => "destructive" as const)}
          >
            {t(`consumer-keys.status.${row.original.status}`)}
          </DataTableBadge>
        ),
        header: t("consumer-keys.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "lastUsedAt",
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastUsedAt} />
          ) : (
            <DataTableText muted>{t("consumer-keys.never")}</DataTableText>
          ),
        header: t("consumer-keys.th.last-used"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" asChild>
              <LocaleLink to={`/admin/ai-usage?key=${row.original.id}`}>
                <BarChart3 className="h-3.5 w-3.5" />
              </LocaleLink>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopyKey(row.original.id)}
              disabled={revealKey.isPending}
              aria-label={t("common.btn.copy")}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(row.original)}
              aria-label={t("common.btn.delete")}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: {
          headerClassName: "w-[96px]",
          ...dataTableMeta.right,
        },
      },
    ],
    [handleCopyKey, handleDelete, i18n.language, revealKey.isPending, t],
  );

  return (
    <div>
      <Header title={t("consumer-keys.title")} description={t("consumer-keys.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t("consumer-keys.btn.new")}
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("consumer-keys.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              <Input
                placeholder={t("consumer-keys.filter-prefix-ph")}
                value={draftPrefix}
                onChange={handlePrefixChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[200px]"
              />
              <Input
                placeholder={t("consumer-keys.filter-uuid-ph")}
                value={draftUserUuid}
                onChange={handleUserUuidChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[240px]"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={applyFilters}>
                  <Search className="mr-1 h-3.5 w-3.5" />
                  {t("common.btn.search")}
                </Button>
                {hasFilters && (
                  <Button size="sm" variant="outline" onClick={resetFilters}>
                    {t("common.btn.reset")}
                  </Button>
                )}
              </div>
            </div>

            <DataTable
              columns={columns}
              data={keys}
              emptyText={t("consumer-keys.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              manualPagination
              onPaginationChange={setPagination}
              pageCount={keyPageCount}
              pagination={pagination}
              tableClassName="min-w-[980px]"
            />
          </CardContent>
        </Card>
      </div>

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={handleCloseDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("consumer-keys.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">{t("consumer-keys.dialog.delete-body")}</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDelete}>
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
    </div>
  );
}

// ── Create Dialog ────────────────────────────────────────────────────

const createKeyFormSchema = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  initialBalance: z.string().optional(),
  markupPercent: z.string().optional(),
});
type CreateKeyFormValues = z.infer<typeof createKeyFormSchema>;

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const createKey = useCreateRelayKey();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<CreateKeyFormValues>({
    resolver: zodResolver(createKeyFormSchema),
    defaultValues: { name: "", initialBalance: "", markupPercent: "" },
  });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        form.reset({ name: "", initialBalance: "", markupPercent: "" });
        setCreatedKey(null);
        setCopied(false);
      }
      onOpenChange(nextOpen);
    },
    [form, onOpenChange],
  );

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      const result = await createKey.mutateAsync({
        name: data.name,
        initialBalance: data.initialBalance || undefined,
        markupPercent: data.markupPercent ? Number(data.markupPercent) : undefined,
      });
      toast.success(t("consumer-keys.toast.created"));
      if (result.apiKey) setCreatedKey(result.apiKey);
    } catch {
      toast.error(t("consumer-keys.toast.create-error"));
    }
  });

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success(t("consumer-keys.toast.copied"));
    setTimeout(() => setCopied(false), 2000);
  }, [createdKey, t]);

  // After creation: show the key (matches pay-agents ApiKeyDialog pattern)
  if (createdKey) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent preventClose>
          <DialogHeader>
            <DialogTitle>{t("consumer-keys.dialog.created-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("consumer-keys.dialog.created-hint")}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={createdKey} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                aria-label={t("common.a11y.copy")}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>{t("common.btn.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Before creation: form
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("consumer-keys.dialog.create-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consumer-keys.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("consumer-keys.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="initialBalance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consumer-keys.form.initial-balance")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("consumer-keys.form.initial-balance-ph")} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t("consumer-keys.form.initial-balance-hint")}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="markupPercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("consumer-keys.form.markup")}</FormLabel>
                    <div className="flex items-center gap-2">
                      <FormControl className="flex-1">
                        <Input
                          placeholder={t("consumer-keys.form.markup-ph")}
                          {...field}
                          value={field.value ?? ""}
                          type="number"
                          min={0}
                          max={1000}
                        />
                      </FormControl>
                      <span className="text-sm text-muted-foreground shrink-0">%</span>
                    </div>
                    <FormDescription>{t("consumer-keys.form.markup-hint")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.btn.cancel")}
              </Button>
              <Button type="submit" disabled={createKey.isPending}>
                {t("consumer-keys.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
