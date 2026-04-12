import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Check, Copy, Key, Plus } from "lucide-react";
import { toast } from "sonner";

import type { UserKey } from "@/web/api/schemas";
import { useCreateUserKey, useRevealUserKey, useUserKeys } from "@/web/api/user-hooks";
import { Header } from "@/web/components/dashboard/header";
import { Badge } from "@/web/components/ui/badge";
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
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { cn } from "@/web/shared/utils";

export default function UserKeysPage() {
  const { t } = useTranslation();
  const { data: keys = [], isLoading } = useUserKeys();
  const [showCreate, setShowCreate] = useState(false);

  const handleOpenCreate = useCallback(() => setShowCreate(true), []);

  return (
    <div>
      <Header title={t("user.keys.title")} description={t("user.keys.desc")} />

      <div className="p-4 md:p-8 space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Key className="h-4 w-4" />
                {t("user.keys.title")}
              </CardTitle>
              <Button size="sm" onClick={handleOpenCreate}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t("user.keys.create")}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : keys.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("user.keys.empty")}
              </p>
            ) : (
              <KeyTable keys={keys} />
            )}
          </CardContent>
        </Card>

        <CreateKeyDialog open={showCreate} onOpenChange={setShowCreate} />
      </div>
    </div>
  );
}

// ── Create Key Dialog (two-step: form → result with copy) ────────

function CreateKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const createKey = useCreateUserKey();

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;
    try {
      const result = await createKey.mutateAsync({ name: name.trim() });
      setCreatedKey(result.apiKey);
      toast.success(t("user.keys.toast.created"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("user.keys.toast.create-error"));
    }
  }, [name, createKey, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSubmit();
    },
    [handleSubmit],
  );

  const handleCopy = useCallback(async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success(t("user.keys.copied"));
    setTimeout(() => setCopied(false), 2000);
  }, [createdKey, t]);

  const handleClose = useCallback(() => {
    setName("");
    setCreatedKey(null);
    setCopied(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Step 2: Show created key with copy
  if (createdKey) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent preventClose>
          <DialogHeader>
            <DialogTitle>{t("user.keys.created-notice")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("user.keys.created-warning")}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                {createdKey}
              </code>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button onClick={handleClose}>{t("user.keys.dismiss")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 1: Name input form
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>{t("user.keys.create-title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form className="space-y-4">
            <div className="space-y-2">
              <Label>{t("user.keys.name-label")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("user.keys.name-ph")}
                autoFocus
              />
            </div>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.btn.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createKey.isPending}>
            {createKey.isPending ? t("common.btn.creating") : t("user.keys.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Key Table with copy ──────────────────────────────────────────

function KeyTable({ keys }: { keys: UserKey[] }) {
  const { t } = useTranslation();
  const revealKey = useRevealUserKey();

  const handleCopy = useCallback(
    async (id: number) => {
      try {
        const { apiKey } = await revealKey.mutateAsync(id);
        await navigator.clipboard.writeText(apiKey);
        toast.success(t("user.keys.copied"));
      } catch {
        toast.error(t("user.keys.toast.copy-error"));
      }
    },
    [revealKey, t],
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("user.keys.th.name")}</TableHead>
          <TableHead>{t("user.keys.th.prefix")}</TableHead>
          <TableHead>{t("user.keys.th.status")}</TableHead>
          <TableHead>{t("user.keys.th.created")}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k.id}>
            <TableCell className="font-medium">{k.name}</TableCell>
            <TableCell className="font-mono text-xs">{k.apiKeyPrefix}...</TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  k.status === "active"
                    ? "border-green-500/30 bg-green-500/10 text-green-600"
                    : "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
                )}
              >
                {t(`user.keys.status.${k.status}`)}
              </Badge>
            </TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              {formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleCopy(k.id)}
                disabled={revealKey.isPending}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
