import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Link2, Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_SEVERITIES,
  ANNOUNCEMENT_SURFACES,
} from "@/shared/announcements";
import {
  useAdminAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useSendAnnouncement,
  useUpdateAnnouncement,
} from "@/web/api/admin-hooks";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import type { Announcement, CreateAnnouncementBody } from "@/web/api/schemas";
import { createAnnouncementBody } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import {
  DataTable,
  DataTableBadge,
  dataTableMeta,
  DataTableRelativeTime,
  DataTableText,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Checkbox } from "@/web/components/ui/checkbox";
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
import { MarkdownRenderer } from "@/web/components/ui/markdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { Textarea } from "@/web/components/ui/textarea";

const DEFAULT_ANNOUNCEMENT_VALUES: CreateAnnouncementBody = {
  title: "",
  body: "",
  link: "",
  category: "general",
  severity: "info",
  surfaces: ["web"],
  relatedModels: [],
  startsAt: null,
  expiresAt: null,
  priority: 0,
};

function toDatetimeLocal(value: string | number | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function splitRelatedModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toAnnouncementFormValues(editing: Announcement | null): CreateAnnouncementBody {
  if (!editing) {
    return {
      ...DEFAULT_ANNOUNCEMENT_VALUES,
      surfaces: [...DEFAULT_ANNOUNCEMENT_VALUES.surfaces],
      relatedModels: [...DEFAULT_ANNOUNCEMENT_VALUES.relatedModels],
    };
  }
  return {
    title: editing.title,
    body: editing.body,
    link: editing.link ?? "",
    category: editing.category,
    severity: editing.severity,
    surfaces: editing.surfaces.length > 0 ? editing.surfaces : ["web"],
    relatedModels: editing.relatedModels,
    startsAt: toDatetimeLocal(editing.startsAt),
    expiresAt: toDatetimeLocal(editing.expiresAt),
    priority: editing.priority,
  };
}

function normalizeAnnouncementSubmit(data: CreateAnnouncementBody): CreateAnnouncementBody {
  return {
    ...data,
    link: data.link ?? "",
    relatedModels: data.relatedModels.map((item) => item.trim()).filter(Boolean),
    startsAt: data.startsAt ? new Date(data.startsAt).toISOString() : null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt).toISOString() : null,
  };
}

export default function AdminAnnouncementsPage() {
  const { t, i18n } = useTranslation();
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { data: announcementsData, isLoading } = useAdminAnnouncements({
    page: pagination.pageIndex,
  });
  const announcements = useMemo(() => announcementsData?.items ?? [], [announcementsData?.items]);
  const announcementPageCount = Math.ceil((announcementsData?.total ?? 0) / DEFAULT_PAGE_SIZE);
  const deleteAnnouncement = useDeleteAnnouncement();
  const sendAnnouncement = useSendAnnouncement();

  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [sendTarget, setSendTarget] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteAnnouncement.mutateAsync(deleteTarget.id);
      toast.success(t("admin.announce.toast.deleted"));
    } catch {
      toast.error(t("admin.announce.toast.delete-error"));
    }
    setDeleteTarget(null);
  };

  const handleSend = async () => {
    if (!sendTarget) return;
    try {
      await sendAnnouncement.mutateAsync(sendTarget.id);
      toast.success(t("admin.announce.toast.sent"));
    } catch {
      toast.error(t("admin.announce.toast.send-error"));
    }
    setSendTarget(null);
  };

  const columns = useMemo<ColumnDef<Announcement>[]>(
    () => [
      {
        accessorKey: "title",
        cell: ({ row }) => (
          <DataTableText className="max-w-[200px] font-medium" truncate>
            {row.original.title}
          </DataTableText>
        ),
        header: t("admin.announce.th.title"),
        meta: { headerClassName: "w-[28%] text-xs" },
      },
      {
        accessorKey: "category",
        cell: ({ row }) => (
          <DataTableBadge variant="outline">
            {t(`admin.announce.category.${row.original.category}`)}
          </DataTableBadge>
        ),
        header: t("admin.announce.th.category"),
        meta: { headerClassName: "w-[12%] text-xs" },
      },
      {
        accessorKey: "surfaces",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.surfaces.map((surface) => (
              <DataTableBadge key={surface} variant="outline">
                {t(`admin.announce.surface.${surface}`)}
              </DataTableBadge>
            ))}
          </div>
        ),
        header: t("admin.announce.th.surfaces"),
        meta: { headerClassName: "w-[16%] text-xs" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <DataTableBadge
            variant={row.original.status === "sent" ? "default" : "outline"}
            className={
              row.original.status === "sent"
                ? "border-green-500/20 bg-green-500/10 text-green-600"
                : undefined
            }
          >
            {t(`admin.announce.status.${row.original.status}`)}
          </DataTableBadge>
        ),
        header: t("admin.announce.th.status"),
        meta: { headerClassName: "w-[10%] text-xs" },
      },
      {
        accessorKey: "createdBy",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.createdBy}
          </DataTableText>
        ),
        header: t("admin.announce.th.created-by"),
        meta: { headerClassName: "w-[14%] text-xs" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
        ),
        header: t("admin.announce.th.created-at"),
        meta: { headerClassName: "w-[12%] text-xs" },
      },
      {
        accessorKey: "sentAt",
        cell: ({ row }) =>
          row.original.sentAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.sentAt} />
          ) : (
            <DataTableText muted>—</DataTableText>
          ),
        header: t("admin.announce.th.sent-at"),
        meta: { headerClassName: "w-[12%] text-xs" },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setEditing(row.original)}
              aria-label={t("common.btn.edit")}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-primary"
              onClick={() => setSendTarget(row.original)}
              aria-label={t("common.a11y.send")}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("common.btn.delete")}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
        enableHiding: false,
        header: t("admin.announce.th.actions"),
        meta: {
          headerClassName: "w-[12%] text-right text-xs",
          ...dataTableMeta.right,
        },
      },
    ],
    [i18n.language, t],
  );

  return (
    <div>
      <Header title={t("admin.announce.title")} description={t("admin.announce.desc")} />

      <div className="space-y-4 p-4 md:p-8">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setComposeOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("admin.announce.btn.compose")}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={announcements}
          emptyText={t("admin.announce.table-empty")}
          getRowId={(row) => String(row.id)}
          loading={isLoading}
          manualPagination
          onPaginationChange={setPagination}
          pageCount={announcementPageCount}
          pagination={pagination}
          tableClassName="min-w-[1180px]"
        />
      </div>

      {/* Compose / Edit dialog */}
      <ComposeDialog
        open={composeOpen || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setComposeOpen(false);
            setEditing(null);
          }
        }}
        editing={editing}
      />

      {/* Send confirmation */}
      <Dialog open={!!sendTarget} onOpenChange={(open) => !open && setSendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.announce.send-confirm-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {sendTarget?.status === "sent"
                ? t("admin.announce.resend-confirm-desc")
                : t("admin.announce.send-confirm-desc")}
            </p>
            {sendTarget && (
              <div className="mt-3 rounded-lg border bg-muted/50 p-3">
                <p className="text-sm font-medium">{sendTarget.title}</p>
                <div className="mt-1 max-h-40 overflow-y-auto">
                  <MarkdownRenderer
                    content={sendTarget.body}
                    className="text-xs text-muted-foreground"
                  />
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button onClick={handleSend} disabled={sendAnnouncement.isPending} className="gap-1.5">
              {sendAnnouncement.isPending && (
                <span className="animate-spin">
                  <Loader2 className="h-3.5 w-3.5" />
                </span>
              )}
              <Send className="h-3.5 w-3.5" />
              {sendTarget?.status === "sent"
                ? t("admin.announce.btn.resend")
                : t("admin.announce.btn.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("admin.announce.delete-confirm-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("admin.announce.delete-confirm-desc")}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteAnnouncement.isPending}
            >
              {deleteAnnouncement.isPending && (
                <span className="animate-spin">
                  <Loader2 className="h-3.5 w-3.5" />
                </span>
              )}
              {t("admin.announce.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Compose / Edit Dialog ────────────────────────────

function ComposeDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Announcement | null;
}) {
  const { t } = useTranslation();
  const createMutation = useCreateAnnouncement();
  const updateMutation = useUpdateAnnouncement();

  const form = useForm<CreateAnnouncementBody>({
    resolver: zodResolver(createAnnouncementBody),
    defaultValues: toAnnouncementFormValues(editing),
  });

  useEffect(() => {
    form.reset(toAnnouncementFormValues(editing));
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (data) => {
    const payload = normalizeAnnouncementSubmit(data);
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...payload });
        toast.success(t("admin.announce.toast.updated"));
      } else {
        await createMutation.mutateAsync(payload);
        toast.success(t("admin.announce.toast.created"));
      }
      form.reset(toAnnouncementFormValues(null));
      onOpenChange(false);
    } catch {
      toast.error(
        editing ? t("admin.announce.toast.update-error") : t("admin.announce.toast.create-error"),
      );
    }
  });

  const bodyValue = useWatch({ control: form.control, name: "body" });
  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? t("admin.announce.edit-title") : t("admin.announce.compose-title")}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form id="compose-form" onSubmit={onSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.announce.form.category")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ANNOUNCEMENT_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {t(`admin.announce.category.${category}`)}
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
                  name="severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.announce.form.severity")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ANNOUNCEMENT_SEVERITIES.map((severity) => (
                            <SelectItem key={severity} value={severity}>
                              {t(`admin.announce.severity.${severity}`)}
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
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.announce.form.priority")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={-1000}
                          max={1000}
                          {...field}
                          onChange={(event) =>
                            field.onChange(
                              Number.isNaN(event.target.valueAsNumber)
                                ? 0
                                : event.target.valueAsNumber,
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.announce.form.title")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("admin.announce.form.title-ph")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="link"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.announce.form.link")}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Link2 className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t("admin.announce.form.link-ph")}
                          className="pl-8"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="surfaces"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.announce.form.surfaces")}</FormLabel>
                    <div className="grid gap-2 rounded-md border p-3 md:grid-cols-3">
                      {ANNOUNCEMENT_SURFACES.map((surface) => {
                        const checked = field.value.includes(surface);
                        // Disable unchecking the last remaining surface so the
                        // min(1) invariant holds — gives visual feedback that it
                        // cannot be removed instead of silently no-op'ing.
                        const isLastChecked = checked && field.value.length === 1;
                        return (
                          <label key={surface} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={isLastChecked}
                              onCheckedChange={(nextChecked) => {
                                if (nextChecked === true) {
                                  field.onChange([...new Set([...field.value, surface])]);
                                  return;
                                }
                                const next = field.value.filter((item) => item !== surface);
                                field.onChange(next.length > 0 ? next : field.value);
                              }}
                            />
                            <span>{t(`admin.announce.surface.${surface}`)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("admin.announce.form.surfaces-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.announce.form.starts-at")}</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("admin.announce.form.expires-at")}</FormLabel>
                      <FormControl>
                        <Input
                          type="datetime-local"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(event.target.value || null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="relatedModels"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.announce.form.related-models")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        value={field.value.join("\n")}
                        placeholder={t("admin.announce.form.related-models-ph")}
                        className="font-mono text-sm"
                        onChange={(event) => field.onChange(splitRelatedModels(event.target.value))}
                      />
                    </FormControl>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("admin.announce.form.related-models-hint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("admin.announce.form.body")}</FormLabel>
                    <Tabs defaultValue="edit" className="w-full">
                      <TabsList className="w-full">
                        <TabsTrigger value="edit">{t("admin.announce.form.tab-edit")}</TabsTrigger>
                        <TabsTrigger value="preview">
                          {t("admin.announce.form.tab-preview")}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="edit">
                        <FormControl>
                          <Textarea
                            placeholder={t("admin.announce.form.body-ph")}
                            rows={10}
                            className="font-mono text-sm"
                            {...field}
                          />
                        </FormControl>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("admin.announce.form.body-hint")}
                        </p>
                      </TabsContent>
                      <TabsContent value="preview">
                        <div className="min-h-[240px] rounded-md border bg-muted/30 p-3">
                          {bodyValue ? (
                            <MarkdownRenderer content={bodyValue} />
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              {t("admin.announce.form.body-ph")}
                            </p>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button type="submit" form="compose-form" disabled={isPending} className="gap-1.5">
            {isPending && (
              <span className="animate-spin">
                <Loader2 className="h-3.5 w-3.5" />
              </span>
            )}
            {editing ? t("common.btn.save") : t("admin.announce.btn.compose")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
