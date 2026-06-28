import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { groupBy, orderBy } from "lodash-es";
import { Activity, Key, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import {
  useAiEndpointAssignments,
  useAiEndpointCredentials,
  useCreateAiEndpointCredential,
  useDeleteAiEndpointCredential,
  useKeyProviders,
  useTestAiEndpointCredential,
  useUpdateAiEndpoint,
  useUpdateAiEndpointCredential,
} from "@/web/api/hooks";
import type { AiEndpoint, AiEndpointCredential } from "@/web/api/schemas";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/web/components/ui/form";
import { Input } from "@/web/components/ui/input";
import { SecretInput } from "@/web/components/ui/secret-input";
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

import { DEFAULT_UPSTREAM_PRIORITY, DEFAULT_UPSTREAM_WEIGHT } from "./constants";

interface CredentialBucket {
  id: string;
  name: string;
  kind: string | null;
  upstreamId: number | null;
  priority: number;
  weight: number;
  enabled: boolean;
  credentials: AiEndpointCredential[];
}

export function EndpointCredentialBucketsSection({ endpoint }: { endpoint: AiEndpoint }) {
  const { t } = useTranslation();
  const { data: credentials = [], isLoading: credentialsLoading } = useAiEndpointCredentials(
    endpoint.id,
  );
  const { data: assignments = [] } = useAiEndpointAssignments(endpoint.id);
  const updateCredential = useUpdateAiEndpointCredential();
  const deleteCredential = useDeleteAiEndpointCredential();
  const testCredential = useTestAiEndpointCredential();
  const updateEndpoint = useUpdateAiEndpoint();

  const [addCredentialBucket, setAddCredentialBucket] = useState<CredentialBucket | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiEndpointCredential | null>(null);

  const buckets = useMemo<CredentialBucket[]>(() => {
    const grouped = groupBy(credentials, (credential) => credential.upstreamId ?? "official");

    const officialBucket: CredentialBucket = {
      id: "official",
      name: t("supplier-connections.credentials.official-bucket"),
      kind: null,
      upstreamId: null,
      priority: DEFAULT_UPSTREAM_PRIORITY,
      weight: DEFAULT_UPSTREAM_WEIGHT,
      enabled: true,
      credentials: orderBy(
        grouped["official"] ?? [],
        [
          (credential) => -(credential.weight ?? 1),
          (credential) => -(credential.lastUsedAt ? new Date(credential.lastUsedAt).getTime() : 0),
          "name",
        ],
        ["asc", "asc", "asc"],
      ),
    };

    const sortedAssignments = [...assignments].sort(
      (a, b) =>
        a.priority - b.priority ||
        b.weight - a.weight ||
        a.upstream.name.localeCompare(b.upstream.name),
    );

    const assignmentBuckets: CredentialBucket[] = sortedAssignments.map((assignment) => ({
      id: String(assignment.upstream.id),
      name: assignment.upstream.name,
      kind: assignment.upstream.kind,
      upstreamId: assignment.upstream.id,
      priority: assignment.priority,
      weight: assignment.weight,
      enabled: assignment.enabled && assignment.upstream.enabled,
      credentials: orderBy(
        grouped[String(assignment.upstream.id)] ?? [],
        [
          (credential) => -(credential.weight ?? 1),
          (credential) => -(credential.lastUsedAt ? new Date(credential.lastUsedAt).getTime() : 0),
          "name",
        ],
        ["asc", "asc", "asc"],
      ),
    }));

    return [officialBucket, ...assignmentBuckets];
  }, [credentials, assignments, t]);

  const strategy = endpoint.loadBalanceStrategy ?? "round-robin";

  const handleToggle = useCallback(
    async (credential: AiEndpointCredential) => {
      try {
        await updateCredential.mutateAsync({
          id: credential.id,
          enabled: !credential.enabled,
        });
        toast.success(t("supplier-connections.credentials.toast.updated"));
      } catch {
        toast.error(t("supplier-connections.credentials.toast.update-error"));
      }
    },
    [updateCredential, t],
  );

  const handleWeightChange = useCallback(
    async (credential: AiEndpointCredential, delta: number) => {
      const currentWeight = credential.weight ?? 1;
      const newWeight = Math.max(0, Math.min(100, currentWeight + delta));
      if (newWeight === currentWeight) return;
      try {
        await updateCredential.mutateAsync({ id: credential.id, weight: newWeight });
      } catch {
        toast.error(t("supplier-connections.credentials.toast.update-error"));
      }
    },
    [updateCredential, t],
  );

  const handleTest = useCallback(
    async (credential: AiEndpointCredential) => {
      try {
        const result = await testCredential.mutateAsync(credential.id);
        if (result.success) {
          toast.success(
            t("supplier-connections.credentials.toast.test-ok", { ms: result.latencyMs ?? 0 }),
          );
        } else {
          toast.error(result.error ?? t("supplier-connections.credentials.toast.test-error"));
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t("supplier-connections.credentials.toast.test-error"),
        );
      }
    },
    [testCredential, t],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCredential.mutateAsync(deleteTarget.id);
      toast.success(t("supplier-connections.credentials.toast.deleted"));
      setDeleteTarget(null);
    } catch {
      toast.error(t("supplier-connections.credentials.toast.delete-error"));
    }
  }, [deleteTarget, deleteCredential, t]);

  const handleStrategyChange = useCallback(
    async (newStrategy: string) => {
      try {
        await updateEndpoint.mutateAsync({ id: endpoint.id, loadBalanceStrategy: newStrategy });
        toast.success(t("supplier-connections.toast.updated"));
      } catch {
        toast.error(t("supplier-connections.toast.update-error"));
      }
    },
    [updateEndpoint, endpoint.id, t],
  );

  const totalCredentials = credentials.length;
  const showPool = totalCredentials > 1;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm">
                {t("supplier-connections.credentials.section-title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("supplier-connections.credentials.desc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {showPool && (
                <Select value={strategy} onValueChange={handleStrategyChange}>
                  <SelectTrigger className="h-7 w-auto gap-1 border-dashed px-2 text-xs">
                    <RefreshCw className="h-3 w-3" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round-robin">
                      {t("supplier-connections.credentials.strategy.round-robin")}
                    </SelectItem>
                    <SelectItem value="random">
                      {t("supplier-connections.credentials.strategy.random")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {credentialsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            buckets.map((bucket) => (
              <BucketCard
                key={bucket.id}
                bucket={bucket}
                showPool={showPool}
                onToggle={handleToggle}
                onWeightChange={handleWeightChange}
                onTest={handleTest}
                onDelete={setDeleteTarget}
                onAdd={() => {
                  if (!bucket.enabled) return;
                  setAddCredentialBucket(bucket);
                }}
                isToggling={updateCredential.isPending}
                isTesting={testCredential.isPending}
              />
            ))
          )}
        </CardContent>
      </Card>

      <AddCredentialToBucketDialog
        open={!!addCredentialBucket}
        onOpenChange={(v) => {
          if (!v) setAddCredentialBucket(null);
        }}
        endpoint={endpoint}
        bucket={addCredentialBucket}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("supplier-connections.credentials.dialog.delete-title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-muted-foreground">
              {t("supplier-connections.credentials.dialog.delete-body", {
                name: deleteTarget?.name ?? "",
              })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.btn.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteCredential.isPending}
            >
              {t("common.btn.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function BucketCard({
  bucket,
  showPool,
  onToggle,
  onWeightChange,
  onTest,
  onDelete,
  onAdd,
  isToggling,
  isTesting,
}: {
  bucket: CredentialBucket;
  showPool: boolean;
  onToggle: (credential: AiEndpointCredential) => void;
  onWeightChange: (credential: AiEndpointCredential, delta: number) => void;
  onTest: (credential: AiEndpointCredential) => void;
  onDelete: (credential: AiEndpointCredential) => void;
  onAdd: () => void;
  isToggling: boolean;
  isTesting: boolean;
}) {
  const { t } = useTranslation();
  const isOfficial = bucket.upstreamId === null;
  const enabledCount = bucket.credentials.filter((credential) => credential.enabled).length;
  const enabledPool = bucket.credentials.filter((credential) => credential.enabled);
  const nextCredentialId =
    enabledPool.length > 0
      ? orderBy(enabledPool, [(credential) => credential.lastUsedAt ?? ""], ["asc"])[0].id
      : null;

  return (
    <div className={cn("rounded-lg border", !bucket.enabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <Key className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{bucket.name}</span>
          {bucket.kind && (
            <Badge variant="outline" className="text-[10px]">
              {bucket.kind}
            </Badge>
          )}
          {isOfficial && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="text-[10px]">
                  P1000
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{t("supplier-connections.credentials.official-hint")}</TooltipContent>
            </Tooltip>
          )}
          {!isOfficial && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              P{bucket.priority} W{bucket.weight}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            {t("supplier-connections.credentials.count", {
              enabled: enabledCount,
              total: bucket.credentials.length,
            })}
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={onAdd}
          disabled={!bucket.enabled}
          title={!bucket.enabled ? t("common.status.disabled") : undefined}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t("supplier-connections.credentials.add")}
        </Button>
      </div>

      <div className="p-2 space-y-1.5">
        {bucket.credentials.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {t("supplier-connections.credentials.empty")}
          </div>
        ) : (
          bucket.credentials.map((credential) => {
            const isNext = credential.id === nextCredentialId;
            const weight = credential.weight ?? 1;
            return (
              <div
                key={credential.id}
                className={cn(
                  "rounded-md border px-3 py-2",
                  isNext && credential.enabled ? "border-primary/30 bg-primary/5" : "bg-muted/20",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "flex h-2 w-2 shrink-0 rounded-full",
                            !credential.enabled
                              ? "bg-muted-foreground/40"
                              : isNext
                                ? "bg-green-500 shadow-[0_0_6px_1px] shadow-green-500/40"
                                : "bg-green-500",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {!credential.enabled
                          ? t("common.status.disabled")
                          : isNext
                            ? t("supplier-connections.credentials.next")
                            : t("common.status.active")}
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-medium truncate">{credential.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {showPool && (
                      <div className="flex items-center gap-0.5 mr-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(credential, -1)}
                          disabled={weight <= 0}
                          aria-label={t("supplier-connections.credentials.weight-down")}
                        >
                          <span className="text-xs font-bold">-</span>
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-8 text-center text-xs font-mono tabular-nums">
                              {weight}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("supplier-connections.credentials.weight-hint")}
                          </TooltipContent>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(credential, 1)}
                          disabled={weight >= 100}
                          aria-label={t("supplier-connections.credentials.weight-up")}
                        >
                          <span className="text-xs font-bold">+</span>
                        </Button>
                      </div>
                    )}
                    <Switch
                      checked={credential.enabled}
                      onCheckedChange={() => onToggle(credential)}
                      disabled={isToggling}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onTest(credential)}
                      disabled={isTesting}
                      aria-label={t("common.a11y.test")}
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onDelete(credential)}
                      aria-label={t("common.btn.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <code className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-[160px] truncate inline-block">
                    {credential.keyPrefix}****
                  </code>
                  <Badge
                    variant={credential.ownerName ? "secondary" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {credential.ownerName ?? t("supplier-connections.credentials.tag.platform")}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {credential.lastUsedAt
                      ? formatDistanceToNow(new Date(credential.lastUsedAt), { addSuffix: true })
                      : t("supplier-connections.credentials.never")}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const addCredentialToBucketSchema = z.object({
  name: z.string().min(1, "common.valid.name-required"),
  apiKey: z.string().min(1, "common.valid.required"),
  ownerId: z.number().int().positive().nullable().optional(),
});
type AddCredentialToBucketValues = z.infer<typeof addCredentialToBucketSchema>;

function AddCredentialToBucketDialog({
  open,
  onOpenChange,
  endpoint,
  bucket,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  endpoint: AiEndpoint;
  bucket: CredentialBucket | null;
}) {
  const { t } = useTranslation();
  const createCredential = useCreateAiEndpointCredential();
  const { data: keyProviders = [] } = useKeyProviders();
  const activeKeyProviders = useMemo(
    () => keyProviders.filter((keyProvider) => keyProvider.status === "active"),
    [keyProviders],
  );
  const isSigV4 = endpoint.authType === "sigv4";
  const isCloudflare = endpoint.authType === "cloudflare";

  const form = useForm<AddCredentialToBucketValues>({
    resolver: zodResolver(addCredentialToBucketSchema),
    defaultValues: { name: "", apiKey: "", ownerId: null },
  });

  useEffect(() => {
    if (open) form.reset({ name: "", apiKey: "", ownerId: null });
  }, [open, form]);

  const handleSubmit = form.handleSubmit(async (data) => {
    if (!bucket || !bucket.enabled) {
      toast.error(t("supplier-connections.credentials.toast.create-error"));
      return;
    }

    try {
      await createCredential.mutateAsync({
        endpointId: endpoint.id,
        supplierId: endpoint.supplierId,
        upstreamId: bucket.upstreamId ?? null,
        name: data.name,
        apiKey: data.apiKey,
        ownerId: data.ownerId,
      });
      toast.success(t("supplier-connections.credentials.toast.created"));
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("supplier-connections.credentials.toast.create-error"),
      );
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent preventClose>
        <DialogHeader>
          <DialogTitle>
            {t("supplier-connections.credentials.dialog.add-title", {
              upstream: bucket?.name ?? "",
            })}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit}>
            <DialogBody className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("supplier-connections.credentials.form.name")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("supplier-connections.credentials.form.name-ph")}
                        {...field}
                      />
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
                    <FormLabel>
                      {isCloudflare
                        ? t("supplier-connections.credentials.form.cloudflare-client-secret")
                        : isSigV4
                          ? t("supplier-connections.credentials.form.secret-access-key")
                          : t("supplier-connections.credentials.form.api-key")}
                    </FormLabel>
                    <FormControl>
                      <SecretInput
                        placeholder={
                          isCloudflare
                            ? t("supplier-connections.credentials.form.cloudflare-client-secret-ph")
                            : isSigV4
                              ? t("supplier-connections.credentials.form.secret-access-key-ph")
                              : t("supplier-connections.credentials.form.api-key-ph")
                        }
                        {...field}
                      />
                    </FormControl>
                    <p className="text-[11px] text-muted-foreground">
                      {isCloudflare
                        ? t("supplier-connections.credentials.form.cloudflare-client-secret-hint")
                        : isSigV4
                          ? t("supplier-connections.credentials.form.secret-access-key-hint")
                          : t("supplier-connections.credentials.form.api-key-hint")}
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
                      <FormLabel>{t("supplier-connections.credentials.form.owner")}</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "none"}
                        onValueChange={(v) => field.onChange(v === "none" ? null : Number(v))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={t("supplier-connections.credentials.form.owner-ph")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {t("supplier-connections.credentials.form.owner-none")}
                          </SelectItem>
                          {activeKeyProviders.map((keyProvider) => (
                            <SelectItem key={keyProvider.id} value={String(keyProvider.id)}>
                              {keyProvider.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        {t("supplier-connections.credentials.form.owner-hint")}
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
              <Button type="submit" disabled={createCredential.isPending || !bucket?.enabled}>
                {t("supplier-connections.credentials.add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
