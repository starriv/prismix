import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { Activity, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  useAdminGatewayConfig,
  useAdminGatewayStatus,
  useUpdateAdminGatewayConfig,
} from "@/web/api/ai-hooks";
import type {
  CircuitBreakerConfig,
  GatewayConfig,
  GatewayStatus,
  QueueConfig,
  RateLimitRule,
  TimeoutConfig,
} from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/web/components/ui/tabs";

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
}

export default function AdminGatewayPage() {
  const { t } = useTranslation();
  const { data: savedConfig } = useAdminGatewayConfig();
  const { data: status } = useAdminGatewayStatus();
  const updateConfig = useUpdateAdminGatewayConfig();

  const [draft, setDraft] = useState<GatewayConfig | null>(null);
  const form = draft ?? savedConfig ?? null;
  const isDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(savedConfig);

  const handleSave = async () => {
    if (!form) return;
    try {
      await updateConfig.mutateAsync(form);
      setDraft(null);
      toast.success(t("admin.gateway.toast.saved"));
    } catch {
      toast.error(t("admin.gateway.toast.save-error"));
    }
  };

  const updateRateLimit = useCallback(
    (index: number, patch: Partial<RateLimitRule>) => {
      setDraft((prev) => {
        const current = prev ?? savedConfig;
        if (!current) return prev;
        const rules = [...current.rateLimits];
        rules[index] = { ...rules[index], ...patch };
        return { ...current, rateLimits: rules };
      });
    },
    [savedConfig],
  );

  const removeRateLimit = useCallback(
    (index: number) => {
      setDraft((prev) => {
        const current = prev ?? savedConfig;
        if (!current) return prev;
        const rules = current.rateLimits.filter((_, i) => i !== index);
        return { ...current, rateLimits: rules };
      });
    },
    [savedConfig],
  );

  const addRateLimit = useCallback(() => {
    setDraft((prev) => {
      const current = prev ?? savedConfig;
      if (!current) return prev;
      const rule: RateLimitRule = {
        name: "New Rule",
        pathPattern: "*",
        maxRequests: 100,
        windowMs: 60_000,
        dimension: "ip",
        enabled: true,
      };
      return { ...current, rateLimits: [...current.rateLimits, rule] };
    });
  }, [savedConfig]);

  const updateCircuitBreaker = useCallback(
    (index: number, patch: Partial<CircuitBreakerConfig>) => {
      setDraft((prev) => {
        const current = prev ?? savedConfig;
        if (!current) return prev;
        const cbs = [...current.circuitBreakers];
        cbs[index] = { ...cbs[index], ...patch };
        return { ...current, circuitBreakers: cbs };
      });
    },
    [savedConfig],
  );

  const updateTimeouts = useCallback(
    (patch: Partial<TimeoutConfig>) => {
      setDraft((prev) => {
        const current = prev ?? savedConfig;
        if (!current) return prev;
        return { ...current, timeouts: { ...current.timeouts, ...patch } };
      });
    },
    [savedConfig],
  );

  const updateQueue = useCallback(
    (patch: Partial<QueueConfig>) => {
      setDraft((prev) => {
        const current = prev ?? savedConfig;
        if (!current) return prev;
        return { ...current, queue: { ...current.queue, ...patch } };
      });
    },
    [savedConfig],
  );

  if (!form) {
    return (
      <div>
        <Header title={t("admin.gateway.title")} description={t("admin.gateway.desc")} />
        <div className="p-4 md:p-8">
          <p className="text-sm text-muted-foreground">{t("auth.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title={t("admin.gateway.title")} description={t("admin.gateway.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        {/* ── Realtime Status (always visible) ─────────────── */}
        <StatusBar status={status ?? null} t={t} />

        {/* ── Tabbed Config ────────────────────────────────── */}
        <Tabs defaultValue="rate-limit">
          <TabsList className="w-full">
            <TabsTrigger value="rate-limit">{t("admin.gateway.tab.rate-limit")}</TabsTrigger>
            <TabsTrigger value="circuit-breaker">
              {t("admin.gateway.tab.circuit-breaker")}
            </TabsTrigger>
            <TabsTrigger value="timeout">{t("admin.gateway.tab.timeout")}</TabsTrigger>
            <TabsTrigger value="queue">{t("admin.gateway.tab.queue")}</TabsTrigger>
          </TabsList>

          {/* ── Rate Limiting ───────────────────────────────── */}
          <TabsContent value="rate-limit">
            <RateLimitTab
              rules={form.rateLimits}
              onUpdate={updateRateLimit}
              onRemove={removeRateLimit}
              onAdd={addRateLimit}
              t={t}
            />
          </TabsContent>

          {/* ── Circuit Breakers ─────────────────────────────── */}
          <TabsContent value="circuit-breaker">
            <CircuitBreakerTab
              breakers={form.circuitBreakers}
              onUpdate={updateCircuitBreaker}
              t={t}
            />
          </TabsContent>

          {/* ── Timeouts ────────────────────────────────────── */}
          <TabsContent value="timeout">
            <TimeoutTab timeouts={form.timeouts} onUpdate={updateTimeouts} t={t} />
          </TabsContent>

          {/* ── Write Queue ──────────────────────────────────── */}
          <TabsContent value="queue">
            <QueueTab queue={form.queue} status={status ?? null} onUpdate={updateQueue} t={t} />
          </TabsContent>
        </Tabs>

        {/* ── Save Button (always visible) ─────────────────── */}
        <Button disabled={!isDirty || updateConfig.isPending} onClick={handleSave}>
          {t("settings.config.save-btn")}
        </Button>
      </div>
    </div>
  );
}

// ── Rate Limit Tab ───────────────────────────────────────────────────

function RateLimitTab({
  rules,
  onUpdate,
  onRemove,
  onAdd,
  t,
}: {
  rules: RateLimitRule[];
  onUpdate: (i: number, patch: Partial<RateLimitRule>) => void;
  onRemove: (i: number) => void;
  onAdd: () => void;
  t: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t("admin.gateway.rate-limit.title")}</CardTitle>
            <CardDescription>{t("admin.gateway.rate-limit.desc")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onAdd}>
            {t("admin.gateway.rate-limit.btn-add")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {rules.map((rule, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(v) => onUpdate(i, { enabled: v })}
                />
                <Input
                  value={rule.name}
                  onChange={(e) => onUpdate(i, { name: e.target.value })}
                  className="w-48 h-8 text-sm"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => onRemove(i)}
              >
                {t("admin.gateway.rate-limit.btn-remove")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.rate-limit.path")}</Label>
                <Input
                  value={rule.pathPattern}
                  onChange={(e) => onUpdate(i, { pathPattern: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.rate-limit.max-req")}</Label>
                <Input
                  type="number"
                  value={rule.maxRequests}
                  onChange={(e) => onUpdate(i, { maxRequests: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.rate-limit.window")}</Label>
                <Input
                  type="number"
                  value={rule.windowMs}
                  onChange={(e) => onUpdate(i, { windowMs: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.rate-limit.dimension")}</Label>
                <Select
                  value={rule.dimension}
                  onValueChange={(v) => onUpdate(i, { dimension: v as "ip" | "token" | "global" })}
                >
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ip">IP</SelectItem>
                    <SelectItem value="token">Token</SelectItem>
                    <SelectItem value="global">Global</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Circuit Breaker Tab ──────────────────────────────────────────────

function CircuitBreakerTab({
  breakers,
  onUpdate,
  t,
}: {
  breakers: CircuitBreakerConfig[];
  onUpdate: (i: number, patch: Partial<CircuitBreakerConfig>) => void;
  t: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.gateway.circuit-breaker.title")}</CardTitle>
        <CardDescription>{t("admin.gateway.circuit-breaker.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {breakers.map((cb, i) => (
          <div key={cb.name} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Switch checked={cb.enabled} onCheckedChange={(v) => onUpdate(i, { enabled: v })} />
              <span className="text-sm font-medium">{cb.name}</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.circuit-breaker.threshold")}</Label>
                <Input
                  type="number"
                  value={cb.failureThreshold}
                  onChange={(e) => onUpdate(i, { failureThreshold: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  {t("admin.gateway.circuit-breaker.reset-timeout")}
                </Label>
                <Input
                  type="number"
                  value={cb.resetTimeoutMs}
                  onChange={(e) => onUpdate(i, { resetTimeoutMs: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("admin.gateway.circuit-breaker.half-open")}</Label>
                <Input
                  type="number"
                  value={cb.halfOpenRequests}
                  onChange={(e) => onUpdate(i, { halfOpenRequests: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Timeout Tab ──────────────────────────────────────────────────────

function TimeoutTab({
  timeouts,
  onUpdate,
  t,
}: {
  timeouts: TimeoutConfig;
  onUpdate: (patch: Partial<TimeoutConfig>) => void;
  t: (key: string) => string;
}) {
  const updateOverride = (
    index: number,
    patch: Partial<TimeoutConfig["upstreamFetchOverrides"][number]>,
  ) => {
    const overrides = [...timeouts.upstreamFetchOverrides];
    overrides[index] = { ...overrides[index], ...patch };
    onUpdate({ upstreamFetchOverrides: overrides });
  };

  const addOverride = () => {
    onUpdate({
      upstreamFetchOverrides: [
        ...timeouts.upstreamFetchOverrides,
        { endpointId: "deepseek", modelId: "", upstreamFetchMs: 600_000 },
      ],
    });
  };

  const removeOverride = (index: number) => {
    onUpdate({
      upstreamFetchOverrides: timeouts.upstreamFetchOverrides.filter((_, i) => i !== index),
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{t("admin.gateway.timeout.title")}</CardTitle>
            <CardDescription>{t("admin.gateway.timeout.desc")}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={addOverride}>
            <Plus className="h-4 w-4" />
            {t("admin.gateway.timeout.btn-add-override")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="max-w-sm space-y-2">
          <Label>{t("admin.gateway.timeout.upstream")}</Label>
          <Input
            type="number"
            min={1}
            step={1}
            value={timeouts.upstreamFetchMs}
            onChange={(e) => onUpdate({ upstreamFetchMs: parsePositiveInt(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">{t("admin.gateway.timeout.ms-hint")}</p>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">{t("admin.gateway.timeout.overrides")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("admin.gateway.timeout.overrides-desc")}
            </p>
          </div>
          <div className="space-y-3">
            {timeouts.upstreamFetchOverrides.map((override, i) => (
              <div
                key={i}
                className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_160px_auto]"
              >
                <div className="space-y-2">
                  <Label>{t("admin.gateway.timeout.provider-id")}</Label>
                  <Input
                    value={override.endpointId ?? ""}
                    onChange={(e) => updateOverride(i, { endpointId: e.target.value })}
                    placeholder="deepseek"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.gateway.timeout.model-id")}</Label>
                  <Input
                    value={override.modelId ?? ""}
                    onChange={(e) => updateOverride(i, { modelId: e.target.value })}
                    placeholder="deepseek-v4-pro"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("admin.gateway.timeout.override-ms")}</Label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={override.upstreamFetchMs}
                    onChange={(e) =>
                      updateOverride(i, { upstreamFetchMs: parsePositiveInt(e.target.value) })
                    }
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeOverride(i)}
                    aria-label={t("admin.gateway.timeout.remove-override")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Queue Tab ────────────────────────────────────────────────────────

function QueueTab({
  queue,
  status,
  onUpdate,
  t,
}: {
  queue: QueueConfig;
  status: GatewayStatus | null;
  onUpdate: (patch: Partial<QueueConfig>) => void;
  t: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.gateway.queue.title")}</CardTitle>
        <CardDescription>{t("admin.gateway.queue.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("admin.gateway.queue.max-write")}</Label>
            <Input
              type="number"
              value={queue.maxWriteQueueDepth}
              onChange={(e) => onUpdate({ maxWriteQueueDepth: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("admin.gateway.queue.max-log")}</Label>
            <Input
              type="number"
              value={queue.maxLogQueueDepth}
              onChange={(e) => onUpdate({ maxLogQueueDepth: Number(e.target.value) })}
            />
          </div>
        </div>
        {status && (
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <span>
              {t("admin.gateway.status.queue-depth")}: {status.queues.depth}
            </span>
            <span>
              {t("admin.gateway.status.queue-dropped")}: {status.queues.dropped}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Status Bar ───────────────────────────────────────────────────────

function StatusBar({ status, t }: { status: GatewayStatus | null; t: (key: string) => string }) {
  if (!status) return null;

  const totalHits = status.rateLimits.reduce((s, r) => s + r.hits, 0);
  const totalRejected = status.rateLimits.reduce((s, r) => s + r.rejected, 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("admin.gateway.status.rate-limits")}</span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>
              {t("admin.gateway.status.total-hits")}: {totalHits}
            </span>
            <span>
              {t("admin.gateway.status.total-rejected")}: {totalRejected}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("admin.gateway.status.write-queue")}</span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>
              {t("admin.gateway.status.queue-depth")}: {status.queues.depth}
            </span>
            <span>
              {t("admin.gateway.status.queue-dropped")}: {status.queues.dropped}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
