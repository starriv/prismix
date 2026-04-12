import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";

import { useAdminUsers } from "@/web/api/admin-hooks";
import { Header } from "@/web/components/dashboard/header";
import { StatusBadge } from "@/web/components/dashboard/status-badge";
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

import { USER_STATUS_COLORS, USER_STATUS_KEYS } from "./constants";
import { UserDetailSheet } from "./user-detail-sheet";

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const { data: users = [], isLoading } = useAdminUsers();
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

  return (
    <div>
      <Header title={t("admin.users.title")} description={t("admin.users.desc")} />

      <div className="p-4 md:p-8">
        <Card>
          <CardContent className="pt-6">
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-4">{t("auth.loading")}</p>
            ) : !users.length ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
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
                          ? formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })
                          : "---"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
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
