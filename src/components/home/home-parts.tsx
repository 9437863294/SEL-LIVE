'use client';

/** Small pieces the Command and Launchpad home designs share. */

import Link from 'next/link';
import { Star } from 'lucide-react';
import type { ModuleCategory } from '@/components/module-hub/module-catalog';
import type { WorkUrgency } from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import type { HomeModule } from './home-data';

/**
 * One colour per category, for the Command design's icon tiles and section dots. Solid 600-weight
 * fills with white glyphs read the same on the light and the dark theme, so no `dark:` pair is needed.
 */
export const CATEGORY_TONE: Record<ModuleCategory, { tile: string; dot: string }> = {
  'Finance & Treasury': { tile: 'bg-blue-600', dot: 'bg-blue-600' },
  'Projects & Sites': { tile: 'bg-orange-500', dot: 'bg-orange-500' },
  'Procurement & Stores': { tile: 'bg-teal-600', dot: 'bg-teal-600' },
  'People & HR': { tile: 'bg-violet-600', dot: 'bg-violet-600' },
  'Fleet & Logistics': { tile: 'bg-sky-600', dot: 'bg-sky-600' },
  'Workspace & Communication': { tile: 'bg-slate-600', dot: 'bg-slate-500' },
  Administration: { tile: 'bg-zinc-600', dot: 'bg-zinc-500' },
  Other: { tile: 'bg-slate-500', dot: 'bg-slate-400' },
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
