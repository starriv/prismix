import { formatDistanceToNow } from "date-fns";
import { Activity, Plus, RefreshCw, Trash2 } from "lucide-react";

import { useAiProviderUpstreams } from "@/web/api/hooks";
import type { AiKey, AiProvider } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";
import { Switch } from "@/web/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";
import { cn } from "@/web/shared/utils";

export function ProviderPoolCard({
  provider,
  providerName,
  keys: poolKeys,
  enabledCount,
  totalCount,
  nextKeyId,
  onToggle,
  onTest,
  onDelete,
  onWeightChange,
  onStrategyChange,
  onUpstreamChange,
  onAdd,
  isToggling,
  isTesting,
  t,
}: {
  provider?: AiProvider;
  providerName: string;
  keys: AiKey[];
  enabledCount: number;
  totalCount: number;
  nextKeyId: number | null;
  onToggle: (key: AiKey) => void;
  onTest: (key: AiKey) => void;
  onDelete: (key: AiKey) => void;
  onWeightChange: (key: AiKey, delta: number) => void;
  onStrategyChange: (provider: AiProvider, strategy: string) => void;
  onUpstreamChange: (key: AiKey, upstreamId: number | null) => void;
  onAdd: () => void;
  isToggling: boolean;
  isTesting: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const strategy = provider?.loadBalanceStrategy ?? "round-robin";
  const showPool = totalCount > 1;
  const { data: upstreams = [] } = useAiProviderUpstreams(provider?.id ?? 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm">{providerName}</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {t("ai.pool.count", { enabled: enabledCount, total: totalCount })}
            </Badge>
            {showPool && (
              <Select
                value={strategy}
                onValueChange={(v) => provider && onStrategyChange(provider, v)}
              >
                <SelectTrigger className="h-6 w-auto gap-1 border-dashed px-2 text-xs">
                  <RefreshCw className="h-3 w-3" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round-robin">{t("ai.pool.strategy.round-robin")}</SelectItem>
                  <SelectItem value="random">{t("ai.pool.strategy.random")}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("ai.pool.add")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {poolKeys.map((k) => {
            const isNext = k.id === nextKeyId;
            const weight = k.weight ?? 1;
            return (
              <div
                key={k.id}
                className={
                  "rounded-lg border px-3 py-2.5 " +
                  (isNext && k.enabled ? "border-primary/30 bg-primary/5" : "bg-muted/30")
                }
              >
                {/* Row 1: Name + controls */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "flex h-2 w-2 shrink-0 rounded-full",
                            !k.enabled
                              ? "bg-muted-foreground/40"
                              : isNext
                                ? "bg-green-500 shadow-[0_0_6px_1px] shadow-green-500/40"
                                : "bg-green-500",
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {!k.enabled
                          ? t("common.status.disabled")
                          : isNext
                            ? t("ai.pool.next")
                            : t("common.status.active")}
                      </TooltipContent>
                    </Tooltip>
                    <span className="text-sm font-medium truncate">{k.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {showPool && (
                      <div className="flex items-center gap-0.5 mr-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(k, -1)}
                          disabled={weight <= 0}
                          aria-label={t("ai.pool.weight-down")}
                        >
                          <span className="text-xs font-bold">−</span>
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-8 text-center text-xs font-mono tabular-nums">
                              {weight}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{t("ai.pool.weight-hint")}</TooltipContent>
                        </Tooltip>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onWeightChange(k, 1)}
                          disabled={weight >= 100}
                          aria-label={t("ai.pool.weight-up")}
                        >
                          <span className="text-xs font-bold">+</span>
                        </Button>
                      </div>
                    )}
                    <Switch
                      checked={k.enabled}
                      onCheckedChange={() => onToggle(k)}
                      disabled={isToggling}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onTest(k)}
                      disabled={isTesting}
                      aria-label={t("ai.test")}
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onDelete(k)}
                      aria-label={t("common.btn.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                {/* Row 2: Key prefix + owner + last used */}
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <code className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-[160px] truncate inline-block">
                    {k.keyPrefix}****
                  </code>
                  <Select
                    value={k.upstreamId ? String(k.upstreamId) : "legacy"}
                    onValueChange={(value) =>
                      onUpstreamChange(k, value === "legacy" ? null : Number(value))
                    }
                  >
                    <SelectTrigger className="h-7 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="legacy">{t("ai.form.upstream-legacy")}</SelectItem>
                      {upstreams.map((upstream) => (
                        <SelectItem key={upstream.id} value={String(upstream.id)}>
                          {upstream.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge
                    variant={k.ownerName ? "secondary" : "outline"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {k.ownerName ?? t("ai.tag.platform")}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {k.lastUsedAt
                      ? formatDistanceToNow(new Date(k.lastUsedAt), { addSuffix: true })
                      : t("ai.never")}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
