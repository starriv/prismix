import { useTranslation } from "react-i18next";

import { Brain, Sparkles } from "lucide-react";

import { useAiModels } from "@/web/api/hooks";
import type { AiProvider } from "@/web/api/schemas";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/web/components/ui/card";
import { Skeleton } from "@/web/components/ui/skeleton";
import { cn } from "@/web/shared/utils";

export function ProviderGrid({
  providers,
  loading,
  onSelect,
}: {
  providers: AiProvider[];
  loading: boolean;
  onSelect: (p: AiProvider) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6">
            <Skeleton className="h-5 w-32 mb-4" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </Card>
        ))}
      </div>
    );
  }

  if (providers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Brain className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("ai-models.no-providers")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {providers.map((provider) => (
        <ProviderCard key={provider.id} provider={provider} onClick={() => onSelect(provider)} />
      ))}
    </div>
  );
}

export function ProviderCard({ provider, onClick }: { provider: AiProvider; onClick: () => void }) {
  const { data: models = [] } = useAiModels(provider.id);
  const enabledCount = models.filter((m) => m.enabled).length;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md hover:border-primary/30",
        "flex flex-col justify-between",
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold truncate">{provider.name}</h3>
          {models.length > 0 && (
            <Badge variant="secondary" className="text-xs tabular-nums">
              {enabledCount}/{models.length}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{provider.baseUrl}</p>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-2">
            {provider.iconUrl ? (
              <img
                src={provider.iconUrl}
                alt={provider.name}
                className="h-8 w-8 rounded-md object-contain"
                width={32}
                height={32}
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
            )}
            <Badge variant="outline" className="text-xs">
              {provider.apiFormat}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
