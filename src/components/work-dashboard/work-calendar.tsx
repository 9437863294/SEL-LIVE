'use client';

/**
 * Every dated thing across every module, on one month grid.
 *
 * ── Why this is not the Office Hub calendar ────────────────────────────────────────────────────
 *
 * `@/components/office-hub/meeting-calendar` is seven hundred lines built around Office Hub's own
 * `CalendarEntry`, with four views and drag-to-reschedule that calls `updateMeeting`. It is the
 * right screen for working *on* meetings. It cannot show an approval deadline, an insurance premium
 * due date or a tour departure, because those are not meetings and it has no way to drag one.
 *
 * This is the other thing: read-only, one view, and fed by the same `WorkItem[]` the list tab
 * already loaded. That last part is the point — a calendar of everything needs **no queries of its
 * own**. Switching to this tab costs nothing, and it cannot disagree with the list beside it,
 * because it is the same rows arranged by date instead of by urgency.
 *
 * ── What lands on a day ────────────────────────────────────────────────────────────────────────
 *
 * Anything with a `dueAt`, from all four lanes: meetings and their start times, approval deadlines,
 * task due dates, premium and maturity dates, tour departures, reminder dates. Undated items are
 * counted and named at the foot rather than parked on today — a task with no deadline is not due
 * now, and putting it there would make the day look busier than it is.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { moduleBadgeClass } from '@/lib/activity-modules';
import {
  WEEKDAY_LABELS,
  addMonths,
  calendarItems,
  itemsByDate,
  monthGrid,
  monthLabel,
  monthOf,
  workUrgency,
  type WorkItem,
  type WorkLanes,
} from '@/lib/work-dashboard';

/** Chips shown in a day cell before it collapses to "+n more". */
const CHIPS_PER_DAY = 3;

function DayChip({ item }: { item: WorkItem }) {
  const isQueue = typeof item.count === 'number' && item.count > 0;
  return (
    <Link
      href={item.href}
      title={`${item.module} — ${item.title}`}
      className={cn(
        'block truncate rounded border px-1 py-0.5 text-[10px] leading-tight transition-colors hover:brightness-95',
        moduleBadgeClass(item.module),
      )}
    >
      {item.startTime ? <span className="font-semibold tabular-nums">{item.startTime} </span> : null}
      {isQueue ? `${item.count} waiting` : item.title}
    </Link>
  );
}

function DayCell({
  date,
  month,
  today,
  items,
}: {
  date: string;
  month: string;
  today: string;
  items: WorkItem[];
}) {
  const [expanded, setExpanded] = useState(false);
  const inMonth = date.startsWith(month);
  const isToday = date === today;
  const visible = expanded ? items : items.slice(0, CHIPS_PER_DAY);
  const overdue = items.some((item) => workUrgency(item, today) === 'overdue');

  return (
    <div
      className={cn(
        'flex min-h-[5.5rem] flex-col gap-1 border-b border-r border-slate-100 p-1.5 align-top',
        // The days either side of the month are shown but recede, so the month reads as a block
        // without an item on the 1st of next month disappearing until you page forward.
        !inMonth && 'bg-slate-50/60',
        isToday && 'bg-blue-50/60',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={cn(
            'text-[11px] tabular-nums',
            inMonth ? 'text-slate-600' : 'text-slate-400',
            isToday && 'flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-semibold text-white',
          )}
        >
          {Number(date.slice(8, 10))}
        </span>
        {overdue ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Overdue" /> : null}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((item) => (
          <DayChip key={item.id} item={item} />
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

export default function WorkCalendar({ lanes, today }: { lanes: WorkLanes; today: string }) {
  const [month, setMonth] = useState(() => monthOf(today));

  const { dated, undated } = useMemo(() => calendarItems(lanes), [lanes]);
  const byDate = useMemo(() => itemsByDate(dated), [dated]);
  const weeks = useMemo(() => monthGrid(month), [month]);

  // Counted over the month on screen, not the whole dataset — the figure beside the month name has
  // to describe what is being looked at.
  const inMonth = useMemo(
    () => dated.filter((item) => monthOf(String(item.dueAt ?? '').slice(0, 10)) === month).length,
    [dated, month],
  );

  const modules = useMemo(() => {
    const names = new Set<string>();
    for (const week of weeks) {
      for (const date of week) for (const item of byDate.get(date) ?? []) names.add(item.module);
    }
    return [...names].sort();
  }, [weeks, byDate]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous month"
            onClick={() => setMonth((value) => addMonths(value, -1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Next month"
            onClick={() => setMonth((value) => addMonths(value, 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <h2 className="ml-1 text-sm font-semibold text-slate-800">{monthLabel(month)}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {inMonth} item{inMonth === 1 ? '' : 's'}
          </span>
          {month !== monthOf(today) ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setMonth(monthOf(today))}
            >
              Today
            </Button>
          ) : null}
        </div>

        {modules.length ? (
          <div className="flex flex-wrap gap-1">
            {modules.map((name) => (
              <Badge
                key={name}
                variant="outline"
                className={cn('px-1.5 py-0 text-[10px] font-medium', moduleBadgeClass(name))}
              >
                {name}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
        <CardContent className="p-0">
          {/*
            The grid scrolls inside this box rather than lengthening the page, which is what the
            list tab does too — the point of both is that the header and the figures above stay put
            while you read. `min-w-[52rem]` keeps seven legible columns and lets narrow screens pan
            sideways instead of crushing them to nothing.
          */}
          <div className="max-h-[32rem] overflow-auto">
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
                    <DayCell
                      key={date}
                      date={date}
                      month={month}
                      today={today}
                      items={byDate.get(date) ?? []}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

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
