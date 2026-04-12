import { match, P } from "ts-pattern";

import { removeTailingZero } from "@/shared/number";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/web/components/ui/tooltip";

// ── Helpers ──────────────────────────────────────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${removeTailingZero(n / 1_000_000, 2)}M`;
  if (n >= 1_000) return `${removeTailingZero(n / 1_000, 1)}K`;
  return String(n);
}

export function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ code, error }: { code: number | null; error: string | null }) {
  return match({ code, error })
    .with({ code: P.union(null, 0) }, () => <Badge variant="outline">-</Badge>)
    .with({ code: P.when((c) => c !== null && c >= 200 && c < 300) }, ({ code: c }) => (
      <Badge variant="default">{c}</Badge>
    ))
    .with({ error: P.string.minLength(1) }, ({ code: c, error: err }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive">{c}</Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs break-all">{err}</TooltipContent>
      </Tooltip>
    ))
    .otherwise(({ code: c }) => <Badge variant="destructive">{c}</Badge>);
}
