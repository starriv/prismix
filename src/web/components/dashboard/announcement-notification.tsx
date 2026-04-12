import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { truncate } from "lodash-es";
import { ChevronDown, ChevronUp, ExternalLink, Megaphone, X } from "lucide-react";

import { queryKeys } from "@/web/api/query-keys";
import type { Announcement } from "@/web/api/schemas";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { MarkdownRenderer } from "@/web/components/ui/markdown";
import { Separator } from "@/web/components/ui/separator";
import { cn } from "@/web/shared/utils";

import { useAnnouncements } from "../../api/hooks";
import { useSse } from "../../hooks/use-sse";
import { useAdminAuthContext } from "../../providers/admin-auth-provider";

const STORAGE_KEY = "prismix_dismissed_announcements";
const MAX_DISMISSED_ENTRIES = 100;
const BODY_TRUNCATE_LENGTH = 100;

// ── localStorage helpers ─────────────────────────────────────

function getDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function addDismissedId(id: string): void {
  const ids = getDismissedIds();
  if (ids.includes(id)) return;
  ids.push(id);
  const trimmed = ids.length > MAX_DISMISSED_ENTRIES ? ids.slice(-MAX_DISMISSED_ENTRIES) : ids;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

function addDismissedIds(newIds: string[]): void {
  const ids = getDismissedIds();
  for (const id of newIds) {
    if (!ids.includes(id)) ids.push(id);
  }
  const trimmed = ids.length > MAX_DISMISSED_ENTRIES ? ids.slice(-MAX_DISMISSED_ENTRIES) : ids;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

// ── Component ────────────────────────────────────────────────

export function AnnouncementNotification() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAdminAuthContext();
  const qc = useQueryClient();
  const { data: announcements = [] } = useAnnouncements();
  const { subscribe } = useSse({ enabled: isAuthenticated });

  const [dismissedIds, setDismissedIds] = useState<string[]>(getDismissedIds);
  const [expanded, setExpanded] = useState(false);
  const [detailTarget, setDetailTarget] = useState<Announcement | null>(null);

  const visible = useMemo(() => {
    return announcements.filter((a) => a.status === "sent" && !dismissedIds.includes(a.id));
  }, [announcements, dismissedIds]);

  const latest = visible[0] ?? null;
  const rest = visible.slice(1);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribe("system.announcement", () => {
      qc.invalidateQueries({ queryKey: queryKeys.announcements() });
    });
    return unsub;
  }, [isAuthenticated, subscribe, qc]);

  const handleDismiss = useCallback((id: string) => {
    addDismissedId(id);
    setDismissedIds((prev) => [...prev, id]);
  }, []);

  const handleDismissAll = useCallback(() => {
    const ids = visible.map((a) => a.id);
    addDismissedIds(ids);
    setDismissedIds((prev) => [...prev, ...ids]);
    setExpanded(false);
  }, [visible]);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleViewDetail = useCallback((a: Announcement) => {
    setDetailTarget(a);
  }, []);

  if (!latest) return null;

  return (
    <>
      <div className="fixed bottom-4 right-8 z-50 w-[380px] max-w-[calc(100vw-2rem)]">
        <Card className="border-primary/20 shadow-lg transition-all duration-300">
          <AnnouncementRow
            announcement={latest}
            onDismiss={handleDismiss}
            onViewDetail={handleViewDetail}
            isFirst
          />

          {rest.length > 0 && (
            <>
              <Separator />
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                onClick={toggleExpand}
              >
                <span>{t("dash.announce.more-count", { count: rest.length })}</span>
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}

          {expanded &&
            rest.map((a) => (
              <div key={a.id}>
                <Separator />
                <AnnouncementRow
                  announcement={a}
                  onDismiss={handleDismiss}
                  onViewDetail={handleViewDetail}
                />
              </div>
            ))}

          {visible.length > 1 && (
            <>
              <Separator />
              <div className="flex justify-end px-3 py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={handleDismissAll}
                >
                  {t("dash.announce.dismiss-all")}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Detail dialog ── */}
      <DetailDialog announcement={detailTarget} onClose={() => setDetailTarget(null)} />
    </>
  );
}

// ── Row ──────────────────────────────────────────────────────

interface AnnouncementRowProps {
  announcement: Announcement;
  onDismiss: (id: string) => void;
  onViewDetail: (a: Announcement) => void;
  isFirst?: boolean;
}

function AnnouncementRow({ announcement, onDismiss, onViewDetail, isFirst }: AnnouncementRowProps) {
  const { t } = useTranslation();
  const isLong = announcement.body.length > BODY_TRUNCATE_LENGTH;

  const handleDismiss = useCallback(() => {
    onDismiss(announcement.id);
  }, [announcement.id, onDismiss]);

  const handleViewDetail = useCallback(() => {
    onViewDetail(announcement);
  }, [announcement, onViewDetail]);

  const handleOpenLink = useCallback(() => {
    if (announcement.link) {
      window.open(announcement.link, "_blank", "noopener,noreferrer");
    }
  }, [announcement.link]);

  const sentTime = announcement.sentAt
    ? formatDistanceToNow(new Date(announcement.sentAt), { addSuffix: true })
    : null;

  return (
    <CardContent className={cn("p-3", !isFirst && "pb-3")}>
      <div className="flex items-start gap-3">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight">{announcement.title}</p>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0"
              onClick={handleDismiss}
            >
              <X className="h-3 w-3" />
              <span className="sr-only">{t("dash.announce.dismiss")}</span>
            </Button>
          </div>
          {sentTime && <p className="mt-0.5 text-xs text-muted-foreground">{sentTime}</p>}
          <div className="mt-1 max-h-20 overflow-hidden">
            <MarkdownRenderer
              content={truncate(announcement.body, {
                length: isFirst ? BODY_TRUNCATE_LENGTH : 80,
                omission: "...",
              })}
              className="text-xs text-muted-foreground"
            />
          </div>
          {/* Action buttons: view detail + open link */}
          <div className="mt-1.5 flex items-center gap-2">
            {isLong && (
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={handleViewDetail}
              >
                {t("dash.announce.view-detail")}
              </button>
            )}
            {announcement.link && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={handleOpenLink}
              >
                {t("dash.announce.open-link")}
                <ExternalLink className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </CardContent>
  );
}

// ── Detail Dialog ────────────────────────────────────────────

function DetailDialog({
  announcement,
  onClose,
}: {
  announcement: Announcement | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const handleOpenLink = useCallback(() => {
    if (announcement?.link) {
      window.open(announcement.link, "_blank", "noopener,noreferrer");
    }
  }, [announcement?.link]);

  return (
    <Dialog open={!!announcement} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement?.title}</DialogTitle>
        </DialogHeader>
        <DialogBody className="!p-0">
          <div className="max-h-[300px] overflow-y-auto px-4 py-3">
            {announcement && <MarkdownRenderer content={announcement.body} />}
          </div>
          {announcement?.link && (
            <div className="border-t px-4 py-2.5">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                onClick={handleOpenLink}
              >
                {t("dash.announce.open-link")}
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
