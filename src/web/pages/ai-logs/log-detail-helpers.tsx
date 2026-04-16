import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import { useTranslation } from "react-i18next";

import { Check, ChevronRight, ClipboardCopy } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import { ScrollArea } from "@/web/components/ui/scroll-area";
import { useCopy } from "@/web/hooks/use-copy";
import { cn } from "@/web/shared/utils";

// ── Detail Card ─────────────────────────────────────────────────────

export function DetailCard({
  title,
  icon: Icon,
  variant,
  copyText,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  variant?: "destructive";
  copyText?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { copy, copied } = useCopy();

  return (
    <Collapsible defaultOpen={defaultOpen} asChild>
      <Card>
        <div className="flex w-full items-center justify-between px-3 py-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 text-xs font-semibold text-left",
                variant === "destructive" && "text-destructive",
              )}
            >
              <ChevronRight className="h-3.5 w-3.5 transition-transform data-[state=open]:rotate-90" />
              <Icon className="h-3.5 w-3.5" />
              {title}
            </button>
          </CollapsibleTrigger>
          {copyText && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => copy(copyText)}
              aria-label={t("common.a11y.copy")}
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <ClipboardCopy className="h-3 w-3 text-muted-foreground" />
              )}
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <CardContent className="px-3 pb-3 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// ── JSON Block ──────────────────────────────────────────────────────

export function JsonBlock({ data, raw }: { data: unknown; raw?: string }) {
  if (data !== null && typeof data === "object") {
    return (
      <ScrollArea className="max-h-56">
        <div className="rounded-md bg-muted p-2 text-xs [&_.json-view]:!bg-transparent">
          <JsonView
            src={data}
            collapsed={2}
            theme="default"
            collapseStringsAfterLength={80}
            enableClipboard={false}
          />
        </div>
      </ScrollArea>
    );
  }
  return (
    <ScrollArea className="max-h-56">
      <pre className="rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">
        {raw ?? String(data)}
      </pre>
    </ScrollArea>
  );
}

// ── Raw JSON helpers ────────────────────────────────────────────────

export function formatRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
