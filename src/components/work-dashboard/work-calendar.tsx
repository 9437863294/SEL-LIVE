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
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import {
  CALENDAR_VIEWS,
  WEEKDAY_LABELS,
  calendarItems,
  daysUntil,
  itemsByDate,
  monthGrid,
  monthLabel,
  monthOf,
  shiftAnchor,
  viewLabel,
  viewRange,
  workUrgency,
  yearMonths,
  yearOf,
  type CalendarView,
  type WorkItem,
  type WorkLanes,
} from '@/lib/work-dashboard';

/** Chips shown in a month-view day cell before it collapses to "+n more". */
const CHIPS_PER_DAY = 3;

const VIEW_LABEL: Record<CalendarView, string> = { year: 'Year', month: 'Month', day: 'Day' };

/* ── chips ─────────────────────────────────────────────────────────────────────────────────────── */

function DayChip({ item, past }: { item: WorkItem; past: boolean }) {
  const isQueue = typeof item.count === 'number' && item.count > 0;
  return (
    <Link
      href={item.href}
      title={`${item.module} — ${item.title}`}
      className={cn(
        'block truncate rounded border px-1 py-0.5 text-[10px] leading-tight transition-colors hover:brightness-95',
        moduleBadgeClass(item.module),
        // A meeting already held is history, not a commitment. Faded rather than hidden — "what did
        // we decide on the 3rd" is a real question this calendar should answer.
        past && 'opacity-60',
      )}
    >
      {item.startTime ? <span className="font-semibold tabular-nums">{item.startTime} </span> : null}
      {isQueue ? `${item.count} waiting` : item.title}
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
  const visible = expanded ? items : items.slice(0, CHIPS_PER_DAY);
  const overdue = items.some((item) => workUrgency(item, today) === 'overdue');

  return (
    <div
      className={cn(
        'flex min-h-[5.5rem] flex-col gap-1 border-b border-r border-slate-100 p-1.5 align-top',
        // Days either side of the month are shown but recede, so an item on the 1st of next month
        // is visible in the last row rather than vanishing until you page forward.
        !inMonth && 'bg-slate-50/60',
        isToday && 'bg-blue-50/60',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onOpenDay(date)}
          title="Open this day"
          className={cn(
            'rounded text-[11px] tabular-nums hover:underline',
            inMonth ? 'text-slate-600' : 'text-slate-400',
            isToday && 'flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-semibold text-white',
          )}
        >
          {Number(date.slice(8, 10))}
        </button>
        {overdue ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Overdue" /> : null}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <DayChip key={item.id} item={item} past={past} />
        ))}
        {items.length > CHIPS_PER_DAY ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded px-1 text-left text-[10px] font-medium text-muted-foreground hover:bg-slate-100 hover:text-slate-700"
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
      <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-slate-200 bg-slate-100">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-r border-slate-200 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
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
 * Twelve mini-months, each day carrying a dot per item up to three.
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
  const months = useMemo(() => yearMonths(yearOf(anchor)), [anchor]);

  return (
    <div className="grid grid-cols-1 gap-3 p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {months.map((month) => {
        const weeks = monthGrid(month);
        const count = weeks
          .flat()
          .filter((date) => date.startsWith(month))
          .reduce((total, date) => total + (byDate.get(date)?.length ?? 0), 0);

        return (
          <div key={month} className="rounded-lg border border-slate-100 p-2">
            <button
              type="button"
              onClick={() => onOpenMonth(month)}
              className="mb-1 flex w-full items-baseline justify-between gap-2 text-left hover:underline"
            >
              <span className="text-xs font-semibold text-slate-700">
                {monthLabel(month).replace(` ${yearOf(anchor)}`, '')}
              </span>
              {count > 0 ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
              ) : null}
            </button>

            <div className="grid grid-cols-7 gap-px">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-center text-[8px] font-medium uppercase text-slate-400">
                  {label.slice(0, 1)}
                </div>
              ))}
              {weeks.flat().map((date) => {
                const items = byDate.get(date) ?? [];
                const inMonth = date.startsWith(month);
                const isToday = date === today;
                const overdue = items.some((item) => workUrgency(item, today) === 'overdue');

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
                      'flex h-5 flex-col items-center justify-center rounded text-[9px] tabular-nums',
                      inMonth ? 'text-slate-600' : 'text-slate-300',
                      items.length && 'font-semibold',
                      isToday && 'bg-blue-600 text-white',
                      !isToday && items.length > 0 && 'bg-slate-100 hover:bg-slate-200',
                      !isToday && !items.length && 'hover:bg-slate-50',
                    )}
                  >
                    <span className="leading-none">{Number(date.slice(8, 10))}</span>
                    {items.length && !isToday ? (
                      <span
                        aria-hidden
                        className={cn('mt-px h-[3px] w-[3px] rounded-full', overdue ? 'bg-rose-500' : 'bg-blue-500')}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── day view ──────────────────────────────────────────────────────────────────────────────────── */

function DayView({ anchor, today, items }: { anchor: string; today: string; items: WorkItem[] }) {
  const past = daysUntil(anchor, today) < 0;

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-1.5 p-10 text-center">
        <CalendarDays className="h-8 w-8 text-slate-300" />
        <p className="text-sm font-medium text-slate-700">Nothing on this day.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => {
        const urgency = workUrgency(item, today);
        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                'flex items-baseline gap-3 px-3 py-2 transition-colors hover:bg-muted/50',
                past && 'opacity-70',
              )}
            >
              <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                {item.startTime ?? '—'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{item.title}</span>
              <Badge
                variant="outline"
                className={cn('shrink-0 whitespace-nowrap px-1.5 py-0 text-[10px]', moduleBadgeClass(item.module))}
              >
                {item.module}
              </Badge>
              {item.stage ? (
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{item.stage}</span>
              ) : null}
              {urgency === 'overdue' ? (
                <span className="shrink-0 text-[10px] font-medium text-rose-600">Overdue</span>
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
  const byDate = useMemo(() => {
    const byId = new Map<string, WorkItem>();
    for (const item of dated) byId.set(item.id, item);
    for (const item of meetings) byId.set(item.id, item);
    return itemsByDate([...byId.values()]);
  }, [dated, meetings]);

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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={`Previous ${view}`}
            onClick={() => setAnchor((value) => shiftAnchor(value, view, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label={`Next ${view}`}
            onClick={() => setAnchor((value) => shiftAnchor(value, view, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <h2 className="ml-1 whitespace-nowrap text-sm font-semibold text-slate-800">
            {viewLabel(anchor, view)}
          </h2>
          <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
            {visibleCount} item{visibleCount === 1 ? '' : 's'}
          </span>
          {isFetching ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
          {anchor !== today ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAnchor(today)}>
              Today
            </Button>
          ) : null}
        </div>

        {/* Plain buttons rather than Radix tabs: this is a three-way toggle inside a tab panel that
            is itself inside a tab panel, and a third nested tablist is more ARIA than it is worth. */}
        <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {CALENDAR_VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={view === candidate}
              onClick={() => setView(candidate)}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium transition-colors',
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
