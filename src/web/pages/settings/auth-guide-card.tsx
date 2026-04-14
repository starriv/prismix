import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronDown, ShieldCheck } from "lucide-react";

import { DataTable, DataTableBadge, DataTableText } from "@/web/components/data-table";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/web/components/ui/collapsible";

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
  const columns = useMemo<ColumnDef<(typeof AUTH_METHODS)[number]>[]>(
    () => [
      {
        accessorKey: "method",
        cell: ({ row }) => (
          <DataTableBadge variant="outline" className="font-mono">
            {row.original.method}
          </DataTableBadge>
        ),
        header: t("settings.api-keys.auth-guide.th.method"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "header",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.header}
          </DataTableText>
        ),
        header: t("settings.api-keys.auth-guide.th.header"),
        meta: { headerClassName: "w-[36%]" },
      },
      {
        accessorKey: "example",
        cell: ({ row }) => (
          <DataTableText className="max-w-[300px]" mono muted truncate>
            {row.original.example}
          </DataTableText>
        ),
        header: t("settings.api-keys.auth-guide.th.example"),
        meta: { headerClassName: "w-[46%]" },
      },
    ],
    [t],
  );

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
              <DataTable
                columns={columns}
                data={[...AUTH_METHODS]}
                emptyText=""
                getRowId={(row) => row.method}
                loading={false}
                showPagination={false}
                tableClassName="min-w-[760px]"
              />
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
