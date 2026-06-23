import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { ExternalLink, Plus, Search } from "lucide-react";

import { removeTailingZero } from "@/shared/number";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { usePayAgentsList } from "@/web/api/hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { DataTable, DataTableRelativeTime, DataTableText } from "@/web/components/data-table";
import { LocaleLink } from "@/web/components/locale-link";
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
import { Input } from "@/web/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/web/components/ui/sheet";

import { PayAgentDetailSheet } from "./agent-detail-sheet";
import { CreatePayAgentForm } from "./create-agent-form";
import { TOKEN_SYMBOL } from "./helpers";

const AGENT_STATUS_COLORS: Record<string, string> = {
  active: "border-green-500/30 bg-green-500/10 text-green-600",
  suspended: "border-yellow-500/30 bg-yellow-500/10 text-yellow-600",
};

export default function PayAgentsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Read ?id= from URL to pre-filter by agent id
  const idParam = searchParams.get("id");
  const idFromUrl = idParam
    ? Number.isFinite(Number(idParam))
      ? Number(idParam)
      : undefined
    : undefined;

  // Draft filter state (UI controls)
  const [draftUser, setDraftUser] = useState("");
  const [draftUserUuid, setDraftUserUuid] = useState("");
  const [draftAddress, setDraftAddress] = useState("");

  // Applied filter state (drives query)
  const [appliedUser, setAppliedUser] = useState("");
  const [appliedUserUuid, setAppliedUserUuid] = useState("");
  const [appliedAddress, setAppliedAddress] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const { data: agentsData, isLoading } = usePayAgentsList({
    id: idFromUrl,
    userName: appliedUser || undefined,
    userUuid: appliedUserUuid || undefined,
    address: appliedAddress || undefined,
    page: pagination.pageIndex,
  });
  const agents = useMemo(() => agentsData?.items ?? [], [agentsData?.items]);
  const agentPageCount = Math.ceil((agentsData?.total ?? 0) / DEFAULT_PAGE_SIZE);

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

  const hasFilters =
    !!idFromUrl ||
    draftUser !== "" ||
    draftUserUuid !== "" ||
    draftAddress !== "" ||
    appliedUser !== "" ||
    appliedUserUuid !== "" ||
    appliedAddress !== "";

  const applyFilters = useCallback(() => {
    // Clear the ?id= URL filter once user performs a manual search
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setAppliedUser(draftUser.trim());
    setAppliedUserUuid(draftUserUuid.trim());
    setAppliedAddress(draftAddress.trim());
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftUser, draftUserUuid, draftAddress, searchParams, setSearchParams]);

  const resetFilters = useCallback(() => {
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setDraftUser("");
    setDraftUserUuid("");
    setDraftAddress("");
    setAppliedUser("");
    setAppliedUserUuid("");
    setAppliedAddress("");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [searchParams, setSearchParams]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftUser(e.target.value),
    [],
  );
  const handleAddressChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftAddress(e.target.value),
    [],
  );
  const handleUserUuidChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftUserUuid(e.target.value),
    [],
  );

  const columns = useMemo<ColumnDef<(typeof agents)[number]>[]>(
    () => [
      {
        accessorKey: "id",
        cell: ({ row }) => <DataTableText muted>{row.original.id}</DataTableText>,
        header: t("admin.users.th.id"),
        meta: { headerClassName: "w-[8%] text-xs" },
      },
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("agents.th.name"),
        meta: { headerClassName: "w-[16%]" },
      },
      {
        id: "user",
        cell: ({ row }) =>
          row.original.userId ? (
            <LocaleLink
              to={`/admin/users?id=${row.original.userId}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.original.userName || `#${row.original.userId}`}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </LocaleLink>
          ) : (
            <DataTableText muted>—</DataTableText>
          ),
        header: t("agents.th.user"),
        meta: { headerClassName: "w-[22%]" },
      },
      {
        accessorKey: "address",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.address
              ? `${row.original.address.slice(0, 6)}...${row.original.address.slice(-4)}`
              : "—"}
          </DataTableText>
        ),
        header: t("agents.th.address"),
        meta: { headerClassName: "w-[18%]" },
      },
      {
        accessorKey: "balance",
        cell: ({ row }) => (
          <DataTableText mono>
            {removeTailingZero(row.original.balance)} {TOKEN_SYMBOL}
          </DataTableText>
        ),
        header: t("agents.th.balance"),
        meta: { headerClassName: "w-[12%]" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => <StatusBadge status={row.original.status} colorMap={agentStatusMap} />,
        header: t("agents.th.status"),
        meta: { headerClassName: "w-[10%]" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} muted />
        ),
        header: t("agents.th.created"),
        meta: { headerClassName: "w-[14%]" },
      },
    ],
    [agentStatusMap, i18n.language, t],
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
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("agents.card-title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              <Input
                placeholder={t("agents.filter-user-ph")}
                value={draftUser}
                onChange={handleUserChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[180px]"
              />
              <Input
                placeholder={t("agents.filter-uuid-ph")}
                value={draftUserUuid}
                onChange={handleUserUuidChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[240px]"
              />
              <Input
                placeholder={t("agents.filter-address-ph")}
                value={draftAddress}
                onChange={handleAddressChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[200px]"
              />

              <div className="flex gap-2">
                <Button size="sm" onClick={applyFilters}>
                  <Search className="mr-1 h-3.5 w-3.5" />
                  {t("common.btn.search")}
                </Button>
                {hasFilters && (
                  <Button size="sm" variant="outline" onClick={resetFilters}>
                    {t("common.btn.reset")}
                  </Button>
                )}
              </div>
            </div>

            <DataTable
              columns={columns}
              data={agents}
              emptyText={t("agents.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              manualPagination
              onPaginationChange={setPagination}
              onRowClick={(row) => setEditingId(row.id)}
              pageCount={agentPageCount}
              pagination={pagination}
              tableClassName="min-w-[980px]"
            />
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
