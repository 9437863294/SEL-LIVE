'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';

/**
 * Tone overrides for `StatusBadge` on requisition statuses. The workflow's intermediate stages
 * (Received, Verified, Received for Payment) read as stages in flight, not as done — only Paid is.
 * Every other status takes the shared vocabulary's tone.
 */
export const DAILY_STATUS_TONE: Partial<Record<string, StatusTone>> = {
  Received: 'info',
  Verified: 'info',
  'Received for Payment': 'progress',
  'Partially Paid': 'warning',
};

/** The shared module shell pads the content column, so a page adds none of its own. */
export const dailyPageContainerClass = 'w-full';
export const dailySurfaceCardClass =
  'overflow-hidden rounded-2xl border border-white/70 bg-white/70 shadow-[0_20px_70px_-55px_rgba(2,6,23,0.55)] backdrop-blur';
export const dailyTabsListClass =
  'grid h-auto w-full rounded-xl border border-white/70 bg-white/70 p-1 backdrop-blur';

interface DailyWorkflowCardProps {
  item: {
    icon: LucideIcon;
    title: string;
    description: string;
    href: string;
    disabled?: boolean;
    accentClassName?: string;
    badge?: string;
    /**
     * A live figure under the description ("12 waiting"). `null` while it loads (a placeholder
     * holds the line so the grid does not jump); leave it out for no line at all.
     */
    count?: number | null;
    countLabel?: string;
  };
}

export function DailyWorkflowCard({ item }: DailyWorkflowCardProps) {
  const cardContent = (
    <Card
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-white/70 bg-white/65 shadow-[0_18px_60px_-45px_rgba(2,6,23,0.35)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_80px_-55px_rgba(2,6,23,0.55)]',
        item.href === '#' || item.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      )}
    >
      <div
        className={cn(
          'h-1.5 w-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300 opacity-70',
          item.accentClassName
        )}
      />
      <CardHeader className="flex-row items-center gap-4 space-y-0 p-5">
        <div className="rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm transition-colors group-hover:bg-white">
          <item.icon className="h-6 w-6 text-slate-900/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold text-slate-900">{item.title}</CardTitle>
            {item.badge ? (
              <span className="shrink-0 rounded-full border border-white/70 bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {item.badge}
              </span>
            ) : null}
          </div>
          <CardDescription className="mt-1 text-xs text-slate-600">{item.description}</CardDescription>
          {item.count === null ? (
            <Skeleton className="mt-2 h-4 w-24" />
          ) : typeof item.count === 'number' ? (
            <p className="mt-2 text-xs text-slate-600">
              <span className="font-semibold tabular-nums text-slate-900">{item.count.toLocaleString('en-IN')}</span>{' '}
              {item.countLabel ?? 'waiting'}
            </p>
          ) : null}
        </div>
      </CardHeader>
    </Card>
  );

  if (item.href === '#' || item.disabled) {
    return <div className="h-full">{cardContent}</div>;
  }

  return (
    <Link href={item.href} className="h-full no-underline">
      {cardContent}
    </Link>
  );
}

export interface DailyStat {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Text colour of the value, e.g. `text-emerald-700`. */
  tone?: string;
}

// Columns per item count, and a span for the last item where a row would otherwise end short and
// show the hairline background as an empty cell. Static strings so Tailwind sees them all.
const STAT_GRID: Record<number, { grid: string; last?: string }> = {
  2: { grid: 'grid-cols-2' },
  3: { grid: 'grid-cols-2 sm:grid-cols-3', last: 'col-span-2 sm:col-span-1' },
  4: { grid: 'grid-cols-2 sm:grid-cols-4' },
  5: { grid: 'grid-cols-2 sm:grid-cols-5', last: 'col-span-2 sm:col-span-1' },
};

/**
 * The figures above a register in one frame, split by hairlines — lighter than a row of cards, and
 * the same shape as Bill Tracking's totals strip. Theme tokens, so it reads in dark mode as well.
 */
export function DailyStatStrip({
  items,
  flush = false,
  className,
}: {
  items: DailyStat[];
  /** Inside another card (a page's header card): no frame of its own, only a rule above it. */
  flush?: boolean;
  className?: string;
}) {
  const layout = STAT_GRID[items.length] ?? { grid: 'grid-cols-2 sm:grid-cols-4' };
  return (
    <dl className={cn('grid gap-px overflow-hidden bg-border', flush ? 'border-t' : 'rounded-xl border shadow-sm', layout.grid, className)}>
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn('min-w-0 bg-card', flush ? 'px-4 py-3 sm:px-5' : 'px-3.5 py-2.5', index === items.length - 1 && layout.last)}
        >
          <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className={cn('mt-0.5 truncate text-lg font-semibold leading-tight tabular-nums', item.tone ?? 'text-foreground')}>
            {item.value}
          </dd>
          {item.hint ? <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
