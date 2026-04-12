import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/web/components/ui/button";

interface PaginationProps {
  page: number;
  onPageChange: (page: number | ((prev: number) => number)) => void;
  /** Number of items on the current page. Used to determine if "next" should be enabled. */
  currentCount: number;
  /** Expected page size — next is disabled when currentCount < pageSize. */
  pageSize: number;
}

export function Pagination({ page, onPageChange, currentCount, pageSize }: PaginationProps) {
  const { t } = useTranslation();

  const handlePrev = useCallback(() => {
    onPageChange((p) => Math.max(0, p - 1));
  }, [onPageChange]);

  const handleNext = useCallback(() => {
    onPageChange((p) => p + 1);
  }, [onPageChange]);

  if (page === 0 && currentCount < pageSize) return null;

  return (
    <div className="flex items-center justify-between">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={handlePrev}>
        {t("common.pagination.prev")}
      </Button>
      <span className="text-xs text-muted-foreground tabular-nums">
        {t("common.pagination.page", { page: page + 1 })}
      </span>
      <Button variant="outline" size="sm" disabled={currentCount < pageSize} onClick={handleNext}>
        {t("common.pagination.next")}
      </Button>
    </div>
  );
}
