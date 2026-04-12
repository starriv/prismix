import { Fragment, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { Loader2 } from "lucide-react";

import { Button } from "@/web/components/ui/button";
import { Skeleton } from "@/web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/web/components/ui/table";
import { cn } from "@/web/shared/utils";

// ── Types ──────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  /** i18n key or raw string for the header label */
  header: string;
  /** Fixed width, e.g. "w-[60px]" or "w-[20%]" */
  width?: string;
  /** Render the cell content for a row */
  cell: (row: T) => ReactNode;
  /** Hide this column below md breakpoint */
  hiddenOnMobile?: boolean;
}

interface DataTableProps<T> {
  /** Column definitions */
  columns: DataTableColumn<T>[];
  /** Row data array */
  data: T[];
  /** Unique key extractor per row */
  rowKey: (row: T) => string | number;
  /** Text shown when data is empty */
  emptyText: string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /**
   * Render an expanded detail row below the clicked row.
   * Return null to indicate the row is not expandable.
   * When provided, clicking a row toggles its expanded state.
   */
  renderExpandedRow?: (row: T) => ReactNode | null;
  /** Pagination — current page (0-indexed). Omit to disable pagination. */
  page?: number;
  /** Page change callback */
  onPageChange?: (page: number) => void;
  /** Page size — used to determine if there's a next page */
  pageSize?: number;
  /**
   * Show loading state.
   * - `boolean` — backwards-compat, controls both skeleton + overlay
   * - `{ initial: boolean; fetching: boolean }` — fine-grained:
   *     `initial` (isLoading) → skeleton rows on first load
   *     `fetching` (isFetching) → subtle overlay during background refetch
   */
  loading?: boolean | { initial: boolean; fetching: boolean };
}

// ── Component ──────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyText,
  onRowClick,
  renderExpandedRow,
  page,
  onPageChange,
  pageSize = 10,
  loading = false,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const hasPagination = page != null && onPageChange != null;
  const hasNext = data.length === pageSize;
  const [expandedId, setExpandedId] = useState<string | number | null>(null);

  // Normalise loading prop — support both boolean (legacy) and split object
  const initialLoading = typeof loading === "object" ? loading.initial : loading;
  const isFetching = typeof loading === "object" ? loading.fetching : loading;

  const isExpandable = !!renderExpandedRow;

  const showSkeleton = initialLoading && data.length === 0;
  const showOverlay = isFetching && !showSkeleton && data.length > 0;

  return (
    <>
      <div className="relative min-h-[320px] md:min-h-[480px]" aria-live="polite">
        {/* Subtle overlay when refetching with existing data */}
        {showOverlay && (
          <div className="absolute inset-0 z-10 flex items-start justify-center bg-background/50 pt-24">
            <span className="animate-spin">
              <Loader2 className="h-5 w-5 text-muted-foreground" />
            </span>
          </div>
        )}

        <Table className="md:table-fixed">
          <TableHeader>
            <TableRow>
              {columns.map((col, i) => (
                <TableHead
                  key={i}
                  className={cn(col.width, col.hiddenOnMobile && "hidden md:table-cell")}
                >
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {showSkeleton
              ? Array.from({ length: 5 }).map((_, rowIdx) => (
                  <TableRow key={rowIdx} className="pointer-events-none hover:bg-transparent">
                    {columns.map((col, colIdx) => (
                      <TableCell
                        key={colIdx}
                        className={cn(col.hiddenOnMobile && "hidden md:table-cell")}
                      >
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data.map((row) => {
                  const id = rowKey(row);
                  const expanded = renderExpandedRow ? renderExpandedRow(row) : null;
                  const canExpand = isExpandable && expanded !== null;
                  const isExpanded = canExpand && expandedId === id;
                  const clickable = canExpand || !!onRowClick;

                  const handleClick = () => {
                    if (canExpand) {
                      setExpandedId(isExpanded ? null : id);
                    } else if (onRowClick) {
                      onRowClick(row);
                    }
                  };

                  return (
                    <Fragment key={id}>
                      <TableRow
                        className={clickable ? "cursor-pointer hover:bg-muted/50" : undefined}
                        onClick={clickable ? handleClick : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleClick();
                                }
                              }
                            : undefined
                        }
                        tabIndex={clickable ? 0 : undefined}
                        role={clickable ? "button" : undefined}
                      >
                        {columns.map((col, i) => (
                          <TableCell
                            key={i}
                            className={cn(col.hiddenOnMobile && "hidden md:table-cell")}
                          >
                            {col.cell(row)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={columns.length} className="p-0">
                            {expanded}
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
            {!showSkeleton && !isFetching && data.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasPagination && (page > 0 || hasNext) && (
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || isFetching}
            onClick={() => onPageChange(page - 1)}
          >
            {t("common.pagination.prev")}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("common.pagination.page", { page: page + 1 })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext || isFetching}
            onClick={() => onPageChange(page + 1)}
          >
            {t("common.pagination.next")}
          </Button>
        </div>
      )}
    </>
  );
}
