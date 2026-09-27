'use client';

/**
 * The accent palette Expenses' badges and sidebar share, so a page's chip and its nav entry keep
 * the same hue. Page headers are the app's standard `PageHeader` (`shared/page-header`).
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type ExpenseAccent = 'blue' | 'violet' | 'fuchsia' | 'teal' | 'emerald' | 'amber';

/** One row per sidebar colour, so a page and its nav entry are always the same hue. */
export const EXPENSE_ACCENTS: Record<
  ExpenseAccent,
  { tile: string; title: string; halo: string; rule: string; chip: string }
> = {
  blue: {
    tile: 'from-blue-500 to-indigo-600',
    title: 'from-blue-700 to-indigo-600',
    halo: 'bg-blue-400/20',
    rule: 'from-blue-500/50',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  violet: {
    tile: 'from-violet-500 to-purple-600',
    title: 'from-violet-700 to-purple-600',
    halo: 'bg-violet-400/20',
    rule: 'from-violet-500/50',
    chip: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  fuchsia: {
    tile: 'from-fuchsia-500 to-pink-600',
    title: 'from-fuchsia-700 to-pink-600',
    halo: 'bg-fuchsia-400/20',
    rule: 'from-fuchsia-500/50',
    chip: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  },
  teal: {
    tile: 'from-teal-500 to-emerald-600',
    title: 'from-teal-700 to-emerald-600',
    halo: 'bg-teal-400/20',
    rule: 'from-teal-500/50',
    chip: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  emerald: {
    tile: 'from-emerald-500 to-green-600',
    title: 'from-emerald-700 to-green-600',
    halo: 'bg-emerald-400/20',
    rule: 'from-emerald-500/50',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  amber: {
    tile: 'from-amber-500 to-orange-600',
    title: 'from-amber-700 to-orange-600',
    halo: 'bg-amber-400/20',
    rule: 'from-amber-500/50',
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

/** A small tinted pill, for the accent chip callers pass as `badge`. */
export function ExpenseBadge({ accent = 'blue', children }: { accent?: ExpenseAccent; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        EXPENSE_ACCENTS[accent].chip,
      )}
    >
      {children}
    </span>
  );
}
