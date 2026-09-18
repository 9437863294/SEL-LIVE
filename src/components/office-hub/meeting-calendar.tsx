'use client';

/**
 * The calendar (§8).
 *
 * Four views — day, week, month, agenda — over one fetched window, plus task deadlines and
 * configured holidays. Meetings, tasks and holidays are three different kinds of thing on the same
 * grid, so they share a single `CalendarEntry` shape and are distinguished by colour and icon
 * rather than by being drawn differently.
 *
 * ── Drag to reschedule ─────────────────────────────────────────────────────────────────────────
 *
 * §8 asks for it "if technically practical". In the month view it is: each day cell is a drop
 * target, each meeting chip is draggable, and a drop moves the meeting to that date keeping its
 * time. That is the reschedule people actually want — "move Thursday's review to Friday" — and it
 * goes through `updateMeeting`, so the participants are notified and the reminders are rebuilt just
 * as they would be from the form.
 *
 * It is deliberately *not* offered in the day and week views. Dropping onto a time column implies
 * changing the time too, which needs the drag to resolve to a minute rather than a cell; getting
 * that wrong silently moves a meeting by half an hour, and the form is one click away.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  PartyPopper,
  Radio,
  Video,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  DraggableProvided,
  DraggableStateSnapshot,
  DropResult,
  DroppableProvided,
  DroppableStateSnapshot,
} from '@hello-pangea/dnd';
import {
  CALENDAR_VIEWS,
  OFFICE_HUB_BASE_PATH,
  OFFICE_HUB_WEEKDAYS,
  addDays,
  clockToMinutes,
  daysBetween,
  endOfMonth,
  formatClockTime,
  formatIsoDate,
  holidayOn,
  isTaskOverdue,
  isWorkingDay,
  meetingTimeState,
  startOfMonth,
  startOfWeek,
  weekdayOf,
  type CalendarView,
  type OfficeHubMeeting,
  type OfficeHubSettings,
  type OfficeHubTask,
} from '@/lib/office-hub';
import { OfficeHubEmptyState } from './ui';

const DragDropContext = dynamic(
  () => import('@hello-pangea/dnd').then((module) => module.DragDropContext),
  { ssr: false },
);
const Droppable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Droppable), {
  ssr: false,
});
const Draggable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Draggable), {
  ssr: false,
});

export interface CalendarEntry {
  kind: 'meeting' | 'task' | 'holiday';
  id: string;
  date: string;
  title: string;
  /** Meetings only. */
  startTime?: string;
  endTime?: string;
  subtitle?: string;
  href?: string;
  tone: string;
  meeting?: OfficeHubMeeting;
  task?: OfficeHubTask;
  draggable?: boolean;
}

/** Turn meetings, tasks and holidays into one list the grid can render. */
export function buildCalendarEntries(input: {
  meetings: readonly OfficeHubMeeting[];
  tasks: readonly OfficeHubTask[];
  settings: Partial<OfficeHubSettings> | null;
  from: string;
  to: string;
  today: string;
  showMeetings: boolean;
  showTasks: boolean;
  showHolidays: boolean;
  canReschedule: boolean;
  now: Date;
}): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  if (input.showMeetings) {
    for (const meeting of input.meetings) {
      if (meeting.date < input.from || meeting.date > input.to) continue;
      const state = meetingTimeState(meeting, input.now);
      entries.push({
        kind: 'meeting',
        id: meeting.id,
        date: meeting.date,
        title: meeting.title,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        subtitle: `${meeting.organizerName}${meeting.mode !== 'Offline' ? ' · online' : ''}`,
        href: `${OFFICE_HUB_BASE_PATH}/meetings/${meeting.id}`,
        tone:
          meeting.status === 'Cancelled'
            ? 'border-slate-200 bg-slate-50 text-slate-400 line-through'
            : state === 'live'
              ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
              : meeting.priority === 'Critical'
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-indigo-200 bg-indigo-50 text-indigo-900',
        meeting,
        // A cancelled or completed meeting is not rescheduled; it is superseded.
        draggable:
          input.canReschedule && meeting.status !== 'Cancelled' && meeting.status !== 'Completed',
      });
    }
  }

  if (input.showTasks) {
    for (const task of input.tasks) {
      if (!task.dueDate || task.dueDate < input.from || task.dueDate > input.to) continue;
      if (task.status === 'Cancelled') continue;
      entries.push({
        kind: 'task',
        id: task.id,
        date: task.dueDate,
        title: task.title,
        subtitle: task.assigneeName ?? task.teamName ?? 'Unassigned',
        href: `${OFFICE_HUB_BASE_PATH}/tasks/${task.id}`,
        tone:
          task.status === 'Completed'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : isTaskOverdue(task, input.today)
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : 'border-amber-200 bg-amber-50 text-amber-900',
        task,
      });
    }
  }

  if (input.showHolidays) {
    for (const holiday of input.settings?.holidays ?? []) {
      if (holiday.date < input.from || holiday.date > input.to) continue;
      entries.push({
        kind: 'holiday',
        id: `holiday-${holiday.date}`,
        date: holiday.date,
        title: holiday.name,
        tone: 'border-violet-200 bg-violet-50 text-violet-900',
      });
    }
  }

  return entries.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (clockToMinutes(a.startTime ?? '23:59') ?? 1439) - (clockToMinutes(b.startTime ?? '23:59') ?? 1439),
  );
}

export function MeetingCalendar({
  view,
  anchorDate,
  entries,
  settings,
  today,
  onNavigate,
  onViewChange,
  onReschedule,
  onPickSlot,
}: {
  view: CalendarView;
  anchorDate: string;
  entries: CalendarEntry[];
  settings: OfficeHubSettings;
  today: string;
  onNavigate: (nextAnchor: string) => void;
  onViewChange: (next: CalendarView) => void;
  /** Called when a meeting chip is dropped on another day. */
  onReschedule?: (meeting: OfficeHubMeeting, toDate: string) => void;
  /** Called when an empty slot is clicked, to open the create form pre-dated. */
  onPickSlot?: (date: string, time?: string) => void;
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date) ?? [];
      list.push(entry);
      map.set(entry.date, list);
    }
    return map;
  }, [entries]);

  const step = (direction: -1 | 1) => {
    if (view === 'day') return onNavigate(addDays(anchorDate, direction));
    if (view === 'week') return onNavigate(addDays(anchorDate, 7 * direction));
    if (view === 'month') {
      const nextMonthAnchor =
        direction === 1 ? addDays(endOfMonth(anchorDate), 1) : addDays(startOfMonth(anchorDate), -1);
      return onNavigate(startOfMonth(nextMonthAnchor));
    }
    return onNavigate(addDays(anchorDate, 14 * direction));
  };

  const periodLabel = useMemo(() => {
    if (view === 'day') return formatIsoDate(anchorDate, { withWeekday: true });
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      return `${formatIsoDate(start, { year: false })} – ${formatIsoDate(addDays(start, 6))}`;
    }
    if (view === 'month') {
      return new Date(`${anchorDate}T00:00:00Z`).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    return `${formatIsoDate(anchorDate)} – ${formatIsoDate(addDays(anchorDate, 13))}`;
  }, [view, anchorDate]);

  return (
    <div className="space-y-2">
      <Card>
        <CardContent className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => step(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => step(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onNavigate(today)}>
              Today
            </Button>
            <p className="ml-2 min-w-0 truncate text-sm font-semibold text-slate-800">{periodLabel}</p>
          </div>

          <div className="flex items-center gap-1 rounded-lg border bg-white p-0.5" role="group" aria-label="Calendar view">
            {CALENDAR_VIEWS.map((entry) => (
              <Button
                key={entry}
                size="sm"
                variant={view === entry ? 'default' : 'ghost'}
                aria-pressed={view === entry}
                className="h-7 px-2 text-xs capitalize"
                onClick={() => onViewChange(entry)}
              >
                {entry}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {view === 'month' && (
        <MonthGrid
          anchorDate={anchorDate}
          byDate={byDate}
          settings={settings}
          today={today}
          onReschedule={onReschedule}
          onPickSlot={onPickSlot}
        />
      )}
      {view === 'week' && (
        <WeekGrid anchorDate={anchorDate} byDate={byDate} settings={settings} today={today} onPickSlot={onPickSlot} />
      )}
      {view === 'day' && (
        <DayList date={anchorDate} entries={byDate.get(anchorDate) ?? []} settings={settings} today={today} onPickSlot={onPickSlot} />
      )}
      {view === 'agenda' && <AgendaList anchorDate={anchorDate} byDate={byDate} settings={settings} today={today} />}
    </div>
  );
}

/* ── month ───────────────────────────────────────────────────────────────────────────────────── */

function MonthGrid({
  anchorDate,
  byDate,
  settings,
  today,
  onReschedule,
  onPickSlot,
}: {
  anchorDate: string;
  byDate: Map<string, CalendarEntry[]>;
  settings: OfficeHubSettings;
  today: string;
  onReschedule?: (meeting: OfficeHubMeeting, toDate: string) => void;
  onPickSlot?: (date: string, time?: string) => void;
}) {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const monthEnd = endOfMonth(anchorDate);
  const gridEnd = addDays(startOfWeek(monthEnd), 6);
  const dayCount = daysBetween(gridStart, gridEnd) + 1;
  const days = Array.from({ length: dayCount }, (_, index) => addDays(gridStart, index));
  const monthPrefix = anchorDate.slice(0, 7);

  const body = (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="grid grid-cols-7 border-b bg-slate-50">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div
            key={weekday}
            className="px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500"
          >
            {OFFICE_HUB_WEEKDAYS[weekday].short}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((date) => {
          const entries = byDate.get(date) ?? [];
          const inMonth = date.startsWith(monthPrefix);
          const holiday = holidayOn(date, settings);
          const working = isWorkingDay(date, settings);

          return (
            <Droppable droppableId={date} key={date} isDropDisabled={!onReschedule}>
              {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    'min-h-[6.5rem] border-b border-r p-1 last:border-r-0',
                    !inMonth && 'bg-slate-50/60',
                    // Non-working days are shaded, so a Sunday reads as a Sunday at a glance (§8).
                    inMonth && !working && 'bg-slate-50',
                    date === today && 'bg-indigo-50/60',
                    snapshot.isDraggingOver && 'ring-2 ring-inset ring-indigo-400',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => onPickSlot?.(date)}
                      className={cn(
                        'rounded px-1 text-[11px] font-semibold tabular-nums hover:bg-white',
                        date === today ? 'bg-indigo-600 text-white' : inMonth ? 'text-slate-700' : 'text-slate-400',
                      )}
                      aria-label={`Schedule a meeting on ${formatIsoDate(date)}`}
                    >
                      {Number(date.slice(8, 10))}
                    </button>
                    {holiday && (
                      <PartyPopper className="h-3 w-3 shrink-0 text-violet-500" aria-label={holiday.name} />
                    )}
                  </div>

                  <div className="space-y-0.5">
                    {entries.slice(0, 4).map((entry, index) =>
                      entry.draggable && entry.meeting ? (
                        <Draggable draggableId={entry.id} index={index} key={entry.id}>
                          {(dragProvided: DraggableProvided, dragSnapshot: DraggableStateSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={cn(dragSnapshot.isDragging && 'opacity-80')}
                            >
                              <EntryChip entry={entry} compact />
                            </div>
                          )}
                        </Draggable>
                      ) : (
                        <EntryChip entry={entry} key={entry.id} compact />
                      ),
                    )}
                    {entries.length > 4 && (
                      <p className="px-1 text-[10px] text-muted-foreground">+{entries.length - 4} more</p>
                    )}
                  </div>
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </div>
  );

  if (!onReschedule) return body;

  return (
    <>
      <DragDropContext
        onDragEnd={(result: DropResult) => {
          if (!result.destination) return;
          const toDate = result.destination.droppableId;
          const entry = (byDate.get(result.source.droppableId) ?? []).find(
            (candidate) => candidate.id === result.draggableId,
          );
          if (!entry?.meeting || entry.meeting.date === toDate) return;
          onReschedule(entry.meeting, toDate);
        }}
      >
        {body}
      </DragDropContext>
      <p className="text-[11px] text-muted-foreground">
        Drag a meeting to another day to reschedule it — the time is kept, participants are notified,
        and the reminders move with it.
      </p>
    </>
  );
}

/* ── week ────────────────────────────────────────────────────────────────────────────────────── */

function WeekGrid({
  anchorDate,
  byDate,
  settings,
  today,
  onPickSlot,
}: {
  anchorDate: string;
  byDate: Map<string, CalendarEntry[]>;
  settings: OfficeHubSettings;
  today: string;
  onPickSlot?: (date: string, time?: string) => void;
}) {
  const start = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  return (
    // A horizontal scroller rather than a squeezed seven-column grid: seven columns of meeting
    // titles at phone width are seven columns of nothing readable.
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="flex min-w-0 gap-2 lg:grid lg:grid-cols-7">
        {days.map((date) => {
          const entries = byDate.get(date) ?? [];
          const holiday = holidayOn(date, settings);
          return (
            <div
              key={date}
              className={cn(
                'w-[13rem] shrink-0 rounded-xl border bg-white p-2 lg:w-auto',
                date === today && 'border-indigo-300 bg-indigo-50/50',
                !isWorkingDay(date, settings) && 'bg-slate-50',
              )}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {OFFICE_HUB_WEEKDAYS[weekdayOf(date)].short}
                  </p>
                  <p className={cn('text-sm font-semibold tabular-nums', date === today && 'text-indigo-700')}>
                    {Number(date.slice(8, 10))}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-[11px]"
                  onClick={() => onPickSlot?.(date, settings.workingHoursStart)}
                >
                  +
                </Button>
              </div>

              {holiday && (
                <Badge variant="outline" className="mb-1 w-full justify-center border-violet-200 bg-violet-50 text-[10px] text-violet-800">
                  {holiday.name}
                </Badge>
              )}

              <div className="space-y-1">
                {entries.length === 0 ? (
                  <p className="py-3 text-center text-[11px] text-muted-foreground">—</p>
                ) : (
                  entries.map((entry) => <EntryChip entry={entry} key={entry.id} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── day ─────────────────────────────────────────────────────────────────────────────────────── */

function DayList({
  date,
  entries,
  settings,
  today,
  onPickSlot,
}: {
  date: string;
  entries: CalendarEntry[];
  settings: OfficeHubSettings;
  today: string;
  onPickSlot?: (date: string, time?: string) => void;
}) {
  const holiday = holidayOn(date, settings);

  /** Hour rows across the configured working day, plus any hour a meeting actually falls in. */
  const hours = useMemo(() => {
    const startHour = Math.floor((clockToMinutes(settings.workingHoursStart) ?? 540) / 60);
    const endHour = Math.ceil((clockToMinutes(settings.workingHoursEnd) ?? 1110) / 60);
    const range = new Set<number>();
    for (let hour = startHour; hour <= endHour; hour += 1) range.add(hour);
    for (const entry of entries) {
      const minutes = clockToMinutes(entry.startTime ?? '');
      if (minutes != null) range.add(Math.floor(minutes / 60));
    }
    return [...range].sort((a, b) => a - b);
  }, [entries, settings.workingHoursStart, settings.workingHoursEnd]);

  const undated = entries.filter((entry) => !entry.startTime);

  return (
    <div className="space-y-2">
      {holiday && (
        <Card className="border-violet-200 bg-violet-50/70">
          <CardContent className="flex items-center gap-2 px-4 py-2.5">
            <PartyPopper className="h-4 w-4 text-violet-600" />
            <p className="text-sm font-medium text-violet-900">{holiday.name}</p>
          </CardContent>
        </Card>
      )}

      {undated.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Due today</p>
            {undated.map((entry) => (
              <EntryChip entry={entry} key={entry.id} />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border bg-white">
        {hours.map((hour) => {
          const label = formatClockTime(`${String(hour).padStart(2, '0')}:00`);
          const inHour = entries.filter((entry) => {
            const minutes = clockToMinutes(entry.startTime ?? '');
            return minutes != null && Math.floor(minutes / 60) === hour;
          });
          return (
            <div key={hour} className="flex border-b last:border-b-0">
              <div className="w-20 shrink-0 border-r bg-slate-50 px-2 py-2 text-right text-[11px] tabular-nums text-slate-500">
                {label}
              </div>
              <button
                type="button"
                className="min-h-[3rem] flex-1 space-y-1 p-1.5 text-left hover:bg-slate-50"
                onClick={() => onPickSlot?.(date, `${String(hour).padStart(2, '0')}:00`)}
                aria-label={`Schedule a meeting at ${label} on ${formatIsoDate(date)}`}
              >
                {inHour.map((entry) => (
                  <EntryChip entry={entry} key={entry.id} />
                ))}
              </button>
            </div>
          );
        })}
      </div>

      {entries.length === 0 && (
        <OfficeHubEmptyState
          icon={CalendarDays}
          title={date === today ? 'No meetings scheduled for today.' : 'Nothing on this day.'}
          description="Click an hour to schedule something."
        />
      )}
    </div>
  );
}

/* ── agenda ──────────────────────────────────────────────────────────────────────────────────── */

function AgendaList({
  anchorDate,
  byDate,
  settings,
  today,
}: {
  anchorDate: string;
  byDate: Map<string, CalendarEntry[]>;
  settings: OfficeHubSettings;
  today: string;
}) {
  const days = Array.from({ length: 14 }, (_, index) => addDays(anchorDate, index)).filter(
    (date) => (byDate.get(date) ?? []).length > 0,
  );

  if (!days.length) {
    return (
      <OfficeHubEmptyState
        icon={CalendarDays}
        title="Nothing in the next fortnight."
        description={`Looked from ${formatIsoDate(anchorDate)}.`}
      />
    );
  }

  return (
    <div className="space-y-2">
      {days.map((date) => {
        const holiday = holidayOn(date, settings);
        return (
          <Card key={date}>
            <CardContent className="p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className={cn('text-sm font-semibold', date === today ? 'text-indigo-700' : 'text-slate-800')}>
                  {formatIsoDate(date, { withWeekday: true })}
                  {date === today && ' · today'}
                </p>
                {holiday && (
                  <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[11px] text-violet-800">
                    {holiday.name}
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                {(byDate.get(date) ?? []).map((entry) => (
                  <EntryChip entry={entry} key={entry.id} showTime />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── the chip ────────────────────────────────────────────────────────────────────────────────── */

function EntryChip({
  entry,
  compact,
  showTime,
}: {
  entry: CalendarEntry;
  compact?: boolean;
  showTime?: boolean;
}) {
  const Icon = entry.kind === 'task' ? ListTodo : entry.kind === 'holiday' ? PartyPopper : CalendarDays;
  const live = entry.meeting ? meetingTimeState(entry.meeting) === 'live' : false;

  const body = (
    <span
      className={cn(
        'flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5',
        compact ? 'text-[10px]' : 'text-[11px]',
        entry.tone,
      )}
      title={`${entry.title}${entry.startTime ? ` · ${entry.startTime}` : ''}${
        entry.subtitle ? ` · ${entry.subtitle}` : ''
      }`}
    >
      {live ? (
        <Radio className="h-2.5 w-2.5 shrink-0 animate-pulse" />
      ) : entry.meeting?.mode !== 'Offline' && entry.kind === 'meeting' ? (
        <Video className="h-2.5 w-2.5 shrink-0" />
      ) : (
        <Icon className="h-2.5 w-2.5 shrink-0" />
      )}
      {entry.startTime && (showTime || compact) && (
        <span className="shrink-0 tabular-nums opacity-80">{entry.startTime}</span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
      {!compact && entry.subtitle && <span className="shrink-0 truncate opacity-70">{entry.subtitle}</span>}
    </span>
  );

  return entry.href ? (
    <Link href={entry.href} className="block min-w-0">
      {body}
    </Link>
  ) : (
    <span className="block min-w-0">{body}</span>
  );
}
