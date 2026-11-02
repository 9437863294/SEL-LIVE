'use client';

/**
 * The central dashboard: what needs you, across every module, one click from where it is done.
 *
 * Three parts. The band at the top greets the person and holds four figures — needs your action,
 * meetings today, your team's queues, waiting on others — which are also the switch for the list.
 * The list shows one of those lanes at a time, as cards under deadline headings, or as deadline
 * columns on the Board, or everything on the Calendar. Beside it, the rail previews the other lanes
 * (today's meetings, what others hold, the queues) and the month, so the lane in the list is never
 * the only thing in view.
 *
 * The lanes stay apart on purpose. Work a field names *you* for and work merely open to your role
 * are different statements — one is yours to answer for, the other anybody in your role could pick
 * up — and mixing them would be the one genuinely misleading thing this screen could do.
 *
 * ── What this screen deliberately does not do ──────────────────────────────────────────────────
 *
 * No per-person productivity figures. A count of somebody's open items is not a measure of their
 * output, and a dashboard that implies otherwise gets gamed rather than used — the same instruction
 * Office Hub's management overview follows ("do not generate employee performance scores or
 * rankings", §73). What is here is operational: what is waiting, how late it is, and where to click.
 *
 * No decisions either: every card opens the module that owns the decision (see `work-items.tsx`).
 *
 * And it does not hide a source that failed. A zero because nothing is pending and a zero because
 * the query was denied look identical, and only one means you can stop worrying — so failures get a
 * visible notice naming the queues that could not be read.
 */

import dynamic from 'next/dynamic';
import { useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, KanbanSquare, List as ListIcon, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  WORK_LANE_HINT,
  WORK_LANE_TITLE,
  calendarItems,
  countByModule,
  searchWorkItems,
  sortWorkItems,
  type WorkLane,
  type WorkSort,
} from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import { useWorkDashboard, type WorkDashboardState } from './hooks';
import { WorkHero } from './work-hero';
import { ModuleTile, WorkColumns, WorkEmpty, WorkList } from './work-items';
import { workModuleLook } from './work-module';
import { WorkRail } from './work-rail';

// Downloaded the first time somebody opens the Calendar view, not with the home page.
const WorkCalendar = dynamic(() => import('./work-calendar'), {
  loading: () => <Skeleton className="h-96 rounded-2xl" />,
});

type WorkView = 'list' | 'board' | 'calendar';

const VIEWS: Array<{ id: WorkView; label: string; icon: React.ElementType }> = [
  { id: 'list', label: 'List', icon: ListIcon },
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

const SORT_LABEL: Record<WorkSort, string> = {
  due: 'Sort: Due date',
  amount: 'Sort: Amount',
  module: 'Sort: Module',
};

/* ── failures ──────────────────────────────────────────────────────────────────────────────────── */

function FailureNotice({ failures }: { failures: Array<{ id: string; label: string; message: string }> }) {
  const [open, setOpen] = useState(false);
  if (!failures.length) return null;

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-amber-900">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">
            {failures.length} queue{failures.length === 1 ? '' : 's'} could not be read.
          </span>{' '}
          <span className="text-amber-800/80">Everything below is accurate; work in these may not be shown.</span>
        </p>
        <button
          type="button"
          className="shrink-0 text-xs font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Details'}
        </button>
      </div>
      {open ? (
        <ul className="mt-1.5 space-y-0.5 border-t border-amber-200/70 pl-5 pt-1.5 text-[11px] text-amber-900/90">
          {failures.map((failure) => (
            <li key={failure.id}>
              <span className="font-medium">{failure.label}</span> — {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── toolbar ───────────────────────────────────────────────────────────────────────────────────── */

function ViewSwitch({ view, onView, datedCount }: { view: WorkView; onView: (view: WorkView) => void; datedCount: number }) {
  return (
    <div role="group" aria-label="View" className="order-1 inline-flex shrink-0 rounded-xl border bg-card p-1 shadow-sm">
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => onView(id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
            {id === 'calendar' && datedCount > 0 ? (
              <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-background/20' : 'bg-muted')}>{datedCount}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ModuleChips({
  total,
  modules,
  active,
  onPick,
}: {
  total: number;
  modules: Array<{ module: string; count: number }>;
  active: string | null;
  onPick: (module: string | null) => void;
}) {
  const chip = (selected: boolean) =>
    cn(
      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border bg-card pr-2.5 text-xs font-semibold transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'border-foreground text-foreground ring-1 ring-inset ring-foreground' : 'text-muted-foreground hover:border-foreground/30 hover:text-foreground',
    );
  return (
    // A line of its own. On a phone it pans sideways rather than wrapping, where a dozen modules
    // would take three lines of a small screen; on a desktop it wraps, so no module is out of sight.
    <div role="group" aria-label="Module" className="order-3 flex w-full min-w-0 gap-1.5 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-visible lg:pb-0">
      <button type="button" aria-pressed={active === null} onClick={() => onPick(null)} className={cn(chip(active === null), 'pl-3')}>
        All <span className="font-medium tabular-nums text-muted-foreground">{total}</span>
      </button>
      {modules.map(({ module, count }) => (
        <button key={module} type="button" aria-pressed={active === module} onClick={() => onPick(module)} className={cn(chip(active === module), 'pl-1')}>
          <ModuleTile module={module} size="sm" className="h-6 w-6 rounded-full" />
          {workModuleLook(module).label}
          <span className="font-medium tabular-nums text-muted-foreground">{count}</span>
        </button>
      ))}
    </div>
  );
}

/* ── the screen ────────────────────────────────────────────────────────────────────────────────── */

interface WorkDashboardProps {
  className?: string;
  /**
   * False on the home page, where the tab already says "Your work". True on `/my-work`, where the
   * band is the page's only title, so its eyebrow names the page.
   */
  showTitle?: boolean;
}

/** The board with its own data, for `/my-work`. */
export default function WorkDashboard(props: WorkDashboardProps) {
  return <WorkBoard {...props} state={useWorkDashboard()} />;
}

/**
 * The board drawn from data the caller already holds.
 *
 * The home page runs `useWorkDashboard` itself and passes the result in. That way its tab can show
 * the pending count while this board is not mounted at all: somebody who opens the home page on
 * Modules gets the count without paying for the board, built out of sight. The hook is still run
 * exactly once, so the fan-out is never done twice.
 */
export function WorkBoard({
  className,
  showTitle = true,
  state,
}: WorkDashboardProps & { state: WorkDashboardState }) {
  const { lanes, summary, failures, today, isLoading, isRefreshing, refresh, fetchMeetings } = state;
  const { user } = useAuth();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const [lane, setLane] = useState<WorkLane>('action');
  const [view, setView] = useState<WorkView>('list');
  const [module, setModule] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkSort>('due');
  // The calendar is built the first time it is opened, then kept, so the month it was paged to
  // survives a trip back to the list. A day picked on the month glance re-opens it on that day.
  const [calendarOpened, setCalendarOpened] = useState(false);
  const [calendarDay, setCalendarDay] = useState<string | null>(null);

  const laneItems = lanes[lane];
  const modules = useMemo(() => countByModule(laneItems), [laneItems]);
  // A module filter left over from a lane that no longer has that module filters nothing.
  const activeModule = module && modules.some((entry) => entry.module === module) ? module : null;
  const shown = useMemo(() => {
    const inModule = activeModule ? laneItems.filter((item) => item.module === activeModule) : laneItems;
    return sortWorkItems(searchWorkItems(inModule, query), sort, today);
  }, [laneItems, activeModule, query, sort, today]);
  const datedCount = useMemo(() => calendarItems(lanes).dated.length, [lanes]);

  /** Bring the list into view when it is below the fold — on a phone it sits under the band. */
  const revealList = () =>
    requestAnimationFrame(() => {
      const list = listRef.current;
      if (list && list.getBoundingClientRect().top > window.innerHeight * 0.6) {
        list.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

  const selectLane = (next: WorkLane) => {
    setLane(next);
    setModule(null);
    if (view === 'calendar') setView('list');
    revealList();
  };

  const selectView = (next: WorkView) => {
    if (next === 'calendar') setCalendarOpened(true);
    setView(next);
  };

  const openDay = (date: string) => {
    setCalendarDay(date);
    setCalendarOpened(true);
    setView('calendar');
    revealList();
  };

  const clearFilters = () => {
    setModule(null);
    setQuery('');
  };

  if (isLoading) {
    return (
      <div className={cn('w-full space-y-4', className)} aria-busy="true">
        <Skeleton className="h-[19rem] rounded-2xl sm:h-56 lg:h-44" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-2.5">
            <Skeleton className="h-9 w-64 rounded-xl" />
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-20 rounded-2xl" />
            ))}
          </div>
          <div className="hidden space-y-3 xl:block">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const filtered = Boolean(activeModule || query.trim());

  return (
    <div className={cn('w-full space-y-4', className)}>
      <WorkHero
        firstName={(user?.name ?? '').trim().split(/\s+/)[0] ?? ''}
        summary={summary}
        lanes={lanes}
        today={today}
        lane={lane}
        onLane={selectLane}
        next={lanes.action[0] ?? null}
        isRefreshing={isRefreshing}
        onRefresh={refresh}
        showTitle={showTitle}
        listId={listId}
      />

      <FailureNotice failures={failures} />

      {/* The calendar takes the full width: it is a glance of its own, and beside the rail its one-line
          toolbar would have to pan to reach the year, month and day switch. */}
      <div className={cn('grid grid-cols-1 gap-4', view !== 'calendar' && 'xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start')}>
        <div ref={listRef} id={listId} className="min-w-0 scroll-mt-20 space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <ViewSwitch view={view} onView={selectView} datedCount={datedCount} />
            {view !== 'calendar' && modules.length > 1 ? (
              <ModuleChips total={laneItems.length} modules={modules} active={activeModule} onPick={setModule} />
            ) : null}
            {view !== 'calendar' ? (
              <div className="order-2 ml-auto flex w-full items-center gap-2 md:w-auto">
                <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search title, ref, person…"
                    aria-label="Search your work"
                    className="h-9 rounded-xl pl-8"
                  />
                </div>
                <Select value={sort} onValueChange={(value) => setSort(value as WorkSort)}>
                  <SelectTrigger className="h-9 w-[9.75rem] shrink-0 rounded-xl text-left" aria-label="Sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABEL) as WorkSort[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {SORT_LABEL[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          {view !== 'calendar' ? (
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold leading-tight">{WORK_LANE_TITLE[lane]}</h2>
                <p className="text-xs text-muted-foreground">{WORK_LANE_HINT[lane]}</p>
              </div>
              {lane !== 'action' ? (
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => selectLane('action')}>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to what needs you
                </Button>
              ) : null}
            </div>
          ) : null}

          {view === 'calendar' ? null : shown.length === 0 ? (
            <WorkEmpty lane={lane} filtered={filtered} onClear={clearFilters} />
          ) : view === 'board' ? (
            <WorkColumns items={shown} today={today} />
          ) : (
            // Keyed on the lane, so "Show all" folds back when the list changes to another lane.
            <WorkList key={lane} items={shown} today={today} grouped={sort === 'due'} />
          )}

          {/* Kept mounted once opened, hidden rather than unmounted, so its month and filters survive. */}
          <div className={view === 'calendar' ? undefined : 'hidden'}>
            {calendarOpened ? (
              <WorkCalendar key={calendarDay ?? 'month'} lanes={lanes} today={today} fetchMeetings={fetchMeetings} initialDate={calendarDay ?? undefined} />
            ) : null}
          </div>
        </div>

        {view !== 'calendar' ? (
          <WorkRail
            lanes={lanes}
            today={today}
            onLane={selectLane}
            onOpenDay={openDay}
            onOpenCalendar={() => {
              selectView('calendar');
              revealList();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
