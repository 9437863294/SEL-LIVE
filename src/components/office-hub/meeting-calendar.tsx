'use client';

/**
 * The calendar's views (§8; redesigned 2026-11-06 from the user's mockup): month, week, day,
 * agenda, and the mini month in the side rail.
 *
 * Every meeting is drawn by *my* state on it (`calendarMeetingState`): solid for going, striped
 * with a dashed edge for waiting on my reply, greyed and struck through for declined or cancelled.
 * State rather than meeting type decides the look, because the types are configurable and can
 * outnumber any set of colours a person can tell apart; state is what a calendar is read for.
 *
 * ── Drag to reschedule ─────────────────────────────────────────────────────────────────────────
 *
 * Month view only: each day cell is a drop target, and a drop moves the meeting to that date keeping
 * its time, through `updateMeeting` (participants notified, reminders rebuilt). Not offered on the
 * time grids, where a drop would imply a new time too and a near-miss would silently move a meeting
 * by half an hour. Without the capability no drag context is mounted at all.
 */

import { useMemo, useRef, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, PartyPopper, Plus, Radio, Repeat, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  DraggableProvided,
  DraggableStateSnapshot,
  DropResult,
  DroppableProvided,
  DroppableStateSnapshot,
} from '@hello-pangea/dnd';
import {
  OFFICE_HUB_WEEKDAYS,
  addDays,
  clockToMinutes,
  formatClockTime,
  formatIsoDate,
  isWorkingDay,
  layoutDayColumns,
  minutesToClock,
  monthGridDays,
  weekdayOf,
  type CalendarMeetingState,
  type OfficeHubMeeting,
  type OfficeHubSettings,
  type OfficeHubTask,
} from '@/lib/office-hub';

const DragDropContext = dynamic(() => import('@hello-pangea/dnd').then((module) => module.DragDropContext), { ssr: false });
const Droppable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Droppable), { ssr: false });
const Draggable = dynamic(() => import('@hello-pangea/dnd').then((module) => module.Draggable), { ssr: false });

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type CalendarItem =
  | {
      kind: 'meeting';
      id: string;
      date: string;
      title: string;
      start: number;
      end: number;
      meeting: OfficeHubMeeting;
      state: CalendarMeetingState;
      live: boolean;
      draggable: boolean;
    }
  | {
      kind: 'task';
      id: string;
      date: string;
      title: string;
      task: OfficeHubTask;
      state: 'due' | 'late' | 'done';
    };

export interface CalendarHoliday {
  date: string;
  name: string;
}

export function monthTitle(anchor: string): string {
  return `${MONTHS_LONG[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
}

/* ── chips ───────────────────────────────────────────────────────────────────────────────────── */

const MEETING_CHIP: Record<CalendarMeetingState, string> = {
  going: 'border-l-primary bg-primary/10',
  pending: 'oh-cal-pending border-dashed border-l-primary bg-card',
  declined: 'border-l-muted-foreground/40 bg-muted/70 text-muted-foreground',
  cancelled: 'border-l-muted-foreground/40 bg-muted/70 text-muted-foreground',
  draft: 'border-dotted border-l-muted-foreground/60 bg-muted/40 text-muted-foreground',
  other: 'border-l-sky-600 bg-sky-500/10',
};

export function meetingChipClass(item: Extract<CalendarItem, { kind: 'meeting' }>): string {
  if (item.live && item.state !== 'cancelled') return 'border-l-emerald-600 bg-emerald-500/15';
  return MEETING_CHIP[item.state];
}

function struck(state: CalendarMeetingState): boolean {
  return state === 'declined' || state === 'cancelled';
}

export function MeetingChip({
  item,
  onOpen,
  showTime = true,
  barOnPhone = false,
}: {
  item: Extract<CalendarItem, { kind: 'meeting' }>;
  onOpen: (item: CalendarItem) => void;
  showTime?: boolean;
  /** In a month cell a phone has room for a coloured bar, not a title; tapping the day shows them. */
  barOnPhone?: boolean;
}) {
  const online = item.meeting.mode !== 'Offline';
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      title={`${item.meeting.startTime} ${item.title}${item.state === 'pending' ? ' · waiting for your reply' : item.state === 'declined' ? ' · you declined' : item.state === 'cancelled' ? ' · cancelled' : ''}`}
      aria-label={`${item.meeting.startTime} ${item.title}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 rounded-[7px] border-0 border-l-[3px] px-1.5 py-[3px] text-left text-[11.5px] font-bold leading-tight transition-shadow hover:shadow-sm',
        meetingChipClass(item),
        barOnPhone && 'max-sm:h-[7px] max-sm:rounded-full max-sm:p-0',
      )}
    >
      {item.live ? <Radio className={cn('h-2.5 w-2.5 shrink-0 animate-pulse text-emerald-600', barOnPhone && 'max-sm:hidden')} aria-hidden /> : null}
      {showTime && <span className="hidden shrink-0 text-[10.5px] font-semibold opacity-75 sm:inline">{item.meeting.startTime}</span>}
      <span className={cn('min-w-0 flex-1 truncate', struck(item.state) && 'line-through decoration-muted-foreground/60', barOnPhone && 'max-sm:hidden')}>
        {item.state === 'draft' ? 'Draft · ' : ''}
        {item.title}
      </span>
      {online && !item.live && <Video className="hidden h-2.5 w-2.5 shrink-0 opacity-60 sm:block" aria-hidden />}
    </button>
  );
}

export function TaskChip({
  item,
  onOpen,
  barOnPhone = false,
}: {
  item: Extract<CalendarItem, { kind: 'task' }>;
  onOpen: (item: CalendarItem) => void;
  barOnPhone?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      title={`Task deadline: ${item.title}${item.state === 'late' ? ' · overdue' : item.state === 'done' ? ' · done' : ''}`}
      aria-label={`Task deadline: ${item.title}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-[7px] px-1 py-[3px] text-left text-[11.5px] font-bold leading-tight hover:bg-muted/60',
        item.state === 'late' ? 'text-rose-700 dark:text-rose-300' : item.state === 'done' ? 'text-muted-foreground' : 'text-amber-800 dark:text-amber-300',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-[9px] w-[9px] shrink-0 rounded-[3px] border-2',
          item.state === 'late' ? 'border-rose-600' : 'border-amber-500',
          item.state === 'done' && 'bg-amber-500',
        )}
      />
      <span className={cn('min-w-0 flex-1 truncate', item.state === 'done' && 'line-through', barOnPhone && 'max-sm:hidden')}>{item.title}</span>
    </button>
  );
}

function ItemChip({
  item,
  onOpen,
  showTime,
  barOnPhone,
}: {
  item: CalendarItem;
  onOpen: (item: CalendarItem) => void;
  showTime?: boolean;
  barOnPhone?: boolean;
}) {
  return item.kind === 'meeting' ? (
    <MeetingChip item={item} onOpen={onOpen} showTime={showTime} barOnPhone={barOnPhone} />
  ) : (
    <TaskChip item={item} onOpen={onOpen} barOnPhone={barOnPhone} />
  );
}

export function HolidayChip({ name }: { name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-[7px] border-0 border-l-[3px] border-l-pink-500 bg-pink-500/10 px-1.5 py-[3px] text-[11px] font-bold text-pink-800 dark:text-pink-200">
      <PartyPopper className="h-2.5 w-2.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </div>
  );
}

/* ── month ───────────────────────────────────────────────────────────────────────────────────── */

export function MonthView({
  anchor,
  byDate,
  holidays,
  settings,
  today,
  onOpen,
  onShowDay,
  onPickSlot,
  onReschedule,
}: {
  anchor: string;
  byDate: ReadonlyMap<string, CalendarItem[]>;
  holidays: ReadonlyMap<string, CalendarHoliday>;
  settings: OfficeHubSettings;
  today: string;
  onOpen: (item: CalendarItem) => void;
  onShowDay: (date: string) => void;
  onPickSlot?: (date: string, time?: string) => void;
  onReschedule?: (meeting: OfficeHubMeeting, toDate: string) => void;
}) {
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const monthPrefix = anchor.slice(0, 7);

  const cell = (date: string, position: number, drop?: { provided: DroppableProvided; snapshot: DroppableStateSnapshot }) => {
    const items = byDate.get(date) ?? [];
    const holiday = holidays.get(date);
    const inMonth = date.startsWith(monthPrefix);
    const working = isWorkingDay(date, settings);
    const shown = items.slice(0, 3);
    return (
      <div
        key={date}
        ref={drop?.provided.innerRef}
        {...(drop?.provided.droppableProps ?? {})}
        className={cn(
          'group relative min-h-[84px] min-w-0 border-b px-1.5 pb-2 pt-1.5 transition-colors sm:min-h-[118px]',
          position % 7 !== 6 && 'border-r',
          !inMonth && 'bg-muted/40',
          inMonth && !working && 'bg-primary/[0.025]',
          holiday && inMonth && 'bg-pink-500/[0.06]',
          date === today && 'bg-primary/[0.07]',
          drop?.snapshot.isDraggingOver && 'bg-primary/15 outline-dashed outline-2 -outline-offset-[3px] outline-primary/50',
        )}
      >
        <div className="mb-1 flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onShowDay(date)}
            aria-label={`Open ${formatIsoDate(date, { withWeekday: true })}`}
            className={cn(
              'grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg text-[12.5px] font-extrabold tabular-nums hover:bg-muted',
              date === today && 'bg-gradient-to-br from-primary to-indigo-600 text-white shadow-md hover:bg-primary',
              date !== today && !inMonth && 'text-muted-foreground/50',
              date !== today && inMonth && date < today && 'text-muted-foreground',
            )}
          >
            {Number(date.slice(8, 10))}
          </button>
          {holiday && (
            <span className="min-w-0 truncate text-[10.5px] font-extrabold text-pink-700 dark:text-pink-300" title={holiday.name}>
              {holiday.name}
            </span>
          )}
          {onPickSlot && (
            <button
              type="button"
              onClick={() => onPickSlot(date)}
              title="Schedule on this day"
              aria-label={`Schedule a meeting on ${formatIsoDate(date)}`}
              className="ml-auto grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] bg-muted text-primary opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        <div className="space-y-[3px]">
          {shown.map((item, index) =>
            drop && item.kind === 'meeting' && item.draggable ? (
              <Draggable draggableId={item.id} index={index} key={item.id}>
                {(dragProvided: DraggableProvided, dragSnapshot: DraggableStateSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    className={cn('cursor-grab', dragSnapshot.isDragging && 'opacity-80')}
                  >
                    <ItemChip item={item} onOpen={onOpen} barOnPhone />
                  </div>
                )}
              </Draggable>
            ) : (
              <ItemChip key={item.id} item={item} onOpen={onOpen} barOnPhone />
            ),
          )}
          {items.length > 3 && (
            <button type="button" onClick={() => onShowDay(date)} className="pl-1 text-[11px] font-bold text-primary hover:underline">
              +{items.length - 3} more
            </button>
          )}
        </div>
        {drop?.provided.placeholder}
      </div>
    );
  };

  const grid = (
    <div>
      <div className="grid grid-cols-7 border-b">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div
            key={weekday}
            className={cn(
              'px-2 py-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground',
              !settings.workingDays.includes(weekday) && 'text-primary/70',
            )}
          >
            {OFFICE_HUB_WEEKDAYS[weekday].short}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((date, position) =>
          onReschedule ? (
            <Droppable droppableId={date} key={date}>
              {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => cell(date, position, { provided, snapshot })}
            </Droppable>
          ) : (
            cell(date, position)
          ),
        )}
      </div>
    </div>
  );

  if (!onReschedule) return grid;
  return (
    <DragDropContext
      onDragEnd={(result: DropResult) => {
        if (!result.destination) return;
        const toDate = result.destination.droppableId;
        const item = (byDate.get(result.source.droppableId) ?? []).find((candidate) => candidate.id === result.draggableId);
        if (item?.kind !== 'meeting' || item.meeting.date === toDate) return;
        onReschedule(item.meeting, toDate);
      }}
    >
      {grid}
    </DragDropContext>
  );
}

/* ── week & day ──────────────────────────────────────────────────────────────────────────────── */

const HOUR_PX = 46;

export function TimeGridView({
  days,
  byDate,
  holidays,
  settings,
  today,
  nowMinute,
  onOpen,
  onPickSlot,
}: {
  days: readonly string[];
  byDate: ReadonlyMap<string, CalendarItem[]>;
  holidays: ReadonlyMap<string, CalendarHoliday>;
  settings: OfficeHubSettings;
  today: string;
  nowMinute: number | null;
  onOpen: (item: CalendarItem) => void;
  onPickSlot?: (date: string, time?: string) => void;
}) {
  const meetingsByDay = days.map((date) =>
    (byDate.get(date) ?? []).filter((item): item is Extract<CalendarItem, { kind: 'meeting' }> => item.kind === 'meeting'),
  );
  const all = meetingsByDay.flat();
  const workStart = clockToMinutes(settings.workingHoursStart) ?? 540;
  const workEnd = clockToMinutes(settings.workingHoursEnd) ?? 1080;
  const firstHour = Math.max(0, Math.min(Math.floor(workStart / 60) - 1, ...all.map((item) => Math.floor(item.start / 60))));
  const lastHour = Math.min(24, Math.max(Math.ceil(workEnd / 60) + 1, ...all.map((item) => Math.ceil(item.end / 60))));
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  const columns = { gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` };
  const top = (minute: number) => ((minute - firstHour * 60) / 60) * HOUR_PX;

  return (
    <div className="overflow-x-auto">
      <div className={cn(days.length > 1 && 'min-w-[720px]')}>
        {/* headers */}
        <div className="grid border-b" style={columns}>
          <div />
          {days.map((date) => (
            <div key={date} className="border-l px-1.5 py-2 text-center">
              <small className="block text-[10.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
                {OFFICE_HUB_WEEKDAYS[weekdayOf(date)].short}
              </small>
              <b
                className={cn(
                  'inline-block rounded-[9px] px-1.5 text-[19px] font-extrabold',
                  date === today && 'bg-gradient-to-br from-primary to-indigo-600 text-white',
                )}
              >
                {Number(date.slice(8, 10))}
              </b>
            </div>
          ))}
        </div>
        {/* all-day: holidays and task deadlines */}
        <div className="grid border-b" style={columns}>
          <div className="px-1 py-2 text-right text-[10px] font-bold text-muted-foreground">All day</div>
          {days.map((date) => {
            const holiday = holidays.get(date);
            const tasks = (byDate.get(date) ?? []).filter((item) => item.kind === 'task');
            return (
              <div key={date} className="min-h-[32px] min-w-0 space-y-[3px] border-l p-1">
                {holiday && <HolidayChip name={holiday.name} />}
                {tasks.map((item) => (
                  <ItemChip key={item.id} item={item} onOpen={onOpen} />
                ))}
              </div>
            );
          })}
        </div>
        {/* the hours */}
        <div className="grid" style={columns}>
          <div>
            {hours.map((hour, index) => (
              <div key={hour} className="h-[46px] -translate-y-[7px] pr-1.5 text-right text-[10.5px] font-bold text-muted-foreground">
                {index ? formatClockTime(`${String(hour).padStart(2, '0')}:00`, { lowercaseMeridiem: true }).replace(':00', '') : ''}
              </div>
            ))}
          </div>
          {days.map((date, dayIndex) => {
            const meetings = meetingsByDay[dayIndex];
            const layout = layoutDayColumns(meetings.map((item) => ({ id: item.id, start: item.start, end: item.end })));
            return (
              <DayColumn
                key={date}
                date={date}
                height={hours.length * HOUR_PX}
                firstHour={firstHour}
                tinted={!isWorkingDay(date, settings) || date === today}
                onPickSlot={onPickSlot}
              >
                {meetings.map((item) => {
                  const slot = layout.get(item.id) ?? { column: 0, columns: 1 };
                  const width = 100 / slot.columns;
                  const height = Math.max(((item.end - item.start) / 60) * HOUR_PX - 3, 22);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(item);
                      }}
                      className={cn(
                        'absolute overflow-hidden rounded-[9px] border-0 border-l-[3px] px-2 py-1 text-left text-[11.5px] font-bold leading-snug hover:z-10 hover:shadow-md',
                        meetingChipClass(item),
                      )}
                      style={{
                        top: top(item.start) + 1,
                        height,
                        left: `calc(${slot.column * width}% + 3px)`,
                        width: `calc(${width}% - 6px)`,
                      }}
                    >
                      {/* A solid card under the tint, so grid lines do not show through. */}
                      <span aria-hidden className="absolute inset-0 -z-10 bg-card" />
                      <b className={cn('block truncate', struck(item.state) && 'line-through')}>{item.title}</b>
                      <small className="block truncate font-semibold opacity-75">
                        {formatClockTime(item.meeting.startTime, { lowercaseMeridiem: true })} – {formatClockTime(item.meeting.endTime, { lowercaseMeridiem: true })}
                        {height > 40 ? ` · ${placeOf(item.meeting)}` : ''}
                      </small>
                    </button>
                  );
                })}
                {date === today && nowMinute != null && nowMinute >= firstHour * 60 && nowMinute <= lastHour * 60 && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-rose-600" style={{ top: top(nowMinute) }}>
                    <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-600" />
                  </div>
                )}
              </DayColumn>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One day's column: hour lines, and a click on empty space schedules at that half hour. */
function DayColumn({
  date,
  height,
  firstHour,
  tinted,
  onPickSlot,
  children,
}: {
  date: string;
  height: number;
  firstHour: number;
  tinted: boolean;
  onPickSlot?: (date: string, time?: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={cn('relative isolate border-l', tinted && 'bg-primary/[0.03]', onPickSlot && 'cursor-copy')}
      style={{
        height,
        backgroundImage: `repeating-linear-gradient(180deg, transparent 0 ${HOUR_PX - 1}px, hsl(var(--border)) ${HOUR_PX - 1}px ${HOUR_PX}px)`,
      }}
      title={onPickSlot ? 'Click an empty slot to schedule a meeting' : undefined}
      onClick={(event) => {
        if (!onPickSlot || !ref.current) return;
        const offset = event.clientY - ref.current.getBoundingClientRect().top;
        const minute = firstHour * 60 + Math.floor(((offset / HOUR_PX) * 60) / 30) * 30;
        onPickSlot(date, minutesToClock(Math.max(0, Math.min(23 * 60 + 30, minute))));
      }}
    >
      {children}
    </div>
  );
}

/* ── agenda ──────────────────────────────────────────────────────────────────────────────────── */

export function AgendaView({
  anchor,
  byDate,
  holidays,
  today,
  onOpen,
}: {
  anchor: string;
  byDate: ReadonlyMap<string, CalendarItem[]>;
  holidays: ReadonlyMap<string, CalendarHoliday>;
  today: string;
  onOpen: (item: CalendarItem) => void;
}) {
  const days = Array.from({ length: 31 }, (_, index) => addDays(anchor, index)).filter(
    (date) => (byDate.get(date) ?? []).length > 0 || holidays.has(date),
  );
  if (!days.length) {
    return (
      <div className="m-4 rounded-2xl bg-gradient-to-r from-primary/10 to-blue-500/10 px-4 py-3 text-sm">
        <b className="block">Nothing in the next 31 days</b>
        <span className="text-muted-foreground">Looked from {formatIsoDate(anchor, { withWeekday: true })}.</span>
      </div>
    );
  }
  return (
    <div className="px-3 pb-4 pt-1 sm:px-5">
      {days.map((date) => {
        const holiday = holidays.get(date);
        return (
          <div key={date} className="grid grid-cols-1 gap-2 border-b py-3 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-4">
            <div>
              <b className={cn('block text-[22px] font-extrabold leading-none', date === today && 'text-primary')}>{Number(date.slice(8, 10))}</b>
              <small className="text-[11.5px] font-bold text-muted-foreground">
                {OFFICE_HUB_WEEKDAYS[weekdayOf(date)].name}
                <span className="hidden sm:inline">
                  <br />
                </span>
                <span className="sm:hidden"> · </span>
                {formatIsoDate(date, { year: true }).replace(/^\d+ /, '')}
              </small>
            </div>
            <div className="min-w-0 space-y-1">
              {holiday && (
                <AgendaRow tone="holiday" time="All day" title={holiday.name} detail="Holiday" />
              )}
              {(byDate.get(date) ?? []).map((item) =>
                item.kind === 'task' ? (
                  <AgendaRow
                    key={item.id}
                    tone="task"
                    time="Deadline"
                    title={item.title}
                    detail={`Task${item.task.assigneeName ? ` · ${item.task.assigneeName}` : ''}`}
                    chip={item.state === 'late' ? 'Overdue' : item.state === 'done' ? 'Done' : 'Due'}
                    onClick={() => onOpen(item)}
                  />
                ) : (
                  <AgendaRow
                    key={item.id}
                    tone={item.state}
                    time={formatClockTime(item.meeting.startTime, { lowercaseMeridiem: true })}
                    sub={`${Math.round(item.end - item.start)} min`}
                    title={item.title}
                    detail={`${placeOf(item.meeting)} · organised by ${item.meeting.organizerName}`}
                    repeats={Boolean(item.meeting.seriesId)}
                    chip={STATE_LABEL[item.state]}
                    onClick={() => onOpen(item)}
                  />
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const STATE_LABEL: Record<CalendarMeetingState, string> = {
  going: 'Going',
  pending: 'Reply needed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  draft: 'Draft',
  other: 'Scheduled',
};

const STATE_CHIP: Record<string, string> = {
  going: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-800',
  declined: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  draft: 'bg-muted text-muted-foreground',
  other: 'bg-sky-100 text-sky-700',
  Overdue: 'bg-rose-100 text-rose-700',
  Done: 'bg-emerald-100 text-emerald-700',
  Due: 'bg-amber-100 text-amber-800',
  holiday: 'bg-pink-100 text-pink-700',
};

function AgendaRow({
  tone,
  time,
  sub,
  title,
  detail,
  chip,
  repeats,
  onClick,
}: {
  tone: CalendarMeetingState | 'task' | 'holiday';
  time: string;
  sub?: string;
  title: string;
  detail: string;
  chip?: string;
  repeats?: boolean;
  onClick?: () => void;
}) {
  const edge =
    tone === 'holiday'
      ? 'border-l-pink-500 bg-pink-500/[0.07]'
      : tone === 'task'
        ? 'border-l-amber-500 bg-amber-500/[0.07]'
        : tone === 'pending'
          ? 'oh-cal-pending border-dashed border-l-primary'
          : tone === 'declined' || tone === 'cancelled' || tone === 'draft'
            ? 'border-l-muted-foreground/40 bg-muted/50 text-muted-foreground'
            : tone === 'other'
              ? 'border-l-sky-600 bg-sky-500/[0.07]'
              : 'border-l-primary bg-primary/[0.07]';
  const chipKey = tone === 'task' ? chip ?? 'Due' : tone === 'holiday' ? 'holiday' : tone;
  const className = cn(
    'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border-0 border-l-[3px] px-3 py-2 text-left sm:grid-cols-[96px_minmax(0,1fr)_auto]',
    edge,
    onClick && 'hover:shadow-sm',
  );
  const body = (
    <>
      <div className="col-span-2 text-xs font-bold sm:col-span-1">
        {time}
        {sub && <small className="ml-1 font-semibold text-muted-foreground sm:ml-0 sm:block">{sub}</small>}
      </div>
      <div className="min-w-0">
        <b className={cn('block truncate text-[13px]', (tone === 'declined' || tone === 'cancelled') && 'line-through')}>{title}</b>
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
          <span className="truncate">{detail}</span>
          {repeats && <Repeat className="h-3 w-3 shrink-0" aria-label="Repeats" />}
        </span>
      </div>
      {chip && (
        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-bold', STATE_CHIP[chipKey] ?? STATE_CHIP.Due)}>{chip}</span>
      )}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/* ── mini month ──────────────────────────────────────────────────────────────────────────────── */

export function MiniMonth({
  anchor,
  selected,
  today,
  marks,
  holidays,
  settings,
  onPick,
  onStep,
}: {
  anchor: string;
  selected: string;
  today: string;
  marks: ReadonlyMap<string, { meeting: boolean; task: boolean }>;
  holidays: ReadonlyMap<string, CalendarHoliday>;
  settings: OfficeHubSettings;
  onPick: (date: string) => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const prefix = anchor.slice(0, 7);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <button type="button" onClick={() => onStep(-1)} aria-label="Previous month" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <b className="text-[13.5px]">{monthTitle(anchor)}</b>
        <button type="button" onClick={() => onStep(1)} aria-label="Next month" className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div key={weekday} className="py-0.5 text-[10px] font-extrabold text-muted-foreground">
            {OFFICE_HUB_WEEKDAYS[weekday].short.slice(0, 1)}
          </div>
        ))}
        {days.map((date) => {
          const mark = marks.get(date);
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              onClick={() => onPick(date)}
              aria-label={formatIsoDate(date, { withWeekday: true })}
              className={cn(
                'relative h-[30px] rounded-lg text-[11.5px] font-semibold tabular-nums hover:bg-muted',
                !date.startsWith(prefix) && 'text-muted-foreground/40',
                date.startsWith(prefix) && !isWorkingDay(date, settings) && 'text-muted-foreground',
                date === selected && !isToday && 'bg-primary/15 font-extrabold text-primary',
                isToday && 'bg-gradient-to-br from-primary to-indigo-600 font-extrabold text-white hover:bg-primary',
                holidays.has(date) && !isToday && 'ring-[1.5px] ring-inset ring-pink-300',
              )}
            >
              {Number(date.slice(8, 10))}
              {mark && (mark.meeting || mark.task) && (
                <i aria-hidden className="absolute bottom-[3px] left-1/2 flex -translate-x-1/2 gap-0.5">
                  {mark.meeting && <em className={cn('h-1 w-1 rounded-full', isToday ? 'bg-white' : 'bg-primary')} />}
                  {mark.task && <em className={cn('h-1 w-1 rounded-full', isToday ? 'bg-white' : 'bg-amber-500')} />}
                </i>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function placeOf(meeting: Pick<OfficeHubMeeting, 'mode' | 'room' | 'location' | 'onlinePlatform'>): string {
  if (meeting.mode === 'Online') return meeting.onlinePlatform ?? 'Online';
  const place = [meeting.room, meeting.location].map((part) => part?.trim()).filter(Boolean).join(', ');
  if (meeting.mode === 'Hybrid') return place ? `${place} + online` : 'Hybrid';
  return place || 'Place to be confirmed';
}
