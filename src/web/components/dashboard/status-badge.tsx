import { DataTableBadge } from "@/web/components/data-table";

export interface StatusBadgeConfig {
  className: string;
  label: string;
}

export type StatusBadgeColorMap = Record<string, StatusBadgeConfig>;

interface StatusBadgeProps {
  status: string;
  colorMap: StatusBadgeColorMap;
  fallbackLabel?: string;
}

export function StatusBadge({ status, colorMap, fallbackLabel }: StatusBadgeProps) {
  const config = colorMap[status] ?? {
    label: fallbackLabel ?? status,
    className: "",
  };

  return (
    <DataTableBadge variant="outline" className={config.className}>
      {config.label}
    </DataTableBadge>
  );
}
