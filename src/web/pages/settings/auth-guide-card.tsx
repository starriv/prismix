import { useTranslation } from "react-i18next";

import { ChevronDown, ShieldCheck } from "lucide-react";

import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

const AUTH_METHODS = [
  {
    method: "X-API-Key",
    header: "X-API-Key: skm_xxx",
    example: "curl -H 'X-API-Key: skm_xxx' ...",
  },
  {
    method: "Basic",
    header: "Authorization: Basic base64(clientId:secret)",
    example: "curl -u 'skm_id_xxx:skm_xxx' ...",
  },
  {
    method: "Bearer",
    header: "Authorization: Bearer skm_xxx",
    example: "curl -H 'Authorization: Bearer skm_xxx' ...",
  },
] as const;

export function AuthGuideCard() {
  const { t } = useTranslation();

  return (
    <Collapsible asChild>
      <Card className="group">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">
                  {t("settings.api-keys.auth-guide.title")}
                </CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {AUTH_METHODS.length}
                </Badge>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("settings.api-keys.auth-guide.desc")}
            </p>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("settings.api-keys.auth-guide.th.method")}</TableHead>
                    <TableHead>{t("settings.api-keys.auth-guide.th.header")}</TableHead>
                    <TableHead>{t("settings.api-keys.auth-guide.th.example")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {AUTH_METHODS.map((m) => (
                    <TableRow key={m.method}>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {m.method}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {m.header}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[300px] truncate">
                        {m.example}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.api-keys.auth-guide.priority")}
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
