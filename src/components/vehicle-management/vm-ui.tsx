'use client';

/**
 * Vehicle Management's look, in one place.
 *
 * The module used to lead every page with emerald/teal gradients and a row of separate KPI cards
 * above the register. It now sits on grey-and-white surfaces and carries a page's counts in the
 * header's `meta` line or one `VmStatStrip`, so the register is the first thing on the page.
 *
 * Colour stays, in three jobs only: the user's accent (their Appearance choice — the same one the
 * app's tab pill and phone header use) marks what is chosen or primary; each section keeps its own
 * icon colour so it can be found at a glance; and status (expired, due soon, valid) keeps its
 * rose/amber/emerald. An all-slate first pass read as black and white. Pages import these instead
 * of restating classes, so the look cannot drift from page to page.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The user's accent as a fill, with the ink that reads on it. Follows light, dark and every Appearance choice. */
export const VM_ACCENT_FILL = 'bg-[image:var(--sel-tab-gradient)] text-[color:var(--sel-tab-on)]';

/** The page's main action (Add, Save, Renew), in the accent. */
export const VM_PRIMARY_BUTTON = cn(VM_ACCENT_FILL, 'shadow-[0_6px_16px_-8px_var(--sel-tab-glow)] hover:brightness-110');

/** A segmented control's track (Active / History, All / Expired / Due soon). */
export const VM_SEGMENT_TRACK = 'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1';

/** One item in a `VM_SEGMENT_TRACK`; the chosen one wears the accent, like the app's tab pill. */
export function vmSegmentItem(active: boolean) {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
    active ? cn(VM_ACCENT_FILL, 'shadow-sm') : 'text-slate-500 hover:bg-white hover:text-slate-800',
  );
}

/** The icon tile at the head of a form or dialog, in the accent. */
export const VM_ICON_CHIP = cn(VM_ACCENT_FILL, 'shadow-sm');

export type VmTone =
  | 'slate'
  | 'emerald'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'pink'
  | 'rose'
  | 'red'
  | 'orange'
  | 'amber';

/**
 * A section's own colour: `chip` is a tinted icon tile (sidebar rows, report and settings cards),
 * `text` colours a bare icon. Literal class names, so Tailwind generates them.
 */
export const VM_TONES: Record<VmTone, { chip: string; text: string }> = {
  slate: { chip: 'bg-slate-100 text-slate-600 ring-slate-200', text: 'text-slate-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600 ring-emerald-100', text: 'text-emerald-600' },
  green: { chip: 'bg-green-50 text-green-600 ring-green-100', text: 'text-green-600' },
  teal: { chip: 'bg-teal-50 text-teal-600 ring-teal-100', text: 'text-teal-600' },
  cyan: { chip: 'bg-cyan-50 text-cyan-600 ring-cyan-100', text: 'text-cyan-600' },
  sky: { chip: 'bg-sky-50 text-sky-600 ring-sky-100', text: 'text-sky-600' },
  blue: { chip: 'bg-blue-50 text-blue-600 ring-blue-100', text: 'text-blue-600' },
  indigo: { chip: 'bg-indigo-50 text-indigo-600 ring-indigo-100', text: 'text-indigo-600' },
  violet: { chip: 'bg-violet-50 text-violet-600 ring-violet-100', text: 'text-violet-600' },
  fuchsia: { chip: 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-100', text: 'text-fuchsia-600' },
  pink: { chip: 'bg-pink-50 text-pink-600 ring-pink-100', text: 'text-pink-600' },
  rose: { chip: 'bg-rose-50 text-rose-600 ring-rose-100', text: 'text-rose-600' },
  red: { chip: 'bg-red-50 text-red-600 ring-red-100', text: 'text-red-600' },
  orange: { chip: 'bg-orange-50 text-orange-600 ring-orange-100', text: 'text-orange-600' },
  amber: { chip: 'bg-amber-50 text-amber-600 ring-amber-100', text: 'text-amber-600' },
};

/** A tinted icon tile in a section's colour. */
export function vmToneChip(tone: VmTone) {
  return cn('ring-1 ring-inset', VM_TONES[tone].chip);
}

/** A dialog's header band: plain, with a hairline under it, where it used to be a tinted gradient. */
export const VM_DIALOG_HEADER = 'border-b border-slate-200 bg-slate-50';

export type VmStatTone = 'default' | 'danger' | 'warning' | 'success' | 'muted';

const STAT_TONE: Record<VmStatTone, string> = {
  default: 'text-slate-900',
  danger: 'text-rose-600',
  warning: 'text-amber-600',
  success: 'text-emerald-600',
  muted: 'text-slate-500',
};

export interface VmStat {
  label: string;
  value: ReactNode;
  /** Colour for the value only — status, never decoration. */
  tone?: VmStatTone;
  /** A muted line under the value ("across 12 vehicles"). */
  hint?: ReactNode;
}

// Literal class names, so Tailwind generates them.
const DESKTOP_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
  6: 'sm:grid-cols-6',
};

/**
 * A page's figures in one bordered strip, divided by hairlines — replaces a row of separate KPI
 * cards. Two to a row on a phone (three when there are exactly three), all on one row from `sm`.
 */
export function VmStatStrip({ stats, className }: { stats: VmStat[]; className?: string }) {
  if (stats.length === 0) return null;
  const phoneCols = stats.length === 3 ? 'grid-cols-3' : stats.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <dl
      className={cn(
        // `gap-px` over a slate fill draws the dividers, and they stay right when the grid wraps.
        'grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200',
        phoneCols,
        DESKTOP_COLS[Math.min(stats.length, 6)],
        // An odd last cell on a two-column phone grid spans the row instead of leaving a grey hole.
        stats.length !== 3 && '[&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1',
        className,
      )}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 bg-white px-3 py-2 sm:px-4">
          <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">{stat.label}</dt>
          <dd className={cn('mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg', STAT_TONE[stat.tone ?? 'default'])}>{stat.value}</dd>
          {stat.hint && <dd className="truncate text-[11px] text-slate-500">{stat.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
