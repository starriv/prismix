import { Copy } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";

interface EndpointUrlItem {
  label: string;
  value: string;
}

interface EndpointUrlListProps {
  items: EndpointUrlItem[];
  copyLabel: string;
  onCopy: (value: string) => void;
}

export function EndpointUrlList({ items, copyLabel, onCopy }: EndpointUrlListProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex max-w-full min-w-0 items-center gap-2 rounded-md bg-muted py-1.5 pl-2 pr-1.5"
        >
          <Badge variant="secondary" className="h-6 shrink-0 rounded-md px-2 font-mono text-[11px]">
            {item.label}
          </Badge>
          <code className="min-w-0 truncate font-mono text-xs select-all">{item.value}</code>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => onCopy(item.value)}
            aria-label={`${copyLabel} ${item.label}`}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
