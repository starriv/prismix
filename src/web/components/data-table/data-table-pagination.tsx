"use client";

import { useTranslation } from "react-i18next";

import type { Table } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/web/components/ui/select";

interface DataTablePaginationProps<TData> {
  pageSizeOptions?: number[];
  table: Table<TData>;
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = [],
}: DataTablePaginationProps<TData>) {
  const { t } = useTranslation();
  const { pageIndex, pageSize } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const canJumpToLast = pageCount > 0 && Number.isFinite(pageCount);

  if (!table.getCanPreviousPage() && !table.getCanNextPage() && pageCount <= 1) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground tabular-nums">
        {pageCount > 0
          ? `${t("common.pagination.page", { page: pageIndex + 1 })} / ${pageCount}`
          : t("common.pagination.page", { page: pageIndex + 1 })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {pageSizeOptions.length > 0 && (
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("common.pagination.rowsPerPage")}
            </p>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger size="sm" className="w-[88px]">
                <SelectValue placeholder={String(pageSize)} />
              </SelectTrigger>
              <SelectContent side="top">
                {Array.from(new Set([...pageSizeOptions, pageSize]))
                  .sort((a, b) => a - b)
                  .map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">{t("common.pagination.first")}</span>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">{t("common.pagination.prev")}</span>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">{t("common.pagination.next")}</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage() || !canJumpToLast}
          >
            <span className="sr-only">{t("common.pagination.last")}</span>
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
