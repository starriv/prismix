"use client";

import type { ComponentProps } from "react";

import { cn } from "@/web/shared/utils";

export function DataTableToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
        className,
      )}
      {...props}
    />
  );
}
