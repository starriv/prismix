/* eslint-disable @typescript-eslint/no-unused-vars */
import type { RowData } from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "center" | "right";
    cellClassName?: string;
    headerClassName?: string;
    hiddenOnMobile?: boolean;
    maxWidth?: number | string;
    minWidth?: number | string;
    sticky?: "left" | "right";
    visibilityLabel?: string;
    width?: number | string;
  }
}
