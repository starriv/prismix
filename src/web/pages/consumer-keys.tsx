import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { BarChart3, Check, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import { z } from "zod";

import {
  useCreateRelayKey,
  useDeleteRelayKey,
  usePayAgents,
  useRelayKeys,
  useRevealRelayKey,
} from "@/web/api/hooks";
import type { RelayConsumerKey } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { LocaleLink } from "@/web/components/locale-link";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

export default function ConsumerKeysPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useRelayKeys();
  const { data: allAgents = [] } = usePayAgents();
  const deleteKey = useDeleteRelayKey();
  const revealKey = useRevealRelayKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RelayConsumerKey | null>(null);

  // Build agent name lookup
  const agentNameById = useMemo(() => new Map(allAgents.map((a) => [a.id, a.name])), [allAgents]);

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

  return (
    <div>
      <Header title={t("consumer-keys.title")} description={t("consumer-keys.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <Button size="sm" onClick={() => setCreateOpen(true)} className="ml-auto">
                <Plus className="h-4 w-4 mr-1" />
                {t("consumer-keys.btn.new")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("consumer-keys.empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("consumer-keys.th.name")}</TableHead>
                    <TableHead>{t("consumer-keys.th.prefix")}</TableHead>
                    <TableHead>{t("consumer-keys.th.agent")}</TableHead>
                    <TableHead>{t("consumer-keys.th.status")}</TableHead>
                    <TableHead>{t("consumer-keys.th.last-used")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell className="font-mono text-xs">{k.apiKeyPrefix}&hellip;</TableCell>
                      <TableCell className="text-sm">
                        <LocaleLink
                          to={`/admin/pay-agents?id=${k.agentId}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {agentNameById.get(k.agentId) ?? `Agent #${k.agentId}`}
                          <ExternalLink className="h-3 w-3" />
                        </LocaleLink>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={match(k.status)
                            .with("active", () => "default" as const)
                            .otherwise(() => "destructive" as const)}
                        >
                          {t(`consumer-keys.status.${k.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {k.lastUsedAt
                          ? formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })
                          : t("consumer-keys.never")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" asChild>
                            <LocaleLink to={`/admin/ai-usage?key=${k.id}`}>
                              <BarChart3 className="h-3.5 w-3.5" />
                            </LocaleLink>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyKey(k.id)}
                            disabled={revealKey.isPending}
                            aria-label={t("common.btn.copy")}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(k)}
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

  useEffect(() => {
    if (!open) {
      form.reset({ name: "", initialBalance: "", markupPercent: "" });
      setCreatedKey(null);
      setCopied(false);
    }
  }, [open, form]);

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
      <Dialog open={open} onOpenChange={onOpenChange}>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
