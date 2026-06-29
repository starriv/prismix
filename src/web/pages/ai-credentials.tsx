import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiCredentials,
  useAiEndpointCredentialsAll,
  useAiSuppliers,
  useCreateAiCredential,
  useDeleteAiCredential,
  useKeyProviders,
  useUpdateAiCredential,
} from "@/web/api/hooks";
import type { AiCredential, AiEndpointCredential } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
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
import { LongText } from "@/web/components/ui/long-text";
import { SecretInput } from "@/web/components/ui/secret-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { buildReadableId, randomReadableIdSuffix } from "@/web/shared/readable-id";

interface CredentialRow extends AiCredential {
  assignments: AiEndpointCredential[];
  enabledAssignments: number;
  lastActivityAt: Date | number | string | null;
}

const credentialFormSchema = z.object({
  supplierId: z.number().int().positive("common.valid.required"),
  name: z.string().min(1, "common.valid.name-required"),
  apiKey: z.string().min(1, "common.valid.required"),
  ownerId: z.number().int().positive().nullable().optional(),
});
type CredentialFormValues = z.infer<typeof credentialFormSchema>;

function latestDate(
  ...values: Array<Date | number | string | null | undefined>
): Date | number | string | null {
  const timestamps = values
    .filter((value): value is Date | number | string => value != null)
    .map((value) => ({ value, ts: new Date(value).getTime() }))
    .filter((entry) => Number.isFinite(entry.ts))
    .sort((a, b) => b.ts - a.ts);
  return timestamps[0]?.value ?? null;
}

export default function AiCredentialsPage() {
  const { t, i18n } = useTranslation();
  const { data: credentials = [], isLoading: credentialsLoading } = useAiCredentials();
  const { data: assignments = [], isLoading: assignmentsLoading } = useAiEndpointCredentialsAll();
  const updateCredential = useUpdateAiCredential();
  const deleteCredential = useDeleteAiCredential();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CredentialRow | null>(null);

  const rows = useMemo<CredentialRow[]>(() => {
    const assignmentsByCredential = new Map<number, AiEndpointCredential[]>();
    for (const assignment of assignments) {
      const list = assignmentsByCredential.get(assignment.credentialId) ?? [];
      list.push(assignment);
      assignmentsByCredential.set(assignment.credentialId, list);
    }

    return credentials.map((credential) => {
      const credentialAssignments = assignmentsByCredential.get(credential.id) ?? [];
      return {
        ...credential,
        assignments: credentialAssignments,
        enabledAssignments: credentialAssignments.filter((assignment) => assignment.enabled).length,
        lastActivityAt: latestDate(
          credential.lastUsedAt,
          ...credentialAssignments.map((assignment) => assignment.lastUsedAt),
        ),
      };
    });
  }, [credentials, assignments]);

  const handleToggle = useCallback(
    async (credential: CredentialRow) => {
      try {
        await updateCredential.mutateAsync({
          id: credential.id,
          enabled: !credential.enabled,
        });
        toast.success(t("ai-credentials.toast.updated"));
      } catch {
        toast.error(t("ai-credentials.toast.update-error"));
      }
    },
    [updateCredential, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCredential.mutateAsync(deleteTarget.id);
      toast.success(t("ai-credentials.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("ai-credentials.toast.delete-error"));
    }
  }, [deleteCredential, deleteTarget, t]);

  const columns = useMemo<ColumnDef<CredentialRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("ai-credentials.table.credential"),
        cell: ({ row }) => (
          <div className="min-w-0 space-y-1">
            <DataTableText truncate className="font-medium">
              {row.original.name}
            </DataTableText>
            <LongText value={row.original.keyPrefix} kind="secret" head={8} />
          </div>
        ),
        meta: { minWidth: 180 },
      },
      {
        accessorKey: "supplierName",
        header: t("ai-credentials.table.supplier"),
        cell: ({ row }) => (
          <DataTableBadge variant="outline">
            {row.original.supplierName ?? t("common.status.unknown")}
          </DataTableBadge>
        ),
        meta: dataTableMeta.hiddenOnMobile,
      },
      {
        accessorKey: "ownerName",
        header: t("ai-credentials.table.owner"),
        cell: ({ row }) => (
          <DataTableText muted truncate>
            {row.original.ownerName ?? t("ai-credentials.platform")}
          </DataTableText>
        ),
        meta: dataTableMeta.hiddenOnMobile,
      },
      {
        id: "assignments",
        header: t("ai-credentials.table.references"),
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col items-start gap-2 py-1">
            <DataTableText numeric className="block leading-none">
              {t("ai-credentials.reference-count", {
                enabled: row.original.enabledAssignments,
                total: row.original.assignments.length,
              })}
            </DataTableText>
            {row.original.assignments.length > 0 && (
              <div className="flex max-w-[280px] flex-wrap gap-x-1.5 gap-y-1">
                {row.original.assignments.slice(0, 3).map((assignment) => (
                  <Badge
                    key={assignment.id}
                    variant="secondary"
                    className="max-w-full px-2 py-0.5 text-[10px] leading-4"
                  >
                    <span className="truncate">
                      {assignment.endpointName ?? `#${assignment.endpointId}`}
                      {assignment.upstreamName ? ` / ${assignment.upstreamName}` : ""}
                    </span>
                  </Badge>
                ))}
                {row.original.assignments.length > 3 && (
                  <Badge variant="outline" className="px-2 py-0.5 text-[10px] leading-4">
                    +{row.original.assignments.length - 3}
                  </Badge>
                )}
              </div>
            )}
          </div>
        ),
        meta: dataTableMeta.wrap,
      },
      {
        id: "lastActivityAt",
        header: t("ai-credentials.table.last-used"),
        cell: ({ row }) =>
          row.original.lastActivityAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.lastActivityAt} />
          ) : (
            <DataTableText muted>{t("ai-credentials.never")}</DataTableText>
          ),
        meta: dataTableMeta.hiddenOnMobile,
      },
      {
        accessorKey: "enabled",
        header: t("common.th.status"),
        cell: ({ row }) => (
          <Switch
            checked={row.original.enabled}
            onCheckedChange={() => handleToggle(row.original)}
            disabled={updateCredential.isPending}
            aria-label={t("ai-credentials.toggle", { name: row.original.name })}
          />
        ),
        meta: dataTableMeta.rightHiddenOnMobile,
      },
      {
        id: "actions",
        header: t("common.th.actions"),
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDeleteTarget(row.original)}
            aria-label={t("ai-credentials.delete", { name: row.original.name })}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ),
        meta: dataTableMeta.stickyRight,
      },
    ],
    [handleToggle, i18n.language, t, updateCredential.isPending],
  );

  return (
    <div>
      <Header title={t("ai-credentials.title")} description={t("ai-credentials.desc")} />

      <div className="space-y-4 p-4 md:p-8">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("ai-credentials.add")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          emptyText={t("ai-credentials.empty")}
          loading={credentialsLoading || assignmentsLoading}
          initialPageSize={10}
        />
      </div>

      <CredentialFormDialog
        credentials={credentials}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai-credentials.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="flex items-start gap-3 rounded-md border p-3">
              <KeyRound className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{deleteTarget?.name}</p>
                <LongText
                  value={deleteTarget?.keyPrefix}
                  kind="secret"
                  appearance="plain"
                  head={8}
                  showTooltip={false}
                  className="mt-1 block"
                />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("ai-credentials.dialog.delete-body", {
                name: deleteTarget?.name ?? "",
                count: deleteTarget?.assignments.length ?? 0,
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
              disabled={deleteCredential.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialFormDialog({
  open,
  onOpenChange,
  credentials,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentials: AiCredential[];
}) {
  const { t } = useTranslation();
  const createCredential = useCreateAiCredential();
  const { data: suppliers = [] } = useAiSuppliers();
  const { data: keyProviders = [] } = useKeyProviders();
  const credentialNameSuffix = useMemo(() => (open ? randomReadableIdSuffix() : ""), [open]);

  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.enabled),
    [suppliers],
  );
  const existingCredentialNames = useMemo(
    () => new Set(credentials.map((credential) => credential.name)),
    [credentials],
  );
  const activeKeyProviders = useMemo(
    () => keyProviders.filter((keyProvider) => keyProvider.status === "active"),
    [keyProviders],
  );

  const form = useForm<CredentialFormValues>({
    resolver: zodResolver(credentialFormSchema),
    defaultValues: { supplierId: 0, name: "", apiKey: "", ownerId: null },
  });
  const watchedSupplierId = useWatch({ control: form.control, name: "supplierId" });
  const selectedSupplier = useMemo(
    () => activeSuppliers.find((supplier) => supplier.id === watchedSupplierId),
    [activeSuppliers, watchedSupplierId],
  );
  const generatedCredentialName = useMemo(
    () =>
      buildReadableId({
        parts: [selectedSupplier?.name || selectedSupplier?.supplierId, "credential"],
        suffix: credentialNameSuffix,
        existingIds: existingCredentialNames,
        fallback: "credential",
      }),
    [
      credentialNameSuffix,
      existingCredentialNames,
      selectedSupplier?.name,
      selectedSupplier?.supplierId,
    ],
  );

  useEffect(() => {
    if (!open) return;
    const initialSupplier = activeSuppliers[0];
    form.reset({
      supplierId: initialSupplier?.id ?? 0,
      name: buildReadableId({
        parts: [initialSupplier?.name || initialSupplier?.supplierId, "credential"],
        suffix: credentialNameSuffix,
        existingIds: existingCredentialNames,
        fallback: "credential",
      }),
      apiKey: "",
      ownerId: null,
    });
  }, [activeSuppliers, credentialNameSuffix, existingCredentialNames, form, open]);

  useEffect(() => {
    if (!open || !selectedSupplier) return;
    form.setValue("name", generatedCredentialName, { shouldValidate: true });
  }, [form, generatedCredentialName, open, selectedSupplier]);

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await createCredential.mutateAsync({
        ...data,
        name: data.name.trim() || generatedCredentialName,
      });
      toast.success(t("ai-credentials.toast.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-credentials.toast.create-error"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("ai-credentials.dialog.create-title")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-credentials.form.supplier")}</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : ""}
                      onValueChange={(value) => field.onChange(Number(value))}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("ai-credentials.form.supplier-ph")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeSuppliers.map((supplier) => (
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
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-credentials.form.name")}</FormLabel>
                    <FormControl>
                      <Input disabled placeholder={t("ai-credentials.form.name-ph")} {...field} />
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
                    <FormLabel>{t("ai-credentials.form.api-key")}</FormLabel>
                    <FormControl>
                      <SecretInput placeholder={t("ai-credentials.form.api-key-ph")} {...field} />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      {t("ai-credentials.form.api-key-hint")}
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
                      <FormLabel>{t("ai-credentials.form.owner")}</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "none"}
                        onValueChange={(value) =>
                          field.onChange(value === "none" ? null : Number(value))
                        }
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("ai-credentials.form.owner-ph")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">
                            {t("ai-credentials.form.owner-none")}
                          </SelectItem>
                          {activeKeyProviders.map((keyProvider) => (
                            <SelectItem key={keyProvider.id} value={String(keyProvider.id)}>
                              {keyProvider.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
              <Button type="submit" disabled={createCredential.isPending}>
                {t("ai-credentials.add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
