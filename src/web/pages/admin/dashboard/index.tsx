import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { formatDistanceToNow } from "date-fns";
import { Search } from "lucide-react";

import { useAdminUsers } from "@/web/api/admin-hooks";
import { DEFAULT_PAGE_SIZE } from "@/web/api/constants";
import { Header } from "@/web/components/dashboard/header";
import { Pagination } from "@/web/components/dashboard/pagination";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/web/components/ui/card";
import { Input } from "@/web/components/ui/input";
import { Sheet, SheetContent } from "@/web/components/ui/sheet";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { getDateLocale } from "@/web/shared/date-locale";

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
  const [draftName, setDraftName] = useState("");
  const [draftEmail, setDraftEmail] = useState("");
  const [draftAddress, setDraftAddress] = useState("");

  // Applied filter state (drives query)
  const [appliedName, setAppliedName] = useState("");
  const [appliedEmail, setAppliedEmail] = useState("");
  const [appliedAddress, setAppliedAddress] = useState("");
  const [page, setPage] = useState(0);

  const { data: users = [], isLoading } = useAdminUsers({
    id: idFromUrl,
    name: appliedName || undefined,
    email: appliedEmail || undefined,
    address: appliedAddress || undefined,
    page,
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
    draftName !== "" ||
    draftEmail !== "" ||
    draftAddress !== "" ||
    appliedName !== "" ||
    appliedEmail !== "" ||
    appliedAddress !== "";

  const applyFilters = useCallback(() => {
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setAppliedName(draftName.trim());
    setAppliedEmail(draftEmail.trim());
    setAppliedAddress(draftAddress.trim());
    setPage(0);
  }, [draftName, draftEmail, draftAddress, searchParams, setSearchParams]);

  const resetFilters = useCallback(() => {
    if (searchParams.has("id")) setSearchParams({}, { replace: true });
    setDraftName("");
    setDraftEmail("");
    setDraftAddress("");
    setAppliedName("");
    setAppliedEmail("");
    setAppliedAddress("");
    setPage(0);
  }, [searchParams, setSearchParams]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") applyFilters();
    },
    [applyFilters],
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

            {/* Table */}
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {t("admin.users.empty")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t("admin.users.th.id")}</TableHead>
                    <TableHead className="text-xs">{t("admin.users.th.name")}</TableHead>
                    <TableHead className="text-xs">{t("admin.users.th.email")}</TableHead>
                    <TableHead className="text-xs">{t("admin.users.th.address")}</TableHead>
                    <TableHead className="text-xs">{t("admin.users.th.status")}</TableHead>
                    <TableHead className="text-xs">{t("common.th.time")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow
                      key={user.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedId(user.id)}
                    >
                      <TableCell className="text-xs">{user.id}</TableCell>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-xs">{user.email ?? "---"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {user.address
                          ? `${user.address.slice(0, 6)}...${user.address.slice(-4)}`
                          : "---"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={String(user.status)} colorMap={userStatusColorMap} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {user.createdAt
                          ? formatDistanceToNow(new Date(user.createdAt), {
                              addSuffix: true,
                              locale: getDateLocale(i18n.language),
                            })
                          : "---"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* Pagination */}
            <Pagination
              page={page}
              onPageChange={setPage}
              currentCount={users.length}
              pageSize={DEFAULT_PAGE_SIZE}
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
