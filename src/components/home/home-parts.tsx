'use client';

/** Small pieces the Command and Launchpad home designs share. */

import Link from 'next/link';
import { Star } from 'lucide-react';
import type { GroupColor } from '@/lib/appearance/model';
import type { WorkUrgency } from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import type { HomeModule } from './home-data';

/**
 * Classes per module-group colour, for the Command design's icon tiles and section dots and the
 * group editor's swatches. Solid fills with white glyphs read the same on the light and the dark
 * theme, so no `dark:` pair is needed. Written out in full so Tailwind generates every one.
 */
export const GROUP_TONE: Record<GroupColor, { tile: string; dot: string; label: string }> = {
  blue: { tile: 'bg-blue-600', dot: 'bg-blue-600', label: 'Blue' },
  orange: { tile: 'bg-orange-500', dot: 'bg-orange-500', label: 'Orange' },
  teal: { tile: 'bg-teal-600', dot: 'bg-teal-600', label: 'Teal' },
  violet: { tile: 'bg-violet-600', dot: 'bg-violet-600', label: 'Violet' },
  sky: { tile: 'bg-sky-600', dot: 'bg-sky-600', label: 'Sky' },
  emerald: { tile: 'bg-emerald-600', dot: 'bg-emerald-600', label: 'Green' },
  rose: { tile: 'bg-rose-600', dot: 'bg-rose-600', label: 'Rose' },
  amber: { tile: 'bg-amber-500', dot: 'bg-amber-500', label: 'Amber' },
  indigo: { tile: 'bg-indigo-600', dot: 'bg-indigo-600', label: 'Indigo' },
  pink: { tile: 'bg-pink-600', dot: 'bg-pink-600', label: 'Pink' },
  slate: { tile: 'bg-slate-600', dot: 'bg-slate-500', label: 'Slate' },
  zinc: { tile: 'bg-zinc-600', dot: 'bg-zinc-500', label: 'Grey' },
};

/** Text colour for a deadline note, as light/dark pairs (the `--chart-*` tokens are dark-only). */
export const URGENCY_TEXT: Record<WorkUrgency, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-amber-700 dark:text-amber-300',
  soon: 'text-blue-700 dark:text-blue-300',
  later: 'text-muted-foreground',
  undated: 'text-muted-foreground',
};

/**
 * The star that adds a module to Favourites. Always visible on a phone, where there is no hover;
 * from `sm` up it shows on hover or focus, and stays visible on a module already starred.
 *
 * It sits above the card's stretched link (`relative z-10`), so pressing it never opens the module.
 */
export function FavouriteButton({
  module,
  onToggle,
  className,
}: {
  module: HomeModule;
  onToggle: (name: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      // One fixed name, with `aria-pressed` carrying the state.
      aria-label={`Favourite ${module.label}`}
      aria-pressed={module.favourite}
      title={module.favourite ? 'Remove from favourites' : 'Add to favourites'}
      onClick={() => onToggle(module.name)}
      className={cn(
        'relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        module.favourite ? 'text-amber-500 hover:text-amber-600' : 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
        className,
      )}
    >
      <Star className={cn('h-4 w-4', module.favourite && 'fill-current')} aria-hidden="true" />
    </button>
  );
}

/**
 * The whole card opens the module through one link stretched over it — the same pattern as the
 * Classic launcher's `ModuleCard`, so buttons on the card are siblings of the link, not inside it.
 */
export function StretchedLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="absolute inset-0 rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="sr-only">Open {label}</span>
    </Link>
  );
}
