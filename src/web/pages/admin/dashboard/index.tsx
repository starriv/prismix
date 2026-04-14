import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Search } from "lucide-react";

import { useAdminUsers } from "@/web/api/admin-hooks";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import {
  DataTable,
  DataTableRelativeTime,
  DataTableText,
  getHeuristicPageCount,
} from "@/web/components/data-table";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";

import { USER_STATUS_COLORS, USER_STATUS_KEYS } from "./constants";
import { UserDetailSheet } from "./user-detail-sheet";

export default function AdminDashboardPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read ?id= from URL to pre-filter by user id
  const idParam = searchParams.get("id");
  const idFromUrl = idParam
    ? Number.isFinite(Number(idParam)) && Number(idParam) > 0
      ? Number(idParam)
      : undefined
    : undefined;

  // Draft filter state (UI controls)
  const [draftUuid, setDraftUuid] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftAddress, setDraftAddress] = useState("");

  // Applied filter state (drives query)
  const [appliedUuid, setAppliedUuid] = useState("");
  const [appliedName, setAppliedName] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [appliedAddress, setAppliedAddress] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const { data: users = [], isLoading } = useAdminUsers({
    id: idFromUrl,
    uuid: appliedUuid || undefined,
    name: appliedName || undefined,
    email: appliedEmail || undefined,
    address: appliedAddress || undefined,
    page: pagination.pageIndex,
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const userStatusColorMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(USER_STATUS_COLORS).map(([key, className]) => [
          key,
          { label: t(USER_STATUS_KEYS[key] ?? key), className },
        ]),
      ),
    [t],
  );

  const selected = useMemo(
    () => (selectedId ? (users.find((u) => u.id === selectedId) ?? null) : null),
    [selectedId, users],
  );

  const handleClose = useCallback(() => setSelectedId(null), []);

  const hasFilters =
    !!idFromUrl ||
    draftUuid !== "" ||
    draftName !== "" ||
    draftEmail !== "" ||
    draftAddress !== "" ||
    appliedUuid !== "" ||
    appliedName !== "" ||
    appliedEmail !== "" ||
    appliedAddress !== "";

  const applyFilters = useCallback(() => {
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setAppliedUuid(draftUuid.trim());
    setAppliedName(draftName.trim());
    setAppliedEmail(draftEmail.trim());
    setAppliedAddress(draftAddress.trim());
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [draftUuid, draftName, draftEmail, draftAddress, searchParams, setSearchParams]);

  const resetFilters = useCallback(() => {
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setDraftUuid("");
    setDraftName("");
    setDraftEmail("");
    setDraftAddress("");
    setAppliedUuid("");
    setAppliedName("");
    setAppliedEmail("");
    setAppliedAddress("");
    setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  }, [searchParams, setSearchParams]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
  );

  const handleUuidChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftUuid(e.target.value),
    [],
  );
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftName(e.target.value),
    [],
  );
  const handleEmailChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftEmail(e.target.value),
    [],
  );
  const handleAddressChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setDraftAddress(e.target.value),
    [],
  );

  const columns = useMemo<ColumnDef<(typeof users)[number]>[]>(
    () => [
      {
        accessorKey: "id",
        cell: ({ row }) => <DataTableText muted>{row.original.id}</DataTableText>,
        header: t("admin.users.th.id"),
        meta: { headerClassName: "w-[8%] text-xs" },
      },
      {
        accessorKey: "uuid",
        cell: ({ row }) => <DataTableText mono>{row.original.uuid ?? "---"}</DataTableText>,
        header: t("admin.users.th.uuid"),
        meta: { headerClassName: "w-[22%] text-xs" },
      },
      {
        accessorKey: "name",
        cell: ({ row }) => (
          <DataTableText className="font-medium">{row.original.name}</DataTableText>
        ),
        header: t("admin.users.th.name"),
        meta: { headerClassName: "w-[16%] text-xs" },
      },
      {
        accessorKey: "email",
        cell: ({ row }) => <DataTableText>{row.original.email ?? "---"}</DataTableText>,
        header: t("admin.users.th.email"),
        meta: { headerClassName: "w-[20%] text-xs" },
      },
      {
        accessorKey: "address",
        cell: ({ row }) => (
          <DataTableText mono muted>
            {row.original.address
              ? `${row.original.address.slice(0, 6)}...${row.original.address.slice(-4)}`
              : "---"}
          </DataTableText>
        ),
        header: t("admin.users.th.address"),
        meta: { headerClassName: "w-[14%] text-xs" },
      },
      {
        accessorKey: "status",
        cell: ({ row }) => (
          <StatusBadge status={String(row.original.status)} colorMap={userStatusColorMap} />
        ),
        header: t("admin.users.th.status"),
        meta: { headerClassName: "w-[10%] text-xs" },
      },
      {
        accessorKey: "createdAt",
        cell: ({ row }) =>
          row.original.createdAt ? (
            <DataTableRelativeTime language={i18n.language} value={row.original.createdAt} />
          ) : (
            <DataTableText muted>---</DataTableText>
          ),
        header: t("common.th.time"),
        meta: { headerClassName: "w-[10%] text-xs" },
      },
    ],
    [i18n.language, t, userStatusColorMap],
  );

  return (
    <div>
      <Header title={t("admin.users.title")} description={t("admin.users.desc")} />

      <div className="p-4 md:p-8">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t("admin.users.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              <Input
                placeholder={t("admin.users.filter-uuid-ph")}
                value={draftUuid}
                onChange={handleUuidChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[240px]"
              />
              <Input
                placeholder={t("admin.users.filter-name-ph")}
                value={draftName}
                onChange={handleNameChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[180px]"
              />
              <Input
                placeholder={t("admin.users.filter-email-ph")}
                value={draftEmail}
                onChange={handleEmailChange}
                onKeyDown={handleKeyDown}
                className="w-full sm:w-[200px]"
              />
              <Input
                placeholder={t("admin.users.filter-address-ph")}
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
              data={users}
              emptyText={t("admin.users.empty")}
              getRowId={(row) => String(row.id)}
              loading={isLoading}
              manualPagination
              onPaginationChange={setPagination}
              onRowClick={(row) => setSelectedId(row.id)}
              pageCount={getHeuristicPageCount(
                pagination.pageIndex,
                users.length,
                DEFAULT_PAGE_SIZE,
              )}
              pagination={pagination}
              tableClassName="min-w-[980px]"
            />
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={handleClose}>
        <SheetContent className="w-full sm:w-[480px]">
          {selected && <UserDetailSheet user={selected} onClose={handleClose} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
