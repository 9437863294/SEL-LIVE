'use client';

/**
 * The "Command" home design: a welcome band with today's meetings, the modules holding work for
 * you, a row of favourites, then every module under the company's module groups.
 *
 * The band is a fixed navy in both themes (a little lighter in dark mode so it still separates from
 * the page), and the work tiles overlap its lower edge. Everything else is on the theme's own
 * card and text tokens, so it follows light, dark and the company's accent like the rest of the app.
 */

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { WorkDashboardState } from '@/components/work-dashboard/hooks';
import { cn } from '@/lib/utils';
import { longDate, useHomeData, type HomeData, type HomeModule } from './home-data';
import { GROUP_TONE, FavouriteButton, StretchedLink, URGENCY_TEXT } from './home-parts';

const shell = 'w-full px-4 sm:px-6 lg:px-8';

export default function CommandHome({ work }: { work: WorkDashboardState }) {
  return <CommandView data={useHomeData(work)} />;
}

/** The design drawn from data alone, so it renders without the work fan-out behind it. */
export function CommandView({ data }: { data: HomeData }) {
  return (
    // A <div>, not <main>: it is the Modules tab of the home page, which owns the one <main>.
    <div className="pb-10">
      <section className="bg-[#0f1f3d] text-white dark:bg-[#18315c]">
        <div className={cn(shell, 'flex flex-col gap-6 pb-24 pt-8 lg:flex-row lg:items-start lg:justify-between')}>
          <div className="min-w-0 max-w-2xl">
            <p className="text-sm font-medium text-white/70">{longDate()}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back, {data.firstName}</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">{data.summaryLine}</p>
          </div>
          <TodayPanel data={data} />
        </div>
      </section>

      <div className={cn(shell, 'space-y-10')}>
        <WorkTiles data={data} />
        <Favourites data={data} />
        <AllModules data={data} />
      </div>
    </div>
  );
}

function TodayPanel({ data }: { data: HomeData }) {
  return (
    <div className="w-full shrink-0 rounded-xl border border-white/15 bg-white/10 p-4 lg:w-[22rem]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Today</h2>
        <Link href="/office-hub" className="rounded text-xs text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          Office Hub
        </Link>
      </div>
      {data.workLoading ? (
        <div className="mt-3 space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-white/15" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/15" />
        </div>
      ) : data.meetingsToday.length === 0 ? (
        <p className="mt-3 text-sm text-white/70">No meetings today.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {data.meetingsToday.slice(0, 3).map((meeting) => (
            <li key={meeting.id}>
              <Link href={meeting.href} className="group flex gap-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <span className="w-11 shrink-0 text-sm font-semibold tabular-nums">{meeting.time}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:underline">{meeting.title}</span>
                  {meeting.detail ? <span className="block truncate text-xs text-white/65">{meeting.detail}</span> : null}
                </span>
              </Link>
            </li>
          ))}
          {data.meetingsToday.length > 3 ? (
            <li className="text-xs text-white/65">and {data.meetingsToday.length - 3} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function WorkTiles({ data }: { data: HomeData }) {
  if (data.workLoading || data.loading) {
    return (
      <div className="relative -mt-16 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-32 rounded-xl sm:h-36" />
        ))}
      </div>
    );
  }

  if (data.workTiles.length === 0) {
    return (
      <div className="relative -mt-16 flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
        <CheckCircle2 className="h-8 w-8 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">You are all caught up</p>
          <p className="text-sm text-muted-foreground">Nothing is waiting for your action in any module.</p>
        </div>
        <Link href="/my-work" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open your work board <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="relative -mt-16 space-y-2">
      {/* Two across even on a phone: four full-width tiles pushed everything else a screen down. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {data.workTiles.slice(0, 4).map(({ module, count, note, urgency }) => (
          <Link
            key={module.name}
            href={module.href}
            className="group min-w-0 rounded-xl border bg-card p-3.5 shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <ModuleTile module={module} size="sm" />
              <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">{module.label}</span>
            </div>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 sm:mt-4">
              <span className="text-2xl font-bold tabular-nums sm:text-3xl">{count}</span>
              <span className="text-xs sm:text-sm">{count === 1 ? 'item needs you' : 'items need you'}</span>
            </p>
            <p className={cn('mt-2 text-xs font-medium', URGENCY_TEXT[urgency])}>{note}</p>
          </Link>
        ))}
      </div>
      <div className="flex justify-end">
        <Link href="/my-work" className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {data.workTiles.length > 4 ? `All your work (${data.summary.action} items)` : 'Open your work board'}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function ModuleTile({ module, size }: { module: HomeModule; size: 'sm' | 'md' | 'lg' }) {
  const { Icon } = module;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none inline-flex shrink-0 items-center justify-center text-white shadow-sm',
        GROUP_TONE[module.group.color].tile,
        size === 'sm' && 'h-9 w-9 rounded-lg',
        size === 'md' && 'h-11 w-11 rounded-lg',
        size === 'lg' && 'h-14 w-14 rounded-2xl',
      )}
    >
      <Icon className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} />
    </span>
  );
}

function Favourites({ data }: { data: HomeData }) {
  if (data.loading) return null;
  return (
    <section aria-labelledby="home-favourites" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="home-favourites" className="text-lg font-semibold">Favourites</h2>
        {data.favourites.length > 0 ? (
          <p className="text-xs text-muted-foreground">Star or unstar any module below to change these.</p>
        ) : null}
      </div>
      {data.favourites.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Star the modules you use most — they will be kept here, one click away.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-x-2 gap-y-4">
          {data.favourites.map((module) => (
            <li key={module.name}>
              <Link
                href={module.href}
                className="group flex w-24 flex-col items-center gap-2 rounded-xl p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative transition group-hover:-translate-y-0.5">
                  <ModuleTile module={module} size="lg" />
                  {module.pending > 0 ? <CountBubble count={module.pending} className="absolute -right-1.5 -top-1.5" /> : null}
                </span>
                <span className="line-clamp-2 text-xs font-medium">{module.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CountBubble({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold tabular-nums text-background',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
      <span className="sr-only"> waiting for you</span>
    </span>
  );
}

function AllModules({ data }: { data: HomeData }) {
  // A group id, or 'all'. A filter on a group that has since emptied falls back to everything.
  const [filter, setFilter] = useState<string>('all');
  const picked = data.categories.filter((entry) => entry.group.id === filter);
  const groups = filter === 'all' || picked.length === 0 ? data.categories : picked;
  const active = filter !== 'all' && picked.length > 0 ? filter : 'all';

  return (
    <section aria-labelledby="home-all-modules" className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 id="home-all-modules" className="text-lg font-semibold">All modules</h2>
        {data.categories.length > 1 ? (
          <div role="group" aria-label="Show group" className="flex min-w-0 gap-1 overflow-x-auto rounded-full border bg-card p-1">
            {[{ id: 'all', label: 'All' }, ...data.categories.map((entry) => entry.group)].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-pressed={active === id}
                onClick={() => setFilter(id)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active === id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {data.loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }).map((_, key) => (
            <Skeleton key={key} className="h-[88px] rounded-xl" />
          ))}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.group.id} aria-label={group.group.label} className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className={cn('h-2 w-2 rounded-sm', GROUP_TONE[group.group.color].dot)} aria-hidden="true" />
              {group.group.label}
              <span className="font-normal text-muted-foreground">{group.modules.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {group.modules.map((module) => (
                <div
                  key={module.name}
                  className="group relative flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md"
                >
                  <StretchedLink href={module.href} label={module.label} />
                  <ModuleTile module={module} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{module.label}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{module.description}</p>
                  </div>
                  {module.pending > 0 ? <CountBubble count={module.pending} /> : null}
                  <FavouriteButton module={module} onToggle={data.toggleFavourite} />
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </section>
  );
}
