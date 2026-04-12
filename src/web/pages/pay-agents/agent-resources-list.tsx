import { useTranslation } from "react-i18next";

import { Globe } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { usePayAgentResources } from "@/web/api/hooks";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";

export function PayAgentResourcesList({ agentId }: { agentId: number }) {
  const { t } = useTranslation();
  const { data: resources = [] } = usePayAgentResources(agentId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{t("agents.detail.allowed-resources")}</CardTitle>
          {resources.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {resources.length}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {resources.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t("agents.detail.no-resources")}
          </p>
        ) : (
          <div className="grid gap-2">
            {resources.map((res) => (
              <div
                key={res.id}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 shrink-0">
                  <Globe className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{res.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">
                    {res.path.split("/").pop()}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 font-mono text-xs">
                  ${removeTailingZero(res.price)}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
