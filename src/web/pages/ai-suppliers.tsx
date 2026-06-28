import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiSuppliers,
  useCreateAiSupplier,
  useDeleteAiSupplier,
  useUpdateAiSupplier,
} from "@/web/api/hooks";
import type { AiSupplier } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
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
import { Switch } from "@/web/components/ui/switch";

const urlSchema = z.string().url();

const supplierFormSchema = z.object({
  supplierId: z
    .string()
    .trim()
    .min(1, "common.valid.required")
    .max(50, "common.valid.range")
    .regex(/^[a-z0-9-]+$/, "ai-suppliers.valid.supplier-id"),
  name: z.string().trim().min(1, "common.valid.name-required").max(100, "common.valid.range"),
  iconUrl: z
    .string()
    .trim()
    .max(500, "common.valid.range")
    .refine((value) => value === "" || urlSchema.safeParse(value).success, {
      message: "common.valid.invalid-url",
    }),
  enabled: z.boolean(),
});

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  supplierId: "",
  name: "",
  iconUrl: "",
  enabled: true,
};

export default function AiSuppliersPage() {
  const { t, i18n } = useTranslation();
  const { data: suppliers = [], isLoading } = useAiSuppliers();
  const updateSupplier = useUpdateAiSupplier();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiSupplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiSupplier | null>(null);

  const sortedSuppliers = useMemo(
    () =>
      [...suppliers].sort((a, b) =>
        a.name.localeCompare(b.name, i18n.language, { sensitivity: "base" }),
      ),
    [i18n.language, suppliers],
  );

  const handleToggle = useCallback(
    async (supplier: AiSupplier, enabled: boolean) => {
      try {
        await updateSupplier.mutateAsync({ id: supplier.id, enabled });
        toast.success(t("ai-suppliers.toast.updated"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("ai-suppliers.toast.update-error"));
      }
    },
    [t, updateSupplier],
  );

  const columns = useMemo<ColumnDef<AiSupplier>[]>(
    () => [
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <SupplierIcon supplier={row.original} />
            <DataTableText className="min-w-0 font-medium" truncate>
              {row.original.name}
            </DataTableText>
          </div>
        ),
        header: t("common.th.name"),
        meta: { headerClassName: "w-[24%]" },
      },
      {
        accessorKey: "supplierId",
        cell: ({ row }) => (
          <DataTableText mono nowrap>
            {row.original.supplierId}
          </DataTableText>
        ),
        header: t("ai-suppliers.th.supplier-id"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "iconUrl",
        cell: ({ row }) => (
          <DataTableText className="max-w-[240px]" muted truncate>
            {row.original.iconUrl || t("ai-suppliers.none")}
          </DataTableText>
        ),
        header: t("ai-suppliers.th.icon-url"),
        meta: { headerClassName: "w-[26%]", ...dataTableMeta.hiddenOnMobile },
      },
      {
        accessorKey: "enabled",
        cell: ({ row }) => {
          const supplier = row.original;
          return (
            <div className="flex items-center gap-2">
              <Switch
                checked={supplier.enabled}
                disabled={updateSupplier.isPending}
                onCheckedChange={(enabled) => void handleToggle(supplier, enabled)}
              />
              <DataTableBadge variant={supplier.enabled ? "secondary" : "outline"}>
                {supplier.enabled ? t("common.status.active") : t("common.status.disabled")}
              </DataTableBadge>
            </div>
          );
        },
        header: t("ai-suppliers.th.enabled"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[12%]", ...dataTableMeta.hiddenOnMobile },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              aria-label={t("ai-suppliers.actions.edit", { name: row.original.name })}
              size="icon"
              variant="ghost"
              onClick={() => setEditTarget(row.original)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              aria-label={t("ai-suppliers.actions.delete", { name: row.original.name })}
              size="icon"
              variant="ghost"
              onClick={() => setDeleteTarget(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: "",
        meta: { headerClassName: "w-[8%]", ...dataTableMeta.right },
      },
    ],
    [handleToggle, i18n.language, t, updateSupplier.isPending],
  );

  return (
    <div>
      <Header title={t("ai-suppliers.title")} description={t("ai-suppliers.desc")} />

      <div className="space-y-4 p-4 md:space-y-6 md:p-8">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("ai-suppliers.btn.new")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={sortedSuppliers}
          emptyText={t("ai-suppliers.empty")}
          getRowId={(row) => String(row.id)}
          loading={isLoading}
          showPagination={false}
          tableClassName="min-w-[860px]"
        />
      </div>

      <SupplierFormDialog
        editTarget={editTarget}
        open={createOpen || !!editTarget}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTarget(null);
          }
        }}
      />
      <DeleteSupplierDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

function SupplierIcon({ supplier }: { supplier: AiSupplier }) {
  if (supplier.iconUrl) {
    return (
      <img
        alt=""
        className="h-8 w-8 shrink-0 rounded-md border bg-muted object-contain"
        src={supplier.iconUrl}
      />
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
      <Building2 className="h-4 w-4" />
    </div>
  );
}

function SupplierFormDialog({
  open,
  onOpenChange,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: AiSupplier | null;
}) {
  const { t } = useTranslation();
  const createSupplier = useCreateAiSupplier();
  const updateSupplier = useUpdateAiSupplier();
  const isEdit = !!editTarget;
  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: EMPTY_SUPPLIER_FORM,
  });

  useEffect(() => {
    if (!open) return;

    if (editTarget) {
      form.reset({
        supplierId: editTarget.supplierId,
        name: editTarget.name,
        iconUrl: editTarget.iconUrl ?? "",
        enabled: editTarget.enabled,
      });
      return;
    }

    form.reset(EMPTY_SUPPLIER_FORM);
  }, [editTarget, form, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    const body = {
      name: values.name.trim(),
      iconUrl: values.iconUrl.trim(),
      enabled: values.enabled,
    };

    try {
      if (editTarget) {
        await updateSupplier.mutateAsync({ id: editTarget.id, ...body });
        toast.success(t("ai-suppliers.toast.updated"));
      } else {
        await createSupplier.mutateAsync({
          supplierId: values.supplierId.trim(),
          ...body,
        });
        toast.success(t("ai-suppliers.toast.created"));
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t(isEdit ? "ai-suppliers.toast.update-error" : "ai-suppliers.toast.create-error"),
      );
    }
  });

  const isPending = createSupplier.isPending || updateSupplier.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? "ai-suppliers.dialog.edit-title" : "ai-suppliers.dialog.create-title")}
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
                    <FormLabel>{t("ai-suppliers.form.supplier-id")}</FormLabel>
                    <FormControl>
                      <Input
                        className="font-mono"
                        disabled={isEdit}
                        placeholder={t("ai-suppliers.form.supplier-id-ph")}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {t("ai-suppliers.form.supplier-id-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-suppliers.form.name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-suppliers.form.name-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="iconUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-suppliers.form.icon-url")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("ai-suppliers.form.icon-url-ph")} {...field} />
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
                    <FormLabel>{t("ai-suppliers.form.enabled")}</FormLabel>
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
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t(isEdit ? "common.btn.save" : "ai-suppliers.btn.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSupplierDialog({
  target,
  onClose,
}: {
  target: AiSupplier | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteSupplier = useDeleteAiSupplier();

  const handleDelete = useCallback(async () => {
    if (!target) return;

    try {
      await deleteSupplier.mutateAsync(target.id);
      toast.success(t("ai-suppliers.toast.deleted"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("ai-suppliers.toast.delete-error"));
    }
  }, [deleteSupplier, onClose, t, target]);

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("ai-suppliers.dialog.delete-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-muted-foreground">
            {t("ai-suppliers.dialog.delete-body", { name: target?.name ?? "" })}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.btn.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleteSupplier.isPending}
          >
            {deleteSupplier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("common.btn.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
