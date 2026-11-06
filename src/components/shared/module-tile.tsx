'use client';

/**
 * The module tile, for the section links on a module's landing page: the "All modules" tile of the
 * home page (Aurora Glass) — a white rounded card, a gradient icon in the middle that casts a shadow
 * in its own colour, a bold title and a two-line description. Under the mouse it lifts, glows in its
 * own colour and runs a border round itself, as the home page's tiles do (module-tile.module.css).
 *
 * Defined once so every module's landing page reads as the same application as the home page.
 * Project Management's `PmNavCard` draws through it.
 *
 * - `disabled` dims the tile and drops its link rather than hiding it, so the grid keeps one shape
 *   whoever is looking.
 * - `variant: 'action'` is a dashed tile, for "create something" next to the places to go.
 */

import Link from 'next/link';
import { useEffect, useRef, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { gradientAccent } from '@/lib/gradient-accent';
import { cn } from '@/lib/utils';
import styles from './module-tile.module.css';

export type ModuleTileItem = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  /** `bg-gradient-to-br` stops, e.g. `"from-sky-500 to-blue-600"`. Slate when left out. */
  gradient?: string;
  /** A count on the icon's corner, e.g. items waiting. Nothing is shown at 0. */
  badge?: number;
  /** Dimmed and unclickable rather than hidden, so the grid keeps one shape across users. */
  disabled?: boolean;
  /** The tooltip on a disabled tile. */
  disabledReason?: string;
  variant?: 'default' | 'action';
};

/**
 * Accents to cycle through on a page whose tiles have no colour of their own, so neighbouring tiles
 * stay tellable apart. Written out in full so Tailwind generates every class.
 */
export const MODULE_TILE_GRADIENTS = [
  'from-sky-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
  'from-indigo-500 to-violet-600',
  'from-fuchsia-500 to-pink-600',
] as const;

export const moduleTileGradient = (index: number): string =>
  MODULE_TILE_GRADIENTS[((index % MODULE_TILE_GRADIENTS.length) + MODULE_TILE_GRADIENTS.length) % MODULE_TILE_GRADIENTS.length];

const SLATE = 'from-slate-500 to-slate-700';

/** The tile's accent as CSS variables: 60% for the icon's shadow, 70% for the hover shadow, 30% for the glow. */
function accentVars(gradient: string): CSSProperties {
  const accent = gradientAccent(gradient);
  return {
    '--accent-60': `${accent}99`,
    '--accent-70': `${accent}b3`,
    '--accent-30': `${accent}4d`,
    '--accent-solid': accent,
  } as CSSProperties;
}

export function ModuleTile({ item }: { item: ModuleTileItem }) {
  const { icon: Icon } = item;
  const disabled = item.disabled || item.href === '#';
  const gradient = item.gradient ?? SLATE;
  const action = item.variant === 'action';
  const badge = item.badge ?? 0;

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-br text-white shadow-[0_6px_14px_-4px_var(--accent-60),inset_0_1px_0_rgba(255,255,255,0.27)] transition-transform duration-200',
          !disabled && 'group-hover:scale-105',
          gradient,
        )}
      >
        <Icon className="h-6 w-6" />
        {badge > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white dark:border-card">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </span>
      <span className="mt-3 line-clamp-2 text-[13.5px] font-bold leading-snug text-foreground">{item.title}</span>
      <span className="mt-1 line-clamp-2 text-xs leading-[1.4] text-slate-500 dark:text-slate-400">{item.description}</span>
      {badge > 0 ? <span className="sr-only">, {badge} waiting</span> : null}
    </>
  );

  const className = cn(
    'group relative flex h-full min-w-0 flex-col items-center rounded-[20px] border px-3.5 pb-[18px] pt-[22px] text-center transition duration-200',
    action
      ? 'border-dashed border-slate-300 bg-white/60 dark:border-white/15 dark:bg-card/40'
      : 'border-slate-200/70 bg-white shadow-[0_10px_30px_-18px_rgba(15,23,42,0.25)] dark:border-white/10 dark:bg-card',
    disabled
      ? 'cursor-not-allowed opacity-60'
      : cn(
          styles.tile,
          'hover:-translate-y-1 hover:shadow-[0_20px_34px_-18px_var(--accent-70)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        ),
  );

  if (disabled) {
    return (
      <div
        aria-disabled="true"
        title={item.disabledReason ?? 'You do not have permission for this'}
        style={accentVars(gradient)}
        className={className}
      >
        {body}
      </div>
    );
  }

  return (
    <Link href={item.href} data-module-tile="" style={accentVars(gradient)} className={className}>
      {body}
    </Link>
  );
}

/**
 * The grid the tiles sit in: as many ~176px tiles as fit in a row, like the home page; two on a
 * phone. It also tells the tile under the mouse where the mouse is (`--x`/`--y`, for the glow),
 * written straight to the tile's style once a frame at most, never through React state. Nothing is
 * tracked for touch, which has no hover to follow.
 */
export function ModuleTileGrid({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    let frame = 0;
    let latest: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const event = latest;
      if (!event) return;
      const tile = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-module-tile]') : null;
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty('--x', `${event.clientX - box.left}px`);
      tile.style.setProperty('--y', `${event.clientY - box.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      latest = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    area.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      area.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn('grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] sm:gap-3.5', className)}
    >
      {children}
    </div>
  );
}

/** Tile-shaped placeholders while a landing page loads. */
export function ModuleTileSkeletons({ count = 4 }: { count?: number }) {
  return (
    <ModuleTileGrid>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-40 rounded-[20px]" />
      ))}
    </ModuleTileGrid>
  );
}
