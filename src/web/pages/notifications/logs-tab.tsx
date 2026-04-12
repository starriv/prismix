import { useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";

import { PAGE_SIZE, useNotificationLogs } from "@/web/api/hooks";
import type { NotificationLog } from "@/web/api/schemas";
import { Pagination } from "@/web/components/dashboard/pagination";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { getDateLocale } from "@/web/shared/date-locale";
import { cn } from "@/web/shared/utils";

import { useChannelLabels } from "./use-channel-labels";

export function LogsTab() {
  const { t, i18n } = useTranslation();
  const channelLabels = useChannelLabels();
  const [page, setPage] = useState(0);
  const { data: logs = [], isLoading } = useNotificationLogs({ page });

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <span className="animate-spin">
                <Loader2 className="h-5 w-5 text-muted-foreground" />
              </span>
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              {t("notif.logs-empty")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("notif.logs-th.event")}</TableHead>
                  <TableHead>{t("notif.logs-th.channel")}</TableHead>
                  <TableHead>{t("notif.logs-th.target")}</TableHead>
                  <TableHead>{t("notif.logs-th.status")}</TableHead>
                  <TableHead>{t("notif.logs-th.time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log: NotificationLog) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-xs font-mono">{log.event}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{channelLabels[log.channel] ?? log.channel}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate">
                      {log.target}
                    </TableCell>
                    <TableCell>
                      <LogStatusBadge status={log.status} t={t} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(log.createdAt), {
                        addSuffix: true,
                        locale: getDateLocale(i18n.language),
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <Pagination
        page={page}
        onPageChange={setPage}
        currentCount={logs.length}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}

// ── Helper ──────────────────────────────────────────────────────────

function LogStatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs",
        status === "sent" && "border-green-500/30 bg-green-500/10 text-green-600",
        status === "failed" && "border-destructive/30 bg-destructive/10 text-destructive",
        status === "pending" && "",
      )}
    >
      {t(`notif.log-status.${status}`)}
    </Badge>
  );
}
