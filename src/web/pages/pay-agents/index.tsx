import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Plus } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { usePayAgents } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";

import { PayAgentDetailSheet } from "./agent-detail-sheet";
import { CreatePayAgentForm } from "./create-agent-form";
import { TOKEN_SYMBOL } from "./helpers";

const AGENT_STATUS_COLORS: Record<string, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-600",
  suspended: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
};

export default function PayAgentsPage() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: agents = [] } = usePayAgents();

  const agentStatusMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(AGENT_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(`agents.status.${key}`), className },
        ]),
      ),
    [t],
  );

  // Derive the editing agent from the latest query data (avoids stale snapshot)
  const editing = useMemo(
    () => (editingId ? (agents.find((a) => a.id === editingId) ?? null) : null),
    [editingId, agents],
  );

  return (
    <div>
      <Header title={t("agents.title")} description={t("agents.desc")} />

      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex justify-end">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                {t("agents.btn.create")}
              </Button>
            </DialogTrigger>
            <DialogContent preventClose>
              <DialogHeader>
                <DialogTitle>{t("agents.dialog-title")}</DialogTitle>
              </DialogHeader>
              <DialogBody>
                <CreatePayAgentForm
                  onSuccess={() => {
                    setCreateOpen(false);
                  }}
                />
              </DialogBody>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("agents.card-title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">{t("agents.empty")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t("admin.users.th.id")}</TableHead>
                    <TableHead>{t("agents.th.name")}</TableHead>
                    <TableHead>{t("agents.th.user")}</TableHead>
                    <TableHead>{t("agents.th.address")}</TableHead>
                    <TableHead>{t("agents.th.balance")}</TableHead>
                    <TableHead>{t("agents.th.status")}</TableHead>
                    <TableHead>{t("agents.th.created")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((agent) => (
                    <TableRow
                      key={agent.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setEditingId(agent.id)}
                    >
                      <TableCell className="text-xs">{agent.id}</TableCell>
                      <TableCell className="font-medium">{agent.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {agent.userId ? `#${agent.userId} ${agent.userName ?? ""}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {agent.address
                          ? `${agent.address.slice(0, 6)}...${agent.address.slice(-4)}`
                          : "\u2014"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {removeTailingZero(agent.balance)} {TOKEN_SYMBOL}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={agent.status} colorMap={agentStatusMap} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(agent.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail / Edit Sheet */}
      <Sheet open={!!editing} onOpenChange={() => setEditingId(null)}>
        <SheetContent className="w-full sm:w-[480px]">
          <SheetHeader>
            <SheetTitle>{t("agents.edit-title")}</SheetTitle>
          </SheetHeader>
          {editing && <PayAgentDetailSheet agent={editing} onClose={() => setEditingId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
