'use client';

/**
 * The "Launchpad" and "Aurora Glass" home designs — one layout, two skins: a greeting with a module
 * search and three work figures, chips for the company's module groups, a row of favourite cards, then every module as a
 * tile.
 *
 * - Launchpad: a teal gradient greeting band with white text on it; the search field on it is
 *   `keep-light` so it stays a white field in dark mode too.
 * - Aurora Glass, after the "SEL Launchpad Variations" reference: frosted white cards over three
 *   pastel radial glows (teal, indigo, pink), a gradient eyebrow and greeting, figures with a 4px
 *   gradient top edge, gradient active chip, and tiles that lift on hover with a shadow in their
 *   icon's own colour. In dark mode the glows drop to a faint tint and the cards use the theme's card
 *   colour, so it still reads.
 *
 * Every icon casts a soft shadow in its own colour, with a thin inner highlight — in both skins.
 */

import Link from 'next/link';
import { useDeferredValue, useId, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkDashboardState } from '@/components/work-dashboard/hooks';
import { cn } from '@/lib/utils';
import { greeting, longDate, useHomeData, type HomeData, type HomeModule } from './home-data';
import { FavouriteButton, StretchedLink } from './home-parts';

export type LaunchpadSkin = 'launchpad' | 'aurora';

/**
 * Aurora's frosted surface. No backdrop blur on the cards: they sit over smooth radial glows, which
 * blur leaves unchanged, and blurring behind thirty-odd tiles is real GPU work on the older office
 * PCs. The greeting card, the one large surface, does carry it.
 */
const glass =
  'border border-white/80 bg-white/55 shadow-[0_10px_30px_-18px_rgba(15,23,42,0.25)] dark:border-white/10 dark:bg-card/60';

/** A module's accent as CSS variables: 60% for the icon's shadow, 70% for a tile's hover shadow. */
const accentVars = (module: HomeModule) =>
  ({ '--accent-60': `${module.accent}99`, '--accent-70': `${module.accent}b3` }) as CSSProperties;

export default function LaunchpadHome({ work }: { work: WorkDashboardState }) {
  return <LaunchpadView data={useHomeData(work)} skin="launchpad" />;
}

export function AuroraHome({ work }: { work: WorkDashboardState }) {
  return <LaunchpadView data={useHomeData(work)} skin="aurora" />;
}

/** The design drawn from data alone, so it renders without the work fan-out behind it. */
export function LaunchpadView({ data, skin = 'launchpad' }: { data: HomeData; skin?: LaunchpadSkin }) {
  const aurora = skin === 'aurora';
  const [query, setQuery] = useState('');
  // A group id, or 'all'. A chip whose group has since emptied falls back to everything.
  const [picked, setCategory] = useState<string>('all');
  const category = picked === 'all' || data.categories.some((entry) => entry.group.id === picked) ? picked : 'all';
  const deferredQuery = useDeferredValue(query);

  const shown = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return data.modules.filter(
      (module) =>
        (category === 'all' || module.group.id === category) &&
        (!needle || [module.label, module.name, module.description, module.group.label].some((text) => text.toLowerCase().includes(needle))),
    );
  }, [data.modules, category, deferredQuery]);

  return (
    // A <div>, not <main>: it is the Modules tab of the home page, which owns the one <main>.
    <div className={cn('relative isolate w-full px-3 pb-10 sm:px-4 md:px-6', aurora ? 'space-y-5 pt-3' : 'space-y-6 pt-1')}>
      {aurora ? <AuroraGlow /> : null}
      <Hero data={data} query={query} onQuery={setQuery} aurora={aurora} />

      <div
        role="group"
        aria-label="Show group"
        className={cn('flex min-w-0 gap-2 overflow-x-auto pb-1', aurora && 'pt-1 sm:flex-wrap sm:overflow-visible')}
      >
        {[{ id: 'all', label: 'All' }, ...data.categories.map((entry) => entry.group)].map(({ id: value, label }) => {
          const count = value === 'all' ? data.modules.length : data.categories.find((entry) => entry.group.id === value)?.modules.length ?? 0;
          const active = category === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(value)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                aurora ? 'px-3.5 py-[7px] text-[13px] font-semibold' : 'px-3 py-1.5 text-xs font-medium',
                active
                  ? aurora
                    ? 'border-transparent bg-gradient-to-r from-teal-700 to-indigo-600 text-white'
                    : 'border-foreground bg-foreground text-background'
                  : aurora
                    ? 'border-white bg-white/60 text-slate-600 backdrop-blur hover:bg-white/85 dark:border-white/10 dark:bg-card/60 dark:text-slate-300 dark:hover:bg-card/90'
                    : 'bg-card text-foreground hover:bg-muted',
              )}
            >
              {label}
              <span className={cn('ml-1.5 tabular-nums', aurora ? 'opacity-50' : active ? 'opacity-80' : 'text-muted-foreground')}>{count}</span>
            </button>
          );
        })}
      </div>

      <Favourites data={data} aurora={aurora} />

      <section aria-labelledby="launchpad-all" className="space-y-3">
        <h2 id="launchpad-all" className={cn(aurora ? 'text-[15px] font-bold' : 'text-sm font-semibold')}>
          All modules <span className="text-[12.5px] font-semibold text-muted-foreground">· {shown.length}</span>
        </h2>
        {data.loading ? (
          <div className={tileGrid(aurora)}>
            {Array.from({ length: 12 }).map((_, key) => (
              <Skeleton key={key} className={cn('h-40', aurora ? 'rounded-[20px]' : 'rounded-xl')} />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {deferredQuery.trim() ? `No module matches “${deferredQuery.trim()}”.` : 'No modules in this group.'}
          </p>
        ) : (
          <div className={tileGrid(aurora)}>
            {shown.map((module) => (
              <ModuleTileCard key={module.name} module={module} onToggle={data.toggleFavourite} aurora={aurora} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Aurora fills each row with as many ~176px tiles as fit, like the reference; two on a phone. */
const tileGrid = (aurora: boolean) =>
  aurora
    ? 'grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))] sm:gap-3.5'
    : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8';

/**
 * Aurora's backdrop: the reference's three radial glows. It starts above the panel, behind the
 * page's tab strip (which sits on its own layer for that), so the glow reads as the page's, not a
 * box under the tabs. Decorative, never clickable.
 */
function AuroraGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10">
      <div
        className="absolute inset-0 dark:hidden"
        style={{
          backgroundColor: '#f5f7fb',
          backgroundImage:
            'radial-gradient(700px 500px at 8% 0%, #99f6e4 0%, transparent 60%), radial-gradient(600px 500px at 95% 10%, #c7d2fe 0%, transparent 60%), radial-gradient(700px 600px at 60% 100%, #fbcfe8 0%, transparent 60%)',
        }}
      />
      <div
        className="absolute inset-0 hidden dark:block"
        style={{
          backgroundImage:
            'radial-gradient(700px 500px at 8% 0%, rgba(20,184,166,0.16) 0%, transparent 60%), radial-gradient(600px 500px at 95% 10%, rgba(99,102,241,0.16) 0%, transparent 60%), radial-gradient(700px 600px at 60% 100%, rgba(236,72,153,0.10) 0%, transparent 60%)',
        }}
      />
    </div>
  );
}

/** The 4px gradient top edge of each Aurora figure, in order (blue, orange, pink — as the reference). */
const AURORA_EDGES = ['from-blue-400 to-blue-700', 'from-orange-300 to-orange-600', 'from-pink-400 to-rose-600'];

function Hero({ data, query, onQuery, aurora }: { data: HomeData; query: string; onQuery: (value: string) => void; aurora: boolean }) {
  const searchId = useId();
  const figures = [
    { label: 'Needs you', value: data.summary.action, note: data.summary.modules === 1 ? 'in 1 module' : `across ${data.summary.modules} modules` },
    { label: 'Overdue', value: data.summary.overdue, note: 'past their deadline' },
    { label: 'Meetings today', value: data.meetingsToday.length, note: 'in Office Hub' },
  ];

  return (
    <section
      className={cn(
        'flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between',
        aurora
          ? cn(glass, 'rounded-3xl p-5 backdrop-blur-[16px] sm:px-8 sm:py-[30px]')
          : 'rounded-2xl bg-gradient-to-br from-teal-800 via-teal-700 to-emerald-600 p-5 text-white shadow-sm sm:p-7',
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-xs font-bold uppercase',
            aurora
              ? 'w-fit bg-gradient-to-r from-teal-600 to-indigo-500 bg-clip-text tracking-[0.08em] text-transparent dark:from-teal-300 dark:to-indigo-300'
              : 'font-semibold tracking-wider text-white/75',
          )}
        >
          {longDate()}
        </p>
        <h1 className={cn('mt-1.5', aurora ? 'text-2xl font-extrabold tracking-[-0.025em] sm:text-[32px] sm:leading-tight' : 'text-2xl font-bold tracking-tight sm:text-3xl')}>
          {aurora ? (
            <span className="bg-gradient-to-r from-teal-700 via-indigo-600 via-60% to-pink-600 bg-clip-text text-transparent dark:from-teal-300 dark:via-indigo-300 dark:to-pink-300">
              {greeting()}
            </span>
          ) : (
            greeting()
          )}
          , {data.firstName}
        </h1>
        <p className={cn('mt-1', aurora ? 'text-[13.5px] text-slate-600 dark:text-slate-300' : 'mt-1.5 text-sm text-white/85')}>
          {data.workLoading || data.summary.action === 0 ? (
            data.summaryLine
          ) : (
            <>
              You have{' '}
              <strong className={cn(aurora ? 'font-bold text-foreground' : 'font-semibold text-white')}>
                {data.summary.action === 1 ? '1 item' : `${data.summary.action} items`}
              </strong>{' '}
              waiting for you across {data.summary.modules === 1 ? '1 module' : `${data.summary.modules} modules`}.
            </>
          )}
        </p>
        <div className={cn('relative', aurora ? 'mt-[18px] max-w-[540px]' : 'keep-light mt-4 max-w-md')}>
          <label htmlFor={searchId} className="sr-only">
            Search modules
          </label>
          <Search
            className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-400', aurora ? 'left-4 h-5 w-5' : 'left-3 h-4 w-4')}
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={data.loading ? 'Search modules…' : `Search ${data.modules.length} modules…`}
            className={cn(
              'w-full focus-visible:outline-none focus-visible:ring-2',
              aurora
                ? 'h-[50px] rounded-[14px] border-0 bg-white pl-12 pr-4 text-sm text-slate-900 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.19)] placeholder:text-slate-400 focus-visible:ring-indigo-300 dark:bg-card dark:text-foreground'
                : 'h-10 rounded-lg border-0 bg-white pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:ring-white/70',
            )}
          />
        </div>
      </div>

      <div className={cn('grid grid-cols-3 lg:shrink-0', aurora ? 'gap-2 sm:gap-3 lg:w-[36rem]' : 'gap-2 sm:gap-3 lg:w-[30rem]')}>
        {figures.map((figure, index) => (
          <Link
            key={figure.label}
            href="/my-work"
            className={cn(
              'relative min-w-0 overflow-hidden transition focus-visible:outline-none focus-visible:ring-2',
              aurora
                ? 'rounded-[18px] bg-white p-3 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-ring sm:p-4 dark:bg-card'
                : 'rounded-xl border border-white/25 bg-white/15 p-3 hover:bg-white/20 focus-visible:ring-white',
            )}
          >
            {aurora ? <span aria-hidden="true" className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', AURORA_EDGES[index])} /> : null}
            {/* Wrapping, not truncated: a third of a phone is too narrow for "Meetings today" on one line. */}
            <span className={cn('block text-[11.5px] font-semibold leading-tight', aurora ? 'text-slate-400' : 'font-medium text-white/80')}>{figure.label}</span>
            <span className={cn('my-0.5 block tabular-nums', aurora ? 'text-lg font-extrabold tracking-[-0.02em] sm:text-2xl' : 'mt-1 text-2xl font-bold')}>
              {data.workLoading ? '–' : figure.value}
            </span>
            <span className={cn('block text-xs leading-tight', aurora ? 'text-slate-600 dark:text-slate-300' : 'text-[11px] text-white/75')}>{figure.note}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * A module's gradient icon with its pending count. Casts a soft shadow in its own colour with a thin
 * inner highlight, as the reference's app icons do.
 */
function GradientIcon({ module, className }: { module: HomeModule; className?: string }) {
  const { Icon } = module;
  return (
    // `pointer-events-none`: the icon is `relative` (for its badge), which lifts it above a card's
    // stretched link — without this a click on the icon landed on the icon and opened nothing.
    <span
      aria-hidden="true"
      style={accentVars(module)}
      className={cn(
        'pointer-events-none relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-[0_6px_14px_-4px_var(--accent-60),inset_0_1px_0_rgba(255,255,255,0.27)]',
        module.gradient,
        className,
      )}
    >
      <Icon className="h-[46%] w-[46%]" />
      {module.pending > 0 ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-rose-600 px-1.5 text-[11px] font-bold tabular-nums text-white dark:border-card">
          {module.pending > 99 ? '99+' : module.pending}
        </span>
      ) : null}
    </span>
  );
}

function Favourites({ data, aurora }: { data: HomeData; aurora: boolean }) {
  if (data.loading) return null;
  return (
    <section aria-labelledby="launchpad-favourites" className="space-y-3">
      <h2 id="launchpad-favourites" className={cn(aurora ? 'text-[15px] font-bold' : 'text-sm font-semibold')}>
        Favourites <span className="text-[12.5px] font-normal text-muted-foreground">· click ★ on any module to add</span>
      </h2>
      {data.favourites.length === 0 ? null : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6">
          {data.favourites.map((module) => (
            <Link
              key={module.name}
              href={module.href}
              style={accentVars(module)}
              className={cn(
                'group flex items-center gap-3 p-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                aurora
                  ? cn(glass, 'rounded-2xl duration-200 hover:-translate-y-0.5 hover:bg-white/85 hover:shadow-[0_14px_28px_-16px_var(--accent-70)] dark:hover:bg-card/90')
                  : 'rounded-xl border bg-card shadow-sm hover:border-primary/40 hover:shadow-md',
              )}
            >
              <GradientIcon module={module} className="h-10 w-10 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{module.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {module.pending > 0 ? `${module.pending} pending` : 'Open module'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function ModuleTileCard({ module, onToggle, aurora }: { module: HomeModule; onToggle: (name: string) => void; aurora: boolean }) {
  return (
    <div
      style={accentVars(module)}
      className={cn(
        'group relative flex flex-col items-center text-center transition',
        aurora
          ? cn(glass, 'rounded-[20px] px-3.5 pb-[18px] pt-[22px] duration-200 hover:-translate-y-1 hover:bg-white/85 hover:shadow-[0_20px_34px_-18px_var(--accent-70)] dark:hover:bg-card/90')
          : 'rounded-xl border bg-card px-3 pb-4 pt-5 shadow-sm hover:border-primary/40 hover:shadow-md',
      )}
    >
      <StretchedLink href={module.href} label={module.label} />
      <FavouriteButton module={module} onToggle={onToggle} className="absolute right-1.5 top-1.5" />
      <GradientIcon module={module} className={aurora ? 'h-[52px] w-[52px] rounded-[16px]' : 'h-12 w-12 rounded-xl'} />
      <p className={cn('line-clamp-2 font-bold leading-snug', aurora ? 'mt-3 text-[13.5px]' : 'mt-3 text-sm font-semibold')}>{module.label}</p>
      <p className={cn('mt-1 line-clamp-2 text-xs leading-[1.4]', aurora ? 'text-slate-400 dark:text-slate-500' : 'text-muted-foreground')}>{module.description}</p>
    </div>
  );
}
