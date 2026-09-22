'use client';

/**
 * Every dated thing across every module, on one calendar — year, month or day.
 *
 * ── Why this is not the Office Hub calendar ────────────────────────────────────────────────────
 *
 * `@/components/office-hub/meeting-calendar` is seven hundred lines built around Office Hub's own
 * `CalendarEntry`, with day/week/month/agenda views and drag-to-reschedule that calls
 * `updateMeeting`. It is the right screen for working *on* meetings. It cannot show an approval
 * deadline, an insurance premium due date or a tour departure, because those are not meetings and it
 * has no way to drag one.
 *
 * This is the other thing: read-only, cross-module, and answering "when is everything". Hence
 * year/month/day rather than day/week/month — the year view is the one that shows a quiet March and
 * a brutal September at a glance, which no per-module calendar can.
 *
 * ── Where the rows come from ───────────────────────────────────────────────────────────────────
 *
 * Two places, merged. Everything dated in `lanes` — approval deadlines, task and action-item dues,
 * premium and maturity dates, tour departures, reminders — is already in memory from the list tab,
 * so it costs nothing. Meetings are fetched per visible range by `fetchMeetings`, because the list
 * tab only holds the next seven days of *upcoming* ones and this calendar has to show history too.
 *
 * Both produce the same `office-hub-meetings:{id}` keys, so the merge de-duplicates on id and the
 * fetched copy wins. Undated rows — the aggregate shared-queue rows especially — are counted and
 * reported at the foot rather than parked on today.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Stamp,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import {
  CALENDAR_VIEWS,
  WEEKDAY_LABELS,
  WORK_KIND_ACCENT,
  WORK_KIND_BADGE,
  WORK_KIND_LABEL,
  calendarItems,
  daysUntil,
  densityStep,
  filterWorkItems,
  isWeekend,
  itemsByDate,
  kindsPresent,
  monthGrid,
  monthLabel,
  modulesPresent,
  monthOf,
  shiftAnchor,
  viewLabel,
  viewRange,
  workUrgency,
  yearMonths,
  yearOf,
  type CalendarView,
  type WorkItem,
  type WorkKind,
  type WorkLanes,
} from '@/lib/work-dashboard';

/** Chips shown in a month-view day cell before it collapses to "+n more". */
const CHIPS_PER_DAY = 3;

const VIEW_LABEL: Record<CalendarView, string> = { year: 'Year', month: 'Month', day: 'Day' };

/* ── filters ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * A toggle, not a link.
 *
 * `aria-pressed` rather than a checkbox: these are filters over what is already shown, and a screen
 * reader should hear "Meetings, pressed" rather than "Meetings, checked", which implies a form that
 * gets submitted.
 */
function FilterChip({
  label,
  active,
  activeClassName,
  onClick,
}: {
  label: string;
  active: boolean;
  activeClassName?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? activeClassName
            ? cn(activeClassName, 'ring-1 ring-inset ring-current')
            : 'border-slate-800 bg-slate-800 text-white'
          : 'border-slate-200 bg-white text-muted-foreground hover:border-slate-300 hover:text-slate-700',
      )}
    >
      {label}
    </button>
  );
}

/* ── chips ─────────────────────────────────────────────────────────────────────────────────────── */

/** An icon per kind, so colour is never the only thing distinguishing them. */
const KIND_ICON: Record<WorkKind, React.ElementType> = {
  approval: Stamp,
  task: CheckSquare,
  meeting: Users,
  reminder: Bell,
};

function DayChip({ item, past }: { item: WorkItem; past: boolean }) {
  const isQueue = typeof item.count === 'number' && item.count > 0;
  const Icon = KIND_ICON[item.kind];

  return (
    <Link
      href={item.href}
      title={`${WORK_KIND_LABEL[item.kind]} · ${item.module} — ${item.title}`}
      className={cn(
        'flex items-center gap-1 overflow-hidden rounded-md border pr-1 text-[10px] leading-tight shadow-sm transition-all hover:shadow',
        moduleBadgeClass(item.module),
        // A meeting already held is history, not a commitment. Faded rather than hidden — "what did
        // we decide on the 3rd" is a real question this calendar should answer.
        past && 'opacity-55 saturate-[0.6]',
      )}
    >
      {/* The kind's colour as a full-height edge: readable at a glance without costing width. */}
      <span aria-hidden className={cn('h-4 w-1 shrink-0 rounded-l', WORK_KIND_ACCENT[item.kind])} />
      <Icon aria-hidden className="h-2.5 w-2.5 shrink-0 opacity-70" />
      {item.startTime ? <span className="shrink-0 font-semibold tabular-nums">{item.startTime}</span> : null}
      <span className="truncate">{isQueue ? `${item.count} waiting` : item.title}</span>
    </Link>
  );
}

/* ── month view ────────────────────────────────────────────────────────────────────────────────── */

function MonthCell({
  date,
  month,
  today,
  items,
  onOpenDay,
}: {
  date: string;
  month: string;
  today: string;
  items: WorkItem[];
  onOpenDay: (date: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const inMonth = date.startsWith(month);
  const isToday = date === today;
  const past = daysUntil(date, today) < 0;
  const weekend = isWeekend(date);
  const visible = expanded ? items : items.slice(0, CHIPS_PER_DAY);
  const overdue = items.some((item) => workUrgency(item, today) === 'overdue');

  return (
    <div
      className={cn(
        'relative flex min-h-[6rem] flex-col gap-1 border-b border-r border-slate-100 p-1.5 align-top transition-colors',
        // Days either side of the month are shown but recede, so an item on the 1st of next month
        // is visible in the last row rather than vanishing until you page forward.
        !inMonth && 'bg-slate-50/70',
        // The weekend tint is what lets the eye find the week boundaries without counting columns.
        inMonth && weekend && 'bg-slate-50/60',
        inMonth && !weekend && 'bg-white',
        overdue && !isToday && 'bg-rose-50/40',
        isToday && 'bg-indigo-50/80 ring-1 ring-inset ring-indigo-300',
        'hover:bg-slate-50',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          title="Open this day"
          className={cn(
            'rounded text-[11px] font-medium tabular-nums transition-colors hover:underline',
            inMonth ? 'text-slate-600' : 'text-slate-400',
            isToday &&
              'flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 font-semibold text-white shadow-sm hover:no-underline',
          )}
        >
          {Number(date.slice(8, 10))}
        </button>
        {overdue ? (
          <span
            aria-hidden
            title="Something here is overdue"
            className="h-1.5 w-1.5 rounded-full bg-rose-500 ring-2 ring-rose-100"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <DayChip key={item.id} item={item} past={past} />
        ))}
        {items.length > CHIPS_PER_DAY ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-1 text-left text-[10px] font-medium text-indigo-600 hover:bg-indigo-50"
          >
            {expanded ? 'Show less' : `+${items.length - CHIPS_PER_DAY} more`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MonthView({
  anchor,
  today,
  byDate,
  onOpenDay,
}: {
  anchor: string;
  today: string;
  byDate: Map<string, WorkItem[]>;
  onOpenDay: (date: string) => void;
}) {
  const month = monthOf(anchor);
  const weeks = useMemo(() => monthGrid(month), [month]);

  return (
    <div className="min-w-[52rem]">
      <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-indigo-100 bg-gradient-to-b from-indigo-50 to-indigo-50/60">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              'border-r border-indigo-100/70 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider',
              // Saturday and Sunday are the last two columns of a Monday-first week.
              index >= 5 ? 'text-indigo-400' : 'text-indigo-700',
            )}
          >
            {label}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} className="grid grid-cols-7">
          {week.map((date) => (
            <MonthCell
              key={date}
              date={date}
              month={month}
              today={today}
              items={byDate.get(date) ?? []}
              onOpenDay={onOpenDay}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── year view ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Background per density step, for the year view's heat cells.
 *
 * Four steps of one hue rather than a rainbow: the year view ranks days by how busy they are, and a
 * ranking has to be read as an ordering — which multiple hues cannot be. Rose overrides the ramp
 * where something is overdue, because that is a different statement, not a busier one.
 */
const DENSITY_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: 'text-slate-400 hover:bg-slate-100',
  1: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  2: 'bg-indigo-300 text-indigo-950 hover:bg-indigo-400',
  3: 'bg-indigo-500 text-white hover:bg-indigo-600',
};

/**
 * Twelve mini-months as a heatmap.
 *
 * Deliberately not chips — at this scale a title is unreadable, and the question a year view answers
 * is "which weeks are heavy" rather than "what is it". Clicking a day opens the day view; clicking a
 * month name opens the month.
 */
function YearView({
  anchor,
  today,
  byDate,
  onOpenDay,
  onOpenMonth,
}: {
  anchor: string;
  today: string;
  byDate: Map<string, WorkItem[]>;
  onOpenDay: (date: string) => void;
  onOpenMonth: (month: string) => void;
}) {
  const year = yearOf(anchor);
  const months = useMemo(() => yearMonths(year), [year]);

  return (
    <div className="space-y-2 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {months.map((month) => {
          const weeks = monthGrid(month);
          const count = weeks
            .flat()
            .filter((date) => date.startsWith(month))
            .reduce((total, date) => total + (byDate.get(date)?.length ?? 0), 0);
          const isCurrentMonth = month === monthOf(today);

          return (
            <div
              key={month}
              className={cn(
                'rounded-xl border bg-white p-2.5 shadow-sm transition-shadow hover:shadow',
                isCurrentMonth ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-slate-100',
              )}
            >
              <button
                type="button"
                onClick={() => onOpenMonth(month)}
                className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-left"
              >
                <span
                  className={cn(
                    'text-xs font-semibold hover:underline',
                    isCurrentMonth ? 'text-indigo-700' : 'text-slate-700',
                  )}
                >
                  {monthLabel(month).replace(` ${year}`, '')}
                </span>
                {count > 0 ? (
                  <span className="rounded-full bg-indigo-50 px-1.5 text-[10px] font-medium text-indigo-700 tabular-nums">
                    {count}
                  </span>
                ) : null}
              </button>

              <div className="grid grid-cols-7 gap-[2px]">
                {WEEKDAY_LABELS.map((label, index) => (
                  <div
                    key={label}
                    className={cn(
                      'text-center text-[8px] font-semibold uppercase',
                      index >= 5 ? 'text-slate-300' : 'text-slate-400',
                    )}
                  >
                    {label.slice(0, 1)}
                  </div>
                ))}
                {weeks.flat().map((date) => {
                  const items = byDate.get(date) ?? [];
                  const inMonth = date.startsWith(month);
                  const isToday = date === today;
                  const overdue = items.some((item) => workUrgency(item, today) === 'overdue');
                  const step = densityStep(items.length);

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => onOpenDay(date)}
                      title={
                        items.length
                          ? `${date}: ${items.length} item${items.length === 1 ? '' : 's'}`
                          : date
                      }
                      className={cn(
                        'flex h-[18px] items-center justify-center rounded text-[9px] tabular-nums transition-colors',
                        DENSITY_CLASS[step],
                        step > 0 && 'font-semibold',
                        overdue && 'bg-rose-400 text-white hover:bg-rose-500',
                        isToday && 'ring-2 ring-indigo-600 ring-offset-1',
                        // The days either side of the month keep their heat but lose their weight,
                        // so a busy 1st of next month still shows without competing.
                        !inMonth && 'opacity-40',
                      )}
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* The ramp only means something if it is labelled. */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-muted-foreground">
        <span>Quieter</span>
        {([0, 1, 2, 3] as const).map((step) => (
          <span key={step} className={cn('h-3 w-3 rounded border border-slate-200', DENSITY_CLASS[step])} />
        ))}
        <span>Busier</span>
        <span className="ml-2 inline-flex items-center gap-1">
          <span className="h-3 w-3 rounded bg-rose-400" /> Overdue
        </span>
      </div>
    </div>
  );
}

/* ── day view ──────────────────────────────────────────────────────────────────────────────────── */

function DayView({ anchor, today, items }: { anchor: string; today: string; items: WorkItem[] }) {
  const past = daysUntil(anchor, today) < 0;

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-1.5 p-12 text-center">
        <CalendarDays className="h-9 w-9 text-indigo-200" />
        <p className="text-sm font-medium text-slate-700">Nothing on this day.</p>
        <p className="text-xs text-muted-foreground">Deadlines and meetings will appear here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => {
        const urgency = workUrgency(item, today);
        const Icon = KIND_ICON[item.kind];
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50',
                past && 'opacity-75',
              )}
            >
              <span aria-hidden className={cn('h-8 w-1 shrink-0 rounded-full', WORK_KIND_ACCENT[item.kind])} />
              <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                {item.startTime ?? '—'}
              </span>
              <Badge
                variant="outline"
                className={cn('shrink-0 gap-1 whitespace-nowrap px-1.5 py-0 text-[10px]', WORK_KIND_BADGE[item.kind])}
              >
                <Icon aria-hidden className="h-2.5 w-2.5" />
                {WORK_KIND_LABEL[item.kind].replace(/s$/, '')}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{item.title}</span>
              <Badge
                variant="outline"
                className={cn('shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]', moduleBadgeClass(item.module))}
              >
                {item.module}
              </Badge>
              {item.stage ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{item.stage}</span>
              ) : null}
              {urgency === 'overdue' ? (
                <Badge
                  variant="outline"
                  className="shrink-0 whitespace-nowrap border-rose-200 bg-rose-50 px-1.5 py-0 text-[10px] font-medium text-rose-700"
                >
                  Overdue
                </Badge>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
/* ── the screen ────────────────────────────────────────────────────────────────────────────────── */

export default function WorkCalendar({
  lanes,
  today,
  fetchMeetings,
}: {
  lanes: WorkLanes;
  today: string;
  fetchMeetings: ((from: string, to: string) => Promise<WorkItem[]>) | null;
}) {
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(today);
  const [meetings, setMeetings] = useState<WorkItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [failed, setFailed] = useState(false);

  const range = useMemo(() => viewRange(anchor, view), [anchor, view]);

  // Refetched whenever the visible span changes, which is what lets the year view show a whole
  // year of history without the list tab ever having loaded it.
  useEffect(() => {
    if (!fetchMeetings) return;
    let cancelled = false;
    setIsFetching(true);
    setFailed(false);
    void fetchMeetings(range.from, range.to)
      .then((rows) => {
        if (!cancelled) setMeetings(rows);
      })
      .catch(() => {
        // Same rule as the list's sources: a failure says so rather than showing a confident blank.
        if (!cancelled) {
          setMeetings([]);
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMeetings, range.from, range.to]);

  const { dated, undated } = useMemo(() => calendarItems(lanes), [lanes]);

  // Merged on id, fetched meetings last so their copy wins — it is the one that knows about a
  // meeting already held, which the lane's seven-day upcoming window cannot see.
  const all = useMemo(() => {
    const byId = new Map<string, WorkItem>();
    for (const item of dated) byId.set(item.id, item);
    for (const item of meetings) byId.set(item.id, item);
    return [...byId.values()];
  }, [dated, meetings]);

  /*
    The filter offers only what the merged data actually holds, computed before filtering so the
    chips do not disappear as you use them — a filter row that removes its own options as you narrow
    is one you cannot back out of.
  */
  const kindOptions = useMemo(() => kindsPresent(all), [all]);
  const moduleOptions = useMemo(() => modulesPresent(all), [all]);

  const [kinds, setKinds] = useState<Set<WorkKind>>(new Set());
  const [modules, setModules] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => filterWorkItems(all, { kinds, modules }), [all, kinds, modules]);
  const byDate = useMemo(() => itemsByDate(filtered), [filtered]);

  const hasFilter = kinds.size > 0 || modules.size > 0;
  const toggle = <T,>(setter: (next: Set<T>) => void, current: Set<T>) => (value: T) => {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  const visibleCount = useMemo(() => {
    let total = 0;
    for (const [date, items] of byDate) {
      if (date >= range.from && date <= range.to) total += items.length;
    }
    return total;
  }, [byDate, range.from, range.to]);

  const openDay = (date: string) => {
    setAnchor(date);
    setView('day');
  };
  const openMonth = (month: string) => {
    setAnchor(`${month}-01`);
    setView('month');
  };

  return (
    <div className="space-y-3">
      {/*
        One line, by request: navigation, filters and the view switcher share a single row.
        `flex-nowrap` with `overflow-x-auto` on the row rather than `flex-wrap` — so when the content
        is wider than the screen the toolbar pans sideways instead of becoming two or three lines.
        Every group is `shrink-0` for the same reason: allowing them to compress would squeeze the
        chips into unreadable slivers before anything scrolled.
      */}
      <div className="flex flex-nowrap items-center gap-2.5 overflow-x-auto pb-1">
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={`Previous ${view}`}
            onClick={() => setAnchor((value) => shiftAnchor(value, view, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label={`Next ${view}`}
            onClick={() => setAnchor((value) => shiftAnchor(value, view, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <h2 className="ml-2 mr-1 whitespace-nowrap text-base font-semibold tracking-tight text-slate-800">
            {viewLabel(anchor, view)}
          </h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {visibleCount} item{visibleCount === 1 ? '' : 's'}
          </span>
          {isFetching ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" /> : null}
          {anchor !== today ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setAnchor(today)}
            >
              Today
            </Button>
          ) : null}
        </div>

        {/*
          Both filter groups, inline. Multi-select, and an empty selection means everything rather
          than nothing — see `filterWorkItems`. Kind answers "just my meetings" / "just approvals";
          module answers "just Project Management"; they compose.
        */}
        {kindOptions.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2">
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Show
            </span>
            {kindOptions.map((kind) => (
              <FilterChip
                key={kind}
                label={WORK_KIND_LABEL[kind]}
                active={kinds.has(kind)}
                onClick={() => toggle(setKinds, kinds)(kind)}
              />
            ))}
          </div>
        ) : null}

        {moduleOptions.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1 border-l border-slate-200 pl-2">
            <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Module
            </span>
            {moduleOptions.map((name) => (
              <FilterChip
                key={name}
                label={name}
                active={modules.has(name)}
                activeClassName={moduleBadgeClass(name)}
                onClick={() => toggle(setModules, modules)(name)}
              />
            ))}
          </div>
        ) : null}

        {hasFilter ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            onClick={() => {
              setKinds(new Set());
              setModules(new Set());
            }}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        ) : null}

        {/* Plain buttons rather than Radix tabs: this is a three-way toggle inside a tab panel that
            is itself inside a tab panel, and a third nested tablist is more ARIA than it is worth.
            `ml-auto` pins it right when there is slack and lets it sit after the chips when there
            is not, which is what keeps the row to one line either way. */}
        <div className="ml-auto inline-flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {CALENDAR_VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className={cn(
                'whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium transition-colors',
                view === candidate
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-muted-foreground hover:text-slate-700',
              )}
            >
              {VIEW_LABEL[candidate]}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <CardContent className="p-0">
          {/*
            The grid scrolls inside this box rather than lengthening the page, matching the list tab.
            The month view sets a min width so seven columns stay legible and narrow screens pan
            sideways; the year and day views reflow instead, so they do not need one.
          */}
          <div className="max-h-[32rem] overflow-auto">
            {view === 'month' ? (
              <MonthView anchor={anchor} today={today} byDate={byDate} onOpenDay={openDay} />
            ) : view === 'year' ? (
              <YearView
                anchor={anchor}
                today={today}
                byDate={byDate}
                onOpenDay={openDay}
                onOpenMonth={openMonth}
              />
            ) : (
              <DayView anchor={anchor} today={today} items={byDate.get(anchor) ?? []} />
            )}
          </div>
        </CardContent>
      </Card>

      {failed ? (
        <p className="text-xs text-amber-800">
          Meetings could not be loaded for this period. Deadlines and tasks below are still accurate.
        </p>
      ) : null}

      {undated > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          {undated} item{undated === 1 ? '' : 's'} carry no date and are not on the calendar — see the
          List tab.
        </p>
      ) : null}
    </div>
  );
}
