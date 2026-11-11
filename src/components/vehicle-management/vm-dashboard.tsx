'use client';

/**
 * The dashboard look shared by the module's Overview and Renewals Hub.
 *
 * Flat cards on the theme's surface, a header card with an alert strip under it, section labels
 * that run a hairline to the edge, and soft tinted icon tiles. Neutrals come from theme tokens and
 * every tint carries its own `dark:` pair, so both themes work without the generated dark-compat
 * layer. The accent (`--sel-tab-*`) still marks the page's own icon and whatever is selected.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VM_ICON_CHIP, type VmTone } from './vm-ui';

/** Every panel on a dashboard page. */
export const VM_PANEL = 'rounded-2xl border border-border bg-card text-card-foreground shadow-sm';

/** What a selected card or tile wears: a ring in the user's accent. */
export const VM_SELECTED_RING = 'shadow-[0_0_0_2px_var(--sel-tab-glow)]';

/**
 * A soft tint with the ink that reads on it, in both themes — for icon tiles, count pills and
 * status chips. Keyed by the module's section tones, so a category wears its sidebar colour.
 * Literal class names, so Tailwind generates them.
 */
export const VM_TINT: Record<VmTone, string> = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  green: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  fuchsia: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
  pink: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

/** Status ink for a bare number or label (an expired count, a compliance %). */
export const VM_STATUS_INK = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
} as const;

/** An uppercase section label with a hairline running to the edge. */
export function VmSectionLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="flex items-center gap-2 px-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground after:h-px after:flex-1 after:bg-border after:content-['']"
    >
      {children}
    </h2>
  );
}

/** A tinted icon tile: `sm` heads a card's label, `lg` leads a metric card. */
export function VmIconTile({ icon: Icon, tint, size = 'sm', className }: { icon: LucideIcon; tint: VmTone; size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center',
        VM_TINT[tint],
        size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-xl sm:h-[42px] sm:w-[42px]',
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
    </span>
  );
}

/** One cell of the alert strip: a link to where it is handled, or a filter the page applies. */
export type VmAlertTile = {
  key: string;
  count: ReactNode;
  title: string;
  hint: string;
  tint: VmTone;
  href?: string;
  onSelect?: () => void;
  selected?: boolean;
};

const ALERT_GRID_SM: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' };

function AlertTileView({ tile }: { tile: VmAlertTile }) {
  const body = (
    <>
      <span className={cn('grid h-9 min-w-[2.25rem] shrink-0 place-items-center rounded-[10px] px-1.5 text-sm font-extrabold tabular-nums', VM_TINT[tile.tint])}>
        {tile.count}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-foreground">{tile.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{tile.hint}</span>
      </span>
      {tile.href && <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />}
      {/* A chosen filter is underlined in the accent, like the app's tab pill. */}
      {tile.selected && <span className="absolute inset-x-0 bottom-0 h-[3px] bg-[image:var(--sel-tab-gradient)]" aria-hidden />}
    </>
  );
  const layout = cn(
    'group relative flex min-w-0 items-center gap-3 px-4 py-3 text-left sm:px-5',
    (tile.href || tile.onSelect) && 'transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
    tile.selected && 'bg-muted/50',
  );
  if (tile.href) {
    return (
      <Link href={tile.href} className={cn(layout, 'no-underline')}>
        {body}
      </Link>
    );
  }
  if (tile.onSelect) {
    return (
      <button type="button" onClick={tile.onSelect} aria-pressed={tile.selected ?? false} className={cn(layout, 'w-full')}>
        {body}
      </button>
    );
  }
  return <div className={layout}>{body}</div>;
}

/** The strip of what needs doing, under the header card's title row. */
export function VmAlertStrip({ tiles }: { tiles: VmAlertTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className={cn('grid divide-y divide-border border-t border-border sm:divide-x sm:divide-y-0', ALERT_GRID_SM[Math.min(tiles.length, 4)])}>
      {tiles.map((tile) => (
        <AlertTileView key={tile.key} tile={tile} />
      ))}
    </div>
  );
}

/** "Updated 11:23", with a dot: green when every source answered, amber when some did not. */
export function VmSyncStatus({ isLoading, partial, updatedAt }: { isLoading: boolean; partial: boolean; updatedAt: Date | null }) {
  const time = updatedAt?.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <i
        className={cn(
          'h-[7px] w-[7px] shrink-0 rounded-full ring-[3px]',
          isLoading ? 'bg-slate-400 ring-slate-400/20' : partial ? 'bg-amber-500 ring-amber-500/20' : 'bg-emerald-500 ring-emerald-500/20',
        )}
      />
      {isLoading ? (
        'Loading…'
      ) : partial ? (
        <span className="text-amber-700 dark:text-amber-400">Partial data · retry refresh</span>
      ) : (
        time && `Updated ${time}`
      )}
    </span>
  );
}

/**
 * The page's header card: the page icon in the accent, title and purpose, sync status and actions
 * on the right, and the alert strip (`children`) across the bottom.
 */
export function VmPageHero({
  icon: Icon,
  title,
  description,
  status,
  actions,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={cn(VM_PANEL, 'overflow-hidden')}>
      <div className="flex flex-wrap items-center gap-3.5 px-4 py-4 sm:px-5">
        <span className={cn(VM_ICON_CHIP, 'grid h-11 w-11 shrink-0 place-items-center rounded-xl sm:h-[46px] sm:w-[46px]')}>
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-60">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-[22px]">{title}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {(status || actions) && (
          <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:ml-auto sm:w-auto sm:justify-end">
            {status}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}
