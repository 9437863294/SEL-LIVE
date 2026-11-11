'use client';

/**
 * Previous / next paging for a register, with "Showing 1–25 of 312" and an optional rows-per-page
 * picker. Moved here from Bill Tracking's table (which re-exports it) so other modules page their
 * long lists the same way.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function Pager({ page, pages, total, pageSize, onPage, onPageSize }: { page: number; pages: number; total: number; pageSize: number; onPage: (page: number) => void; onPageSize?: (size: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>
        Showing <b className="font-semibold text-slate-700">{from}–{to}</b> of <b className="font-semibold text-slate-700">{total.toLocaleString('en-IN')}</b>
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
