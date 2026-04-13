import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { BarChart3, Plus } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { useKeyProviders } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { LocaleLink } from "@/web/components/locale-link";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

import { KEY_PROVIDER_STATUS_COLORS } from "./constants";
import { CreateKeyProviderDialog } from "./create-dialog";
import { KeyProviderDetailSheet } from "./detail-sheet";

export default function KeyProvidersPage() {
  const { t } = useTranslation();
  const { data: providers = [] } = useKeyProviders();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const keyProviderStatusMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(KEY_PROVIDER_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`common.status.${key}`), className },
        ]),
      ),
    [t],
  );

  const editing = useMemo(
    () => (editingId ? (providers.find((p) => p.id === editingId) ?? null) : null),
    [editingId, providers],
  );

  return (
    <div>
      <Header title={t("admin.key-providers.title")} description={t("admin.key-providers.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("admin.key-providers.btn.create")}
          </Button>
        </div>

        <Card>
          <CardContent>
            {providers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("admin.key-providers.table-empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.th.name")}</TableHead>
                    <TableHead>{t("admin.key-providers.th.share")}</TableHead>
                    <TableHead>{t("admin.key-providers.th.balance")}</TableHead>
                    <TableHead>{t("admin.key-providers.th.keys")}</TableHead>
                    <TableHead>{t("common.th.status")}</TableHead>
                    <TableHead>{t("common.th.time")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => setEditingId(p.id)}
                    >
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.revenueSharePercent}%</TableCell>
                      <TableCell className="font-mono text-sm">
                        ${removeTailingZero(p.balance)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{p.keyCount ?? 0}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} colorMap={keyProviderStatusMap} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" asChild>
                          <LocaleLink to={`/admin/key-provider-usage-detail?id=${p.id}`}>
                            <BarChart3 className="h-3.5 w-3.5" />
                          </LocaleLink>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateKeyProviderDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Sheet open={!!editing} onOpenChange={() => setEditingId(null)}>
        <SheetContent className="w-full sm:w-[480px]">
          {editing && (
            <KeyProviderDetailSheet providerId={editing.id} onClose={() => setEditingId(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
