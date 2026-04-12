import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useFiatConfigs, useUpdateFiatConfig } from "@/web/api/hooks";
import type { FiatConfig } from "@/web/api/schemas";
import { Header } from "@/web/components/dashboard/header";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { Switch } from "@/web/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

import { ConfigDialog } from "./config-dialog";
import { DeleteConfigDialog } from "./delete-config-dialog";
import { MethodBadge } from "./method-badge";

export default function FiatConfigsPage() {
  const { t } = useTranslation();
  const { data: configs = [], isLoading } = useFiatConfigs();
  const updateConfig = useUpdateFiatConfig();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<FiatConfig | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FiatConfig | null>(null);

  async function handleToggleEnabled(cfg: FiatConfig, checked: boolean) {
    try {
      await updateConfig.mutateAsync({ id: cfg.id, enabled: checked });
      toast.success(t("fiat.toast.updated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("fiat.toast.update-error"));
    }
  }

  return (
    <div>
      <Header title={t("fiat.title")} description={t("fiat.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("fiat.btn.add")}
          </Button>
        </div>

        <Card>
          <CardContent className="pt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <span className="animate-spin">
                  <Loader2 className="h-5 w-5 text-muted-foreground" />
                </span>
              </div>
            ) : configs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("fiat.table-empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("fiat.th.display-name")}</TableHead>
                    <TableHead>{t("fiat.th.method")}</TableHead>
                    <TableHead>{t("fiat.th.enabled")}</TableHead>
                    <TableHead>{t("fiat.th.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((cfg) => (
                    <TableRow key={cfg.id}>
                      <TableCell className="font-medium">{cfg.displayName}</TableCell>
                      <TableCell>
                        <MethodBadge method={cfg.method} label={t(`fiat.method.${cfg.method}`)} />
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={cfg.enabled}
                          onCheckedChange={(checked) => handleToggleEnabled(cfg, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditing(cfg)}
                            aria-label={t("common.btn.edit")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(cfg)}
                            aria-label={t("common.btn.delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfigDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      {editing && (
        <ConfigDialog open={!!editing} onClose={() => setEditing(null)} config={editing} />
      )}

      <DeleteConfigDialog config={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
