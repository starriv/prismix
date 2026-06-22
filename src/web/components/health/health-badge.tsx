import { AlertTriangle, CheckCircle2, PauseCircle, ShieldAlert } from "lucide-react";
import { match } from "ts-pattern";

import type { HealthStatus } from "@/web/api/health-status";
import { DataTableBadge } from "@/web/components/data-table";
import { cn } from "@/web/shared/utils";

interface HealthBadgeProps {
  status: HealthStatus;
  label: string;
  className?: string;
}

/**
 * Unified health status badge for providers and upstreams.
 * Displays an icon + label with severity-colored variant.
 *
 * Use `healthDotColor()` for compact dot-only displays.
 */
export function HealthBadge({ status, label, className }: HealthBadgeProps) {
  const config = match(status)
    .with("healthy", () => ({ variant: "default" as const, Icon: CheckCircle2 }))
    .with("degraded", () => ({ variant: "destructive" as const, Icon: ShieldAlert }))
    .with("down", () => ({ variant: "destructive" as const, Icon: AlertTriangle }))
    .with("unknown", () => ({ variant: "outline" as const, Icon: PauseCircle }))
    .with("idle", () => ({ variant: "secondary" as const, Icon: PauseCircle }))
    .with("no-key", () => ({ variant: "outline" as const, Icon: AlertTriangle }))
    .with("disabled", () => ({ variant: "outline" as const, Icon: PauseCircle }))
    .exhaustive();

  return (
    <DataTableBadge variant={config.variant} className={cn("gap-1", className)}>
      <config.Icon className="h-3 w-3" />
      {label}
    </DataTableBadge>
  );
}

/**
 * Tailwind color class for a compact health status dot.
 * Use for inline indicators where a full badge is too heavy.
 */
export function healthDotColor(status: HealthStatus): string {
  return match(status)
    .with("healthy", () => "bg-green-500")
    .with("degraded", () => "bg-red-500")
    .with("down", () => "bg-red-600")
    .with("unknown", () => "bg-muted-foreground/50")
    .with("idle", () => "bg-yellow-500")
    .with("no-key", () => "bg-orange-500")
    .with("disabled", () => "bg-muted-foreground/40")
    .exhaustive();
}
