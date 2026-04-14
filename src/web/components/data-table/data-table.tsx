"use client";

import { Fragment, type ReactNode, useCallback, useEffect, useState } from "react";

import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  Row,
  SortingState,
  Table as TanStackTable,
  VisibilityState,
} from "@tanstack/react-table";
import {
  flexRender,
  functionalUpdate,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Loader2 } from "lucide-react";

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

import { DataTablePagination } from "./data-table-pagination";

interface DataTableLoadingState {
  fetching: boolean;
  initial: boolean;
}

interface DataTableProps<TData, TValue> {
  className?: string;
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyText: string;
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string;
  initialPageSize?: number;
  loading?: boolean | DataTableLoadingState;
  manualPagination?: boolean;
  manualSorting?: boolean;
  onPaginationChange?: OnChangeFn<PaginationState>;
  onRowClick?: (row: TData) => void;
  onSortingChange?: OnChangeFn<SortingState>;
  pageCount?: number;
  pageSizeOptions?: number[];
  pagination?: PaginationState;
  renderExpandedRow?: (row: TData) => ReactNode | null;
  rowClassName?: (row: TData) => string | undefined;
  rowCount?: number;
  showPagination?: boolean;
  sorting?: SortingState;
  tableClassName?: string;
  toolbar?: ReactNode | ((table: TanStackTable<TData>) => ReactNode);
}

export function DataTable<TData, TValue>({
  className,
  columns,
  data,
  emptyText,
  getRowId,
  initialPageSize = 10,
  loading = false,
  manualPagination = false,
  manualSorting = false,
  onPaginationChange,
  onRowClick,
  onSortingChange,
  pageCount,
  pageSizeOptions,
  pagination: controlledPagination,
  renderExpandedRow,
  rowClassName,
  rowCount,
  showPagination = true,
  sorting: controlledSorting,
  tableClassName,
  toolbar,
}: DataTableProps<TData, TValue>) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);

  // Reset expanded row when page changes or data refreshes
  useEffect(() => {
    setExpandedRowId(null);
  }, [controlledPagination?.pageIndex, data]);

  const pagination = controlledPagination ?? internalPagination;
  const sorting = controlledSorting ?? internalSorting;

  const handlePaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => {
      if (controlledPagination === undefined) {
        setInternalPagination((prev) => functionalUpdate(updater, prev));
      }
      onPaginationChange?.(updater);
    },
    [controlledPagination, onPaginationChange],
  );

  const handleSortingChange = useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      if (controlledSorting === undefined) {
        setInternalSorting((prev) => functionalUpdate(updater, prev));
      }
      onSortingChange?.(updater);
    },
    [controlledSorting, onSortingChange],
  );

  const initialLoading = typeof loading === "object" ? loading.initial : loading;
  const isFetching = typeof loading === "object" ? loading.fetching : loading;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    getRowId,
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    manualPagination,
    manualSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: handlePaginationChange,
    onSortingChange: handleSortingChange,
    pageCount,
    rowCount,
    state: {
      columnVisibility,
      pagination,
      sorting,
    },
  });

  const showSkeleton = initialLoading && data.length === 0;
  const showOverlay = isFetching && !showSkeleton && data.length > 0;
  const skeletonRows = Math.min(Math.max(pagination.pageSize, 1), 6);
  const renderedRows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length || columns.length;

  return (
    <div className={cn("space-y-4", className)}>
      {typeof toolbar === "function" ? toolbar(table) : toolbar}

      <div className="relative" aria-live="polite">
        {showOverlay && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-md bg-background/50 pt-20">
            <span className="animate-spin">
              <Loader2 className="h-5 w-5 text-muted-foreground" />
            </span>
          </div>
        )}

        <div className="overflow-hidden rounded-md border">
          <Table className={cn("md:table-fixed", tableClassName)}>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta;

                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          meta?.align === "center" && "text-center",
                          meta?.align === "right" && "text-right",
                          meta?.hiddenOnMobile && "hidden md:table-cell",
                          meta?.headerClassName,
                        )}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {showSkeleton
                ? Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                    <TableRow key={rowIndex} className="pointer-events-none hover:bg-transparent">
                      {table.getVisibleLeafColumns().map((column) => {
                        const meta = column.columnDef.meta;

                        return (
                          <TableCell
                            key={column.id}
                            className={cn(
                              meta?.align === "center" && "text-center",
                              meta?.align === "right" && "text-right",
                              meta?.hiddenOnMobile && "hidden md:table-cell",
                              meta?.cellClassName,
                            )}
                          >
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                : renderedRows.map((row) => {
                    const expanded = renderExpandedRow ? renderExpandedRow(row.original) : null;
                    const canExpand = expanded !== null;
                    const isExpanded = canExpand && expandedRowId === row.id;
                    const clickable = canExpand || !!onRowClick;

                    const handleClick = () => {
                      if (canExpand) {
                        setExpandedRowId((current) => (current === row.id ? null : row.id));
                        return;
                      }
                      onRowClick?.(row.original);
                    };

                    return (
                      <Fragment key={row.id}>
                        <TableRow
                          className={cn(
                            clickable && "cursor-pointer",
                            rowClassName?.(row.original),
                          )}
                          onClick={clickable ? handleClick : undefined}
                          onKeyDown={
                            clickable
                              ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleClick();
                                  }
                                }
                              : undefined
                          }
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                        >
                          {row.getVisibleCells().map((cell) => {
                            const meta = cell.column.columnDef.meta;

                            return (
                              <TableCell
                                key={cell.id}
                                className={cn(
                                  meta?.align === "center" && "text-center",
                                  meta?.align === "right" && "text-right",
                                  meta?.hiddenOnMobile && "hidden md:table-cell",
                                  meta?.cellClassName,
                                )}
                              >
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            );
                          })}
                        </TableRow>

                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={visibleColumnCount} className="p-0">
                              {expanded}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}

              {!showSkeleton && renderedRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnCount}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {emptyText}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {showPagination && <DataTablePagination pageSizeOptions={pageSizeOptions} table={table} />}
    </div>
  );
}
