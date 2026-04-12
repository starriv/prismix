import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { Link2, Loader2, Megaphone, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  useAdminAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useSendAnnouncement,
  useUpdateAnnouncement,
} from "@/web/api/admin-hooks";
import type { Announcement, CreateAnnouncementBody } from "@/web/api/schemas";
import { createAnnouncementBody } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";
import { Textarea } from "@/web/components/ui/textarea";
import { getDateLocale } from "@/web/shared/date-locale";

export default function AdminAnnouncementsPage() {
  const { t, i18n } = useTranslation();
  const { data: announcements = [], isLoading } = useAdminAnnouncements();
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

  return (
    <>
      <Header title={t("admin.announce.title")} description={t("admin.announce.desc")} />
      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {/* Top action bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {t("admin.announce.count", { count: announcements.length })}
            </span>
          </div>
          <Button size="sm" onClick={() => setComposeOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            {t("admin.announce.btn.compose")}
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <span className="animate-spin">
                  <Loader2 className="h-5 w-5 text-muted-foreground" />
                </span>
              </div>
            ) : announcements.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t("admin.announce.table-empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.announce.th.title")}</TableHead>
                    <TableHead>{t("admin.announce.th.status")}</TableHead>
                    <TableHead>{t("admin.announce.th.created-by")}</TableHead>
                    <TableHead>{t("admin.announce.th.created-at")}</TableHead>
                    <TableHead>{t("admin.announce.th.sent-at")}</TableHead>
                    <TableHead className="text-right">{t("admin.announce.th.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {announcements.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {a.title}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={a.status === "sent" ? "default" : "outline"}
                          className={
                            a.status === "sent"
                              ? "bg-green-500/10 text-green-600 border-green-500/20"
                              : ""
                          }
                        >
                          {t(`admin.announce.status.${a.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {a.createdBy}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDistanceToNow(new Date(a.createdAt), {
                          addSuffix: true,
                          locale: getDateLocale(i18n.language),
                        })}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">
                        {a.sentAt
                          ? formatDistanceToNow(new Date(a.sentAt), {
                              addSuffix: true,
                              locale: getDateLocale(i18n.language),
                            })
                          : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {a.status === "draft" && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setEditing(a)}
                                aria-label={t("common.btn.edit")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-primary"
                                onClick={() => setSendTarget(a)}
                                aria-label={t("common.a11y.send")}
                              >
                                <Send className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setDeleteTarget(a)}
                            aria-label={t("common.btn.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
            <p className="text-sm text-muted-foreground">{t("admin.announce.send-confirm-desc")}</p>
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
              {t("admin.announce.btn.send")}
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
    </>
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
    defaultValues: {
      title: editing?.title ?? "",
      body: editing?.body ?? "",
      link: editing?.link ?? "",
    },
  });

  useEffect(() => {
    form.reset({
      title: editing?.title ?? "",
      body: editing?.body ?? "",
      link: editing?.link ?? "",
    });
  }, [editing, form]);

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, ...data });
        toast.success(t("admin.announce.toast.updated"));
      } else {
        await createMutation.mutateAsync(data);
        toast.success(t("admin.announce.toast.created"));
      }
      form.reset({ title: "", body: "", link: "" });
      onOpenChange(false);
    } catch {
      toast.error(
        editing ? t("admin.announce.toast.update-error") : t("admin.announce.toast.create-error"),
      );
    }
  });

  const bodyValue = form.watch("body");
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
