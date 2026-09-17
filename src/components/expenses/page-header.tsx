'use client';

/**
 * The module's page header.
 *
 * Colour here is doing a job, not decoration: each page carries the same accent as its entry in
 * the sidebar, so the tinted icon tile tells you where you are at a glance and the two never
 * disagree. Shared rather than hand-tinted per page, because six headers styled independently is
 * how a module ends up with six slightly different blues.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export function ExpensesPageHeader({
  icon: Icon,
  title,
  description,
  accent = 'blue',
  backHref,
  badge,
  actions,
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  accent?: ExpenseAccent;
  /** Omit on the module's own landing page. */
  backHref?: string;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  const tone = EXPENSE_ACCENTS[accent];

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/60 bg-white/70 px-4 py-3.5 shadow-sm backdrop-blur-sm">
      <div className={cn('pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full blur-3xl', tone.halo)} />
      <div className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r to-transparent', tone.rule)} />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {backHref && (
            <Link href={backHref} aria-label="Back">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
              tone.tile,
            )}
          >
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1
                className={cn(
                  'bg-gradient-to-r bg-clip-text text-xl font-bold tracking-tight text-transparent',
                  tone.title,
                )}
              >
                {title}
              </h1>
              {badge}
            </div>
            {description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

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
