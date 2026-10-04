'use client';

/**
 * The module's table: sortable headers, show/hide columns (remembered in this browser), row
 * selection for bulk actions, a totals row, a header that stays pinned while the body scrolls, and
 * cards instead of a table on a phone.
 *
 * Wide registers scroll inside a native `overflow-auto` box with `min-w-0` on the way up — the app's
 * ScrollArea wrapper hides the horizontal scrollbar, which is useless on a 17-column register.
 * Sorting is done by the server for registers (pass `sort`/`onSort`), or locally for short reports.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface BtColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Plain-text name for the column picker when `header` is not a string. */
  label?: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Server sort key, or a local comparator value. */
  sortKey?: string;
  sortValue?: (row: T) => string | number;
  /** Hidden until switched on in the column picker. */
  defaultHidden?: boolean;
  /** Cannot be hidden (identity columns). */
  pinned?: boolean;
  className?: string;
  headerClassName?: string;
  total?: React.ReactNode;
  /** Phone card placement: `title` (first line), `aside` (right of title), `detail` (grid), `omit`. */
  mobile?: 'title' | 'aside' | 'detail' | 'omit';
}

export interface BtTableProps<T extends { id: string }> {
  rows: T[];
  columns: BtColumn<T>[];
  /** Key for remembering hidden columns. */
  storageKey?: string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  rowHref?: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  showTotals?: boolean;
  maxHeightClassName?: string;
  toolbarSlot?: React.ReactNode;
  dense?: boolean;
}

function readHidden(key: string | undefined, columns: BtColumn<unknown>[]): Set<string> {
  const fallback = new Set(columns.filter((column) => column.defaultHidden).map((column) => column.key));
  if (!key) return fallback;
  try {
    const stored = window.localStorage.getItem(`bt-columns:${key}`);
    return stored ? new Set(JSON.parse(stored) as string[]) : fallback;
  } catch {
    return fallback;
  }
}

export function BtTable<T extends { id: string }>({
  rows,
  columns,
  storageKey,
  sort,
  onSort,
  selectable,
  selected,
  onSelectedChange,
  rowHref,
  rowClassName,
  empty,
  showTotals,
  maxHeightClassName = 'max-h-[70vh]',
  toolbarSlot,
  dense,
}: BtTableProps<T>) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((column) => column.defaultHidden).map((column) => column.key)));
  const [localSort, setLocalSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    setHidden(readHidden(storageKey, columns as BtColumn<unknown>[]));
    // Columns are static per table; only the storage key matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const toggleColumn = (key: string) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        if (storageKey) window.localStorage.setItem(`bt-columns:${storageKey}`, JSON.stringify([...next]));
      } catch {
        // Private mode: the choice lasts for this visit only.
      }
      return next;
    });
  };

  const visible = columns.filter((column) => column.pinned || !hidden.has(column.key));
  const activeSort = onSort ? sort : localSort;

  const sortedRows = useMemo(() => {
    if (onSort || !localSort) return rows;
    const column = columns.find((entry) => (entry.sortKey ?? entry.key) === localSort.key);
    if (!column?.sortValue) return rows;
    const factor = localSort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = column.sortValue?.(a) ?? '';
      const y = column.sortValue?.(b) ?? '';
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * factor;
    });
  }, [rows, columns, localSort, onSort]);

  const clickSort = (column: BtColumn<T>) => {
    const key = column.sortKey ?? column.key;
    if (!column.sortKey && !column.sortValue) return;
    const dir: 'asc' | 'desc' = activeSort?.key === key && activeSort.dir === 'desc' ? 'asc' : 'desc';
    if (onSort) onSort(key, dir);
    else setLocalSort({ key, dir });
  };

  const allSelected = selectable && rows.length > 0 && rows.every((row) => selected?.has(row.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) rows.forEach((row) => next.delete(row.id));
    else rows.forEach((row) => next.add(row.id));
    onSelectedChange?.(next);
  };
  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.(next);
  };

  const hideable = columns.filter((column) => !column.pinned);
  const alignClass = (align?: string) => (align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left');
  const titleColumn = columns.find((column) => column.mobile === 'title') ?? columns[0];
  const asideColumn = columns.find((column) => column.mobile === 'aside');
  const detailColumns = visible.filter((column) => column !== titleColumn && column !== asideColumn && column.mobile !== 'omit');

  return (
    <div className="min-w-0 space-y-2">
      {(hideable.length > 0 || toolbarSlot) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {toolbarSlot}
          {hideable.length > 3 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex">
                  <Columns className="h-4 w-4" /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideable.map((column) => (
                  <DropdownMenuCheckboxItem key={column.key} checked={!hidden.has(column.key)} onCheckedChange={() => toggleColumn(column.key)} onSelect={(event) => event.preventDefault()}>
                    {column.label ?? (typeof column.header === 'string' ? column.header : column.key)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-white/60 bg-white/70">{empty}</div>
      ) : (
        <>
          {/* Phone: cards */}
          <div className="space-y-2 sm:hidden">
            {sortedRows.map((row) => {
              const content = (
                <div className={cn('rounded-xl border border-slate-200 bg-white p-3 shadow-sm', rowClassName?.(row))}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 font-medium text-slate-800">{titleColumn.cell(row)}</div>
                    {asideColumn ? <div className="shrink-0 text-right">{asideColumn.cell(row)}</div> : null}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    {detailColumns.map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-muted-foreground">{column.label ?? (typeof column.header === 'string' ? column.header : column.key)}</dt>
                        <dd className="truncate text-slate-700">{column.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
              return rowHref ? (
                <Link key={row.id} href={rowHref(row)} className="block">
                  {content}
                </Link>
              ) : (
                <div key={row.id}>{content}</div>
              );
            })}
          </div>

          {/* Desktop: table */}
          <div className={cn('hidden min-w-0 overflow-auto rounded-xl border border-slate-200 bg-white sm:block', maxHeightClassName)}>
            <table className={cn('w-full border-collapse text-sm', dense ? '[&_td]:py-1.5' : '[&_td]:py-2')}>
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
                <tr>
                  {selectable ? (
                    <th className="w-10 px-3 py-2">
                      <Checkbox checked={Boolean(allSelected)} onCheckedChange={toggleAll} aria-label="Select all rows on this page" />
                    </th>
                  ) : null}
                  {visible.map((column) => {
                    const key = column.sortKey ?? column.key;
                    const sortable = Boolean(column.sortKey || column.sortValue);
                    const active = activeSort?.key === key;
                    return (
                      <th key={column.key} scope="col" className={cn('whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500', alignClass(column.align), column.headerClassName)} aria-sort={active ? (activeSort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                        {sortable ? (
                          <button type="button" onClick={() => clickSort(column)} className={cn('inline-flex items-center gap-1 hover:text-slate-900', column.align === 'right' && 'flex-row-reverse')}>
                            {column.header}
                            {active ? activeSort?.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                          </button>
                        ) : (
                          column.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id} className={cn('border-t border-slate-100 hover:bg-emerald-50/40', selected?.has(row.id) && 'bg-emerald-50/60', rowClassName?.(row))}>
                    {selectable ? (
                      <td className="px-3">
                        <Checkbox checked={Boolean(selected?.has(row.id))} onCheckedChange={() => toggleRow(row.id)} aria-label="Select row" />
                      </td>
                    ) : null}
                    {visible.map((column) => (
                      <td key={column.key} className={cn('px-3 align-middle', alignClass(column.align), column.className)}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {showTotals ? (
                <tfoot className="sticky bottom-0 bg-slate-100 font-semibold">
                  <tr className="border-t-2 border-slate-300">
                    {selectable ? <td /> : null}
                    {visible.map((column, index) => (
                      <td key={column.key} className={cn('whitespace-nowrap px-3 py-2', alignClass(column.align))}>
                        {column.total ?? (index === 0 ? 'Total' : null)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function Pager({ page, pages, total, pageSize, onPage, onPageSize }: { page: number; pages: number; total: number; pageSize: number; onPage: (page: number) => void; onPageSize?: (size: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total.toLocaleString('en-IN')}
      </span>
      <div className="flex items-center gap-2">
        {onPageSize ? (
          <select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        ) : null}
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
