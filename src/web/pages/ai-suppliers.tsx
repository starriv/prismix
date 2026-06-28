import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, ExternalLink, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/web/components/ui/popover";
import { ScrollArea } from "@/web/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { getSvglIconUrl, searchSvglIcons, type SvglIcon } from "@/web/shared/svgl-icons";

import { BEDROCK_REGIONS } from "./supplier-connections/constants";

const urlSchema = z.string().url();

const authTypes = ["bearer", "api-key", "cloudflare", "sigv4"] as const;

const supplierFormSchema = z
  .object({
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
    authType: z.enum(authTypes),
    apiKeyHeaderName: z.string().trim().max(100, "common.valid.range").optional(),
    cloudflareClientId: z.string().trim().max(255, "common.valid.range").optional(),
    sigv4Region: z.string().optional(),
    sigv4AccessKeyId: z.string().trim().max(255, "common.valid.range").optional(),
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
  })
  .refine((d) => d.authType !== "cloudflare" || !!d.cloudflareClientId?.trim(), {
    message: "common.valid.required",
    path: ["cloudflareClientId"],
  })
  .refine((d) => d.authType !== "sigv4" || !!d.sigv4Region, {
    message: "common.valid.required",
    path: ["sigv4Region"],
  })
  .refine((d) => d.authType !== "sigv4" || !!d.sigv4AccessKeyId?.trim(), {
    message: "common.valid.required",
    path: ["sigv4AccessKeyId"],
  });

type SupplierFormValues = z.infer<typeof supplierFormSchema>;

const EMPTY_SUPPLIER_FORM: SupplierFormValues = {
  supplierId: "",
  name: "",
  iconUrl: "",
  authType: "bearer",
  apiKeyHeaderName: "x-api-key",
  cloudflareClientId: "",
  sigv4Region: "us-east-1",
  sigv4AccessKeyId: "",
  officialConcurrencyLimit: "",
  officialQueueTimeoutMs: "30000",
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
        accessorKey: "authType",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">{row.original.authType}</DataTableBadge>
        ),
        header: t("ai-suppliers.th.auth-type"),
        meta: { headerClassName: "w-[14%]" },
      },
      {
        accessorKey: "officialConcurrencyLimit",
        cell: ({ row }) => (
          <DataTableText mono nowrap>
            {row.original.officialConcurrencyLimit ?? t("ai-suppliers.none")}
          </DataTableText>
        ),
        header: t("ai-suppliers.th.official-limit"),
        meta: { headerClassName: "w-[16%]", ...dataTableMeta.hiddenOnMobile },
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
          tableClassName="min-w-[920px]"
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
  const watchedAuthType = useWatch({ control: form.control, name: "authType" });
  const watchedSupplierId = useWatch({ control: form.control, name: "supplierId" });
  const watchedName = useWatch({ control: form.control, name: "name" });
  const svglSearchHint = watchedName?.trim() || watchedSupplierId?.trim() || "";

  useEffect(() => {
    if (!open) return;

    if (editTarget) {
      const authConfig = (editTarget.authConfig ?? {}) as Record<string, unknown>;
      form.reset({
        supplierId: editTarget.supplierId,
        name: editTarget.name,
        iconUrl: editTarget.iconUrl ?? "",
        authType: (authTypes.includes(editTarget.authType as SupplierFormValues["authType"])
          ? editTarget.authType
          : "bearer") as SupplierFormValues["authType"],
        apiKeyHeaderName: (authConfig.headerName as string | undefined) ?? "x-api-key",
        cloudflareClientId: (authConfig.clientId as string | undefined) ?? "",
        sigv4Region: (authConfig.region as string | undefined) ?? "us-east-1",
        sigv4AccessKeyId: (authConfig.accessKeyId as string | undefined) ?? "",
        officialConcurrencyLimit: editTarget.officialConcurrencyLimit
          ? String(editTarget.officialConcurrencyLimit)
          : "",
        officialQueueTimeoutMs: String(editTarget.officialQueueTimeoutMs ?? 30_000),
        enabled: editTarget.enabled,
      });
      return;
    }

    form.reset(EMPTY_SUPPLIER_FORM);
  }, [editTarget, form, open]);

  const handleSubmit = form.handleSubmit(async (values) => {
    let authConfig: Record<string, unknown> = {};
    if (values.authType === "api-key") {
      authConfig = { headerName: values.apiKeyHeaderName?.trim() || "x-api-key" };
    } else if (values.authType === "cloudflare") {
      authConfig = { clientId: values.cloudflareClientId?.trim() ?? "" };
    } else if (values.authType === "sigv4") {
      authConfig = {
        region: values.sigv4Region,
        service: "bedrock",
        accessKeyId: values.sigv4AccessKeyId?.trim() ?? "",
      };
    }
    const officialConcurrencyLimit =
      values.officialConcurrencyLimit === "" ? null : Number(values.officialConcurrencyLimit);
    const officialQueueTimeoutMs = Number(values.officialQueueTimeoutMs);
    const body = {
      name: values.name.trim(),
      iconUrl: values.iconUrl.trim(),
      authType: values.authType,
      authConfig,
      officialConcurrencyLimit,
      officialQueueTimeoutMs,
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
      <DialogContent className="sm:max-w-lg">
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
                      <div className="flex gap-2">
                        <Input
                          className="min-w-0"
                          placeholder={t("ai-suppliers.form.icon-url-ph")}
                          {...field}
                        />
                        <SvglIconPicker
                          searchHint={svglSearchHint}
                          value={field.value}
                          onSelect={field.onChange}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="authType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("ai-suppliers.form.auth-type")}</FormLabel>
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
              {watchedAuthType === "api-key" && (
                <FormField
                  control={form.control}
                  name="apiKeyHeaderName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-suppliers.form.api-key-header")}</FormLabel>
                      <FormControl>
                        <Input
                          className="font-mono"
                          placeholder={t("ai-suppliers.form.api-key-header-ph")}
                          {...field}
                        />
                      </FormControl>
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
                      <FormLabel>{t("ai-suppliers.form.cloudflare-client-id")}</FormLabel>
                      <FormControl>
                        <Input
                          className="font-mono"
                          placeholder={t("ai-suppliers.form.cloudflare-client-id-ph")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {watchedAuthType === "sigv4" && (
                <>
                  <FormField
                    control={form.control}
                    name="sigv4Region"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("ai-suppliers.form.sigv4-region")}</FormLabel>
                        <Select value={field.value ?? ""} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("ai-suppliers.form.sigv4-region-ph")} />
                          </SelectTrigger>
                          <SelectContent>
                            {BEDROCK_REGIONS.map((region) => (
                              <SelectItem key={region.code} value={region.code}>
                                {region.code} - {region.label}
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
                    name="sigv4AccessKeyId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("ai-suppliers.form.sigv4-access-key-id")}</FormLabel>
                        <FormControl>
                          <Input
                            className="font-mono"
                            placeholder={t("ai-suppliers.form.sigv4-access-key-id-ph")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="officialConcurrencyLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-suppliers.form.official-concurrency-limit")}</FormLabel>
                      <FormControl>
                        <Input
                          min={1}
                          placeholder={t("ai-suppliers.form.official-concurrency-limit-ph")}
                          step={1}
                          type="number"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="officialQueueTimeoutMs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("ai-suppliers.form.official-queue-timeout")}</FormLabel>
                      <FormControl>
                        <Input min={1} step={1} type="number" {...field} />
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

function SvglIconPicker({
  searchHint,
  value,
  onSelect,
}: {
  searchHint: string;
  value: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [icons, setIcons] = useState<SvglIcon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        setQuery(searchHint);
      }
      setOpen(nextOpen);
    },
    [searchHint],
  );

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);

      searchSvglIcons(query, controller.signal)
        .then(setIcons)
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;

          setIcons([]);
          setError(
            err instanceof Error
              ? t("ai-suppliers.svgl.search-error")
              : t("common.valid.unknown-error"),
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, t]);

  const svglUrl = useMemo(() => {
    const url = new URL("https://svgl.app/");
    const trimmed = query.trim() || searchHint.trim();
    if (trimmed) url.searchParams.set("search", trimmed);
    return url.toString();
  }, [query, searchHint]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          aria-label={t("ai-suppliers.svgl.open")}
          className="shrink-0"
          type="button"
          variant="outline"
        >
          <Search className="h-4 w-4" />
          SVGL
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-3">
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder={t("ai-suppliers.svgl.search-ph")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs text-muted-foreground">{t("ai-suppliers.svgl.title")}</p>
            <Button asChild className="h-auto p-0 text-xs" size="xs" type="button" variant="link">
              <a href={svglUrl} rel="noreferrer" target="_blank">
                <ExternalLink className="h-3 w-3" />
                svgl.app
              </a>
            </Button>
          </div>
          <div className="min-h-40">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("ai-suppliers.svgl.searching")}
              </div>
            ) : error ? (
              <div className="flex h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : icons.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {t("ai-suppliers.svgl.empty")}
              </div>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-1 pr-3">
                  {icons.map((icon) => {
                    const iconUrl = getSvglIconUrl(icon);
                    const selected = value === iconUrl;

                    return (
                      <button
                        key={`${icon.title}:${iconUrl}`}
                        className={
                          selected
                            ? "flex w-full items-center gap-3 rounded-md border border-primary bg-primary/5 p-2 text-left"
                            : "flex w-full items-center gap-3 rounded-md border border-transparent p-2 text-left hover:bg-muted"
                        }
                        type="button"
                        onClick={() => {
                          onSelect(iconUrl);
                          setOpen(false);
                        }}
                      >
                        <img
                          alt=""
                          className="h-8 w-8 shrink-0 rounded-md border bg-background object-contain p-1"
                          src={iconUrl}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{icon.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {formatSvglCategory(icon.category)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatSvglCategory(category: SvglIcon["category"]): string {
  if (Array.isArray(category)) return category.join(", ");
  return category ?? "SVGL";
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
