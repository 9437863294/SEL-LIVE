import * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { UiTextLabel } from "@/components/ui/ui-text"

/*
 * The app's one table format. Every register — whether it is a `DataList`, a `TableCard` or a
 * bare `<Table>` — gets the same type size, header band, row rhythm and hover from here, so pages
 * never style their own headers, rows or cell padding. Row height and cell padding follow the
 * user's Table rows setting through `--table-head-h` / `--table-cell-py` / `--table-cell-px`.
 *
 * The company design settings (striped rows, grid lines, header style, sticky headers) live in
 * `src/styles/ui-design.css`, keyed off `data-table-*` attributes on <html> and the `data-slot`
 * hooks below. Those rules are zero-specificity, so a page's own className always wins.
 */

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  containerClassName?: string
  /**
   * Pin the header row while the table scrolls. The scroll container is the table's own wrapper,
   * so give it a height (`containerClassName="max-h-[70vh]"`) for this to take effect. `false`
   * opts this table out of the company-wide sticky-header setting.
   */
  stickyHeader?: boolean
}

const Table = React.forwardRef<
  HTMLTableElement,
  TableProps
>(({ className, containerClassName, stickyHeader, ...props }, ref) => (
  // A native scroll container (not ScrollArea, which swallows the scrollbar), so a wide register
  // scrolls sideways inside its card instead of stretching the page on a phone.
  <div
    data-slot="table-container"
    data-sticky-header={stickyHeader === undefined ? undefined : String(stickyHeader)}
    className={cn("relative w-full overflow-auto", containerClassName)}
  >
    <table
      ref={ref}
      data-slot="table"
      className={cn("w-full caption-bottom text-[13px]", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    data-slot="table-header"
    // A tinted band with a firm rule under it, so the header reads as one at a glance; its row
    // never takes the body's hover. The tint is `--table-header-bg` (ui-design.css) so the
    // company's header style can switch it while a page's own `bg-*` still overrides it.
    className={cn("bg-[var(--table-header-bg)] [&_tr]:border-b [&_tr]:border-slate-200 [&_tr]:hover:bg-transparent", className)}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    data-slot="table-body"
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    data-slot="table-footer"
    className={cn(
      "border-t bg-slate-50 font-semibold [&>tr]:last:border-b-0 [&_tr]:hover:bg-transparent",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    data-slot="table-row"
    className={cn(
      "border-b transition-colors hover:bg-slate-50 data-[state=selected]:bg-slate-100",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    data-slot="table-head"
    className={cn(
      "h-[var(--table-head-h,2.5rem)] whitespace-nowrap px-[var(--table-cell-px,0.875rem)] text-left align-middle text-[11px] font-semibold uppercase tracking-wide text-slate-600 [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    data-slot="table-cell"
    className={cn("px-[var(--table-cell-px,0.875rem)] py-[var(--table-cell-py,0.625rem)] align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    data-slot="table-caption"
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

type TableEmptyProps = {
  /** The table's column count, so the message spans the full width. */
  colSpan: number
  /** The message. Defaults to the company's "noRecords" text. */
  children?: React.ReactNode
  /** An optional lucide icon element shown above the message. */
  icon?: React.ReactNode
  className?: string
}

/** The one empty-state row: centred, muted, spanning every column. Put it inside `<TableBody>`. */
function TableEmpty({ colSpan, children, icon, className }: TableEmptyProps) {
  return (
    <TableRow data-slot="table-empty" className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={cn("h-24 py-8 text-center text-sm text-muted-foreground", className)}>
        <div className="flex flex-col items-center justify-center gap-2">
          {icon ? <span className="opacity-70 [&_svg]:h-6 [&_svg]:w-6" aria-hidden="true">{icon}</span> : null}
          <div>{children ?? <UiTextLabel textKey="noRecords" />}</div>
        </div>
      </TableCell>
    </TableRow>
  )
}

type TableLoadingProps = {
  colSpan: number
  /** How many skeleton rows to show. */
  rows?: number
  className?: string
}

/** Skeleton rows while a register loads. Put it inside `<TableBody>` in place of the data rows. */
function TableLoading({ colSpan, rows = 5, className }: TableLoadingProps) {
  const cols = Math.max(1, colSpan)
  return (
    <>
      {Array.from({ length: Math.max(1, rows) }, (_, r) => (
        <TableRow key={r} data-slot="table-loading" aria-busy="true" className={cn("hover:bg-transparent", className)}>
          {Array.from({ length: cols }, (_, c) => (
            <TableCell key={c}>
              {r === 0 && c === 0 ? (
                <span className="sr-only" role="status">
                  <UiTextLabel textKey="loading" />
                </span>
              ) : null}
              <Skeleton className={cn("h-4", c === 0 ? "w-3/4" : "w-full")} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

/**
 * The bar above a table for search, filters and actions: one row on a desktop, wrapping onto
 * extra lines on a phone. Children that should grow (a search box) take `flex-1 min-w-[12rem]`.
 */
const TableToolbar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="table-toolbar"
    className={cn("flex w-full min-w-0 flex-wrap items-center gap-2", className)}
    {...props}
  />
))
TableToolbar.displayName = "TableToolbar"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableEmpty,
  TableLoading,
  TableToolbar,
}
export type { TableProps, TableEmptyProps, TableLoadingProps }
