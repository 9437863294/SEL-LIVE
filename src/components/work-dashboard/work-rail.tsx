'use client';

/**
 * The column beside the list: the day's meetings, what is waiting on other people, the team's
 * queues and the month at a glance. Each card is a preview of a lane; "View all" puts that lane in
 * the list, so nothing here is a dead end and nothing is only reachable from here.
 */

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { CalendarClock, CalendarDays, Check, Clock, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub-permissions';
import {
  WEEKDAY_LABELS,
  calendarItems,
  formatClock,
  monthGrid,
  monthLabel,
  monthOf,
  toWorkDate,
  viewLabel,
  workItemWeight,
  workUrgency,
  workWhenLabel,
  type WorkItem,
  type WorkLane,
  type WorkLanes,
} from '@/lib/work-dashboard';
import { cn } from '@/lib/utils';
import { ModuleTile } from './work-items';
import { workModuleLook } from './work-module';

function RailCard({ icon: Icon, title, action, children }: { icon: React.ElementType; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold">
          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </header>
      <div className="px-4 pb-3.5">{children}</div>
    </section>
  );
}

function RailEmpty({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-emerald-100 text-emerald-700" aria-hidden="true">
        <Check className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-foreground">{title}</span>
        {text}
      </span>
    </div>
  );
}

const linkButton = 'shrink-0 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm';

/** A row whose title is a link stretched over the row, so the whole row is the target. */
const stretched = 'after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring';

const PREVIEW = 4;

/* ── today ─────────────────────────────────────────────────────────────────────────────────────── */

function TodaySchedule({ meetings, weekCount, onLane }: { meetings: WorkItem[]; weekCount: number; onLane: (lane: WorkLane) => void }) {
  const more = weekCount > meetings.length;
  return (
    <RailCard
      icon={CalendarClock}
      title="Today’s schedule"
      action={
        more ? (
          <button type="button" className={linkButton} onClick={() => onLane('meeting')}>
            This week ({weekCount})
          </button>
        ) : (
          <Link href={`${OFFICE_HUB_BASE_PATH}/meetings`} className={linkButton}>
            Office Hub
          </Link>
        )
      }
    >
      {meetings.length ? (
        <ol>
          {meetings.slice(0, PREVIEW).map((meeting) => {
            const [clock, half] = meeting.startTime ? formatClock(meeting.startTime).split(' ') : ['All', 'day'];
            const detail = meeting.reference ?? meeting.stage ?? meeting.raisedBy;
            return (
              <li key={meeting.id} className="relative flex items-center gap-3 border-b border-dashed py-2.5 last:border-0">
                <span className="w-12 shrink-0 text-[13px] font-extrabold leading-tight tabular-nums">
                  {clock}
                  <span className="block text-[11px] font-semibold text-muted-foreground">{half}</span>
                </span>
                <span className="min-w-0 flex-1 border-l-[3px] border-primary/60 pl-2.5">
                  <Link href={meeting.href} className={cn('block truncate text-[13px] font-semibold', stretched)}>
                    {meeting.title}
                  </Link>
                  {detail ? <span className="block truncate text-[11.5px] text-muted-foreground">{detail}</span> : null}
                </span>
                {meeting.actionUrl ? (
                  <Button asChild size="sm" variant="outline" className="relative z-10 h-7 gap-1 px-2 text-xs">
                    <a href={meeting.actionUrl} target="_blank" rel="noreferrer">
                      <Video className="h-3 w-3" aria-hidden="true" />
                      Join
                    </a>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <RailEmpty title="No meetings today" text={weekCount ? `${weekCount} later this week.` : 'Your calendar is free.'} />
      )}
    </RailCard>
  );
}

/* ── waiting on others ─────────────────────────────────────────────────────────────────────────── */

function WaitingOnOthers({ items, today, onLane }: { items: WorkItem[]; today: string; onLane: (lane: WorkLane) => void }) {
  return (
    <RailCard
      icon={Clock}
      title="Waiting on others"
      action={
        items.length > PREVIEW ? (
          <button type="button" className={linkButton} onClick={() => onLane('watching')}>
            View all {items.length}
          </button>
        ) : undefined
      }
    >
      {items.length ? (
        <ol>
          {items.slice(0, PREVIEW).map((item) => {
            const late = workUrgency(item, today) === 'overdue';
            return (
              <li key={item.id} className="relative flex items-center gap-2.5 border-b border-dashed py-2 last:border-0">
                <ModuleTile module={item.module} size="rail" />
                <span className="min-w-0 flex-1">
                  <Link href={item.href} className={cn('block truncate text-[12.5px] font-semibold', stretched)}>
                    {item.title}
                  </Link>
                  <span className={cn('block truncate text-[11.5px]', late ? 'text-rose-600' : 'text-muted-foreground')}>
                    {[item.raisedBy ?? item.stage, item.dueAt ? workWhenLabel(item, today) : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <RailEmpty title="Nothing pending with others" text="What you raise or watch is tracked here." />
      )}
    </RailCard>
  );
}

/* ── team queues ───────────────────────────────────────────────────────────────────────────────── */

function TeamQueues({ items, onLane }: { items: WorkItem[]; onLane: (lane: WorkLane) => void }) {
  // One bar per module: a module's queue can arrive as one counted row or as several records.
  const queues = useMemo(() => {
    const byModule = new Map<string, { module: string; count: number; href: string; detail: string | null }>();
    for (const item of items) {
      const entry = byModule.get(item.module);
      if (entry) entry.count += workItemWeight(item);
      else byModule.set(item.module, { module: item.module, count: workItemWeight(item), href: item.href, detail: item.stage ?? null });
    }
    return [...byModule.values()].sort((left, right) => right.count - left.count);
  }, [items]);
  const largest = queues[0]?.count ?? 0;

  return (
    <RailCard
      icon={Users}
      title="Your team’s queues"
      action={
        items.length ? (
          <button type="button" className={linkButton} onClick={() => onLane('shared')}>
            View all
          </button>
        ) : undefined
      }
    >
      {queues.length ? (
        <ol className="space-y-1">
          {queues.slice(0, PREVIEW + 1).map((queue) => {
            const look = workModuleLook(queue.module);
            return (
              <li key={queue.module} className="relative py-1.5">
                <span className="flex items-baseline justify-between gap-2 text-[12.5px] font-semibold">
                  <Link href={queue.href} className={cn('truncate', stretched)}>
                    {look.label}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{queue.count.toLocaleString('en-IN')}</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cn('block h-full rounded-full bg-gradient-to-r', look.gradient)}
                    style={{ width: `${Math.max(4, Math.round((queue.count / largest) * 100))}%` }}
                  />
                </span>
                {queue.detail ? <span className="mt-1 block truncate text-[11px] text-muted-foreground">{queue.detail}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <RailEmpty title="Team queues are empty" text="Nothing is open to your role right now." />
      )}
    </RailCard>
  );
}

/* ── the month ─────────────────────────────────────────────────────────────────────────────────── */

function MonthGlance({ lanes, today, onOpenDay, onOpenCalendar }: { lanes: WorkLanes; today: string; onOpenDay: (date: string) => void; onOpenCalendar: () => void }) {
  const month = monthOf(today);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const counts = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const item of calendarItems(lanes).dated) {
      const date = toWorkDate(item.dueAt)!;
      byDate.set(date, (byDate.get(date) ?? 0) + 1);
    }
    return byDate;
  }, [lanes]);

  return (
    <RailCard
      icon={CalendarDays}
      title={monthLabel(month)}
      action={
        <button type="button" className={linkButton} onClick={onOpenCalendar}>
          Open calendar
        </button>
      }
    >
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11.5px]">
        {WEEKDAY_LABELS.map((day) => (
          <span key={day} className="py-0.5 text-[10.5px] font-bold text-muted-foreground" title={day}>
            {day[0]}
          </span>
        ))}
        {weeks.flat().map((date) => {
          const count = counts.get(date) ?? 0;
          const isToday = date === today;
          const outside = monthOf(date) !== month;
          const cell = cn(
            'relative flex h-7 items-center justify-center rounded-lg font-semibold tabular-nums',
            isToday ? 'bg-primary text-primary-foreground' : outside ? 'text-muted-foreground/40' : 'text-foreground/80',
          );
          const day = Number(date.slice(8));
          if (!count) return <span key={date} className={cell}>{day}</span>;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onOpenDay(date)}
              title={`${count} item${count === 1 ? '' : 's'} on ${viewLabel(date, 'day')}`}
              className={cn(cell, !isToday && 'hover:bg-muted', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              {day}
              <span
                className={cn(
                  'absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full',
                  isToday ? 'bg-primary-foreground' : date < today ? 'bg-rose-500' : 'bg-primary',
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          Something due
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
          Past its date
        </span>
      </p>
    </RailCard>
  );
}

/* ── the column ────────────────────────────────────────────────────────────────────────────────── */

export function WorkRail({
  lanes,
  today,
  onLane,
  onOpenDay,
  onOpenCalendar,
}: {
  lanes: WorkLanes;
  today: string;
  onLane: (lane: WorkLane) => void;
  onOpenDay: (date: string) => void;
  onOpenCalendar: () => void;
}) {
  const meetingsToday = useMemo(
    () =>
      lanes.meeting
        .filter((item) => toWorkDate(item.dueAt) === today)
        .sort((left, right) => (left.startTime ?? '').localeCompare(right.startTime ?? '')),
    [lanes.meeting, today],
  );

  return (
    <aside aria-label="At a glance" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-1">
      <TodaySchedule meetings={meetingsToday} weekCount={lanes.meeting.length} onLane={onLane} />
      <WaitingOnOthers items={lanes.watching} today={today} onLane={onLane} />
      <TeamQueues items={lanes.shared} onLane={onLane} />
      <MonthGlance lanes={lanes} today={today} onOpenDay={onOpenDay} onOpenCalendar={onOpenCalendar} />
    </aside>
  );
}
