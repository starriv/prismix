import { Badge } from "@/web/components/ui/badge";
import { cn } from "@/web/shared/utils";

const colorMap: Record<string, string> = {
  bank_transfer: "border-blue-500/30 bg-blue-500/10 text-blue-600",
  alipay: "border-sky-500/30 bg-sky-500/10 text-sky-600",
  wechat: "border-green-500/30 bg-green-500/10 text-green-600",
  paypal: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600",
};

interface MethodBadgeProps {
  method: string;
  label: string;
}

export function MethodBadge({ method, label }: MethodBadgeProps) {
  return (
    <Badge variant="outline" className={cn("text-xs", colorMap[method])}>
      {label}
    </Badge>
  );
}
