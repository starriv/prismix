import { memo } from "react";

interface DetailRowProps {
  label: string;
  children: React.ReactNode;
}

export const DetailRow = memo(function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between border-b pb-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
});
