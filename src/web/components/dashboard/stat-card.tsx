import { memo } from "react";
import { useTranslation } from "react-i18next";

import { type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/shared/utils";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  loading?: boolean;
  error?: boolean;
}

export const StatCard = memo(function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  loading = false,
  error = false,
}: StatCardProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <div
            className={cn("text-2xl font-bold tabular-nums", error && "text-muted-foreground")}
            title={error ? t("dash.ai.data-unavailable") : undefined}
          >
            {value}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          {trend && (
            <span
              className={cn(
                "text-xs font-medium",
                trend.positive ? "text-green-600" : "text-red-600",
              )}
            >
              {trend.positive ? "+" : ""}
              {trend.value}
            </span>
          )}
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
        </div>
      </CardContent>
    </Card>
  );
});
