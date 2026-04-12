import { Badge } from "@/web/components/ui/badge";
import { cn } from "@/web/shared/utils";

interface StatusBadgeProps {
  status: string;
  colorMap: Record<string, { label: string; className: string }>;
  fallbackLabel?: string;
}

export function StatusBadge({ status, colorMap, fallbackLabel }: StatusBadgeProps) {
  const config = colorMap[status] ?? {
    label: fallbackLabel ?? status,
    className: "",
  };

  return (
    <Badge variant="outline" className={cn("text-xs", config.className)}>
      {config.label}
    </Badge>
  );
}
