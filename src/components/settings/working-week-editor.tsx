'use client';

/**
 * Settings › Working Hours — the week's rows and the holiday list. They only draw and report
 * changes; the page loads and saves.
 */

import { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { Holiday, WorkingHours } from '@/lib/types';
import { cn } from '@/lib/utils';

export const WORK_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The week before one is saved: Monday to Friday, 09:30 to 18:30. */
export const INITIAL_SCHEDULE: WorkingHours = Object.fromEntries(
  WORK_WEEK.map((day) => [day, { isWorkDay: !['Saturday', 'Sunday'].includes(day), startTime: '09:30', endTime: '18:30' }]),
);

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number);
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : Number.NaN;
};

/** Hours from start to end, or `null` when the end is not after the start. */
export function hoursOf(start: string, end: string): number | null {
  const span = minutesOf(end) - minutesOf(start);
  return Number.isFinite(span) && span > 0 ? span / 60 : null;
}

export const hoursText = (hours: number) => `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;

/** "YYYY-MM-DD" for today in this browser — the form holiday dates are stored in. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A stored holiday date as a local date. Anything not in `yyyy-MM-dd` form is left to Date to read. */
export const dateOf = (iso: string) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return parts ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) : new Date(iso);
};

function whenText(iso: string, today: string): string {
  const days = Math.round((dateOf(iso).getTime() - dateOf(today).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  return days === -1 ? 'Yesterday' : `${-days} days ago`;
}

/** One row per day: on or off, its start and end, and its hours (from `sm`). */
export function WeekScheduleList({
  schedule,
  disabled,
  onChangeDay,
}: {
  schedule: WorkingHours;
  disabled: boolean;
  onChangeDay: (day: string, patch: Partial<WorkingHours[string]>) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {WORK_WEEK.map((day) => {
        const entry = schedule[day];
        const on = Boolean(entry?.isWorkDay);
        const hours = on ? hoursOf(entry.startTime, entry.endTime) : null;
        return (
          <li
            key={day}
            className={cn(
              'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[8rem_auto_minmax(0,1fr)_4rem]',
              !on && 'bg-muted/30',
            )}
          >
            <Label htmlFor={`work-${day}`} className={cn('font-semibold', !on && 'text-muted-foreground')}>
              {day}
            </Label>
            <div className="flex items-center gap-2 justify-self-end sm:justify-self-start">
              <span className="w-14 text-right text-xs text-muted-foreground sm:order-2 sm:text-left">{on ? 'Working' : 'Day off'}</span>
              <Switch id={`work-${day}`} checked={on} onCheckedChange={(isWorkDay) => onChangeDay(day, { isWorkDay })} disabled={disabled} />
            </div>
            <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
              <Input
                type="time"
                aria-label={`${day} start`}
                value={entry?.startTime || '09:30'}
                onChange={(event) => onChangeDay(day, { startTime: event.target.value })}
                disabled={!on || disabled}
                aria-invalid={on && hours === null}
                className="h-9 min-w-0 flex-1 sm:max-w-[8.5rem]"
              />
              <span className="text-xs text-muted-foreground" aria-hidden="true">to</span>
              <Input
                type="time"
                aria-label={`${day} end`}
                value={entry?.endTime || '18:30'}
                onChange={(event) => onChangeDay(day, { endTime: event.target.value })}
                disabled={!on || disabled}
                aria-invalid={on && hours === null}
                className="h-9 min-w-0 flex-1 sm:max-w-[8.5rem]"
              />
            </div>
            <span className={cn('hidden text-right text-sm tabular-nums sm:block', on && hours === null ? 'font-medium text-danger' : 'text-muted-foreground')}>
              {on ? (hours === null ? 'Check' : hoursText(hours)) : '—'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Holidays still to come, then the past ones folded away under a toggle. */
export function HolidayRegister({
  holidays,
  today,
  canEdit,
  onDelete,
}: {
  /** Sorted by date. */
  holidays: Holiday[];
  today: string;
  canEdit: boolean;
  onDelete: (holiday: Holiday) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const upcoming = holidays.filter((holiday) => holiday.date >= today);
  const past = holidays.filter((holiday) => holiday.date < today).reverse();
  return (
    <div className="border-t">
      {upcoming.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No holidays ahead.{canEdit ? ' Add the year’s holidays to plan around them.' : ''}</p>
      )}
      <HolidayList holidays={upcoming} today={today} canEdit={canEdit} onDelete={onDelete} />
      {past.length > 0 && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowPast((value) => !value)}
            aria-expanded={showPast}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            Past holidays ({past.length})
            <ChevronDown className={cn('h-4 w-4 transition-transform', showPast && 'rotate-180')} aria-hidden="true" />
          </button>
          {showPast && <HolidayList holidays={past} today={today} canEdit={canEdit} onDelete={onDelete} muted />}
        </div>
      )}
    </div>
  );
}

function HolidayList({
  holidays,
  today,
  canEdit,
  onDelete,
  muted = false,
}: {
  holidays: Holiday[];
  today: string;
  canEdit: boolean;
  onDelete: (holiday: Holiday) => void;
  muted?: boolean;
}) {
  if (!holidays.length) return null;
  return (
    <ul className="divide-y">
      {holidays.map((holiday) => {
        const date = dateOf(holiday.date);
        return (
          <li key={holiday.id} className={cn('flex items-center gap-3 px-4 py-2.5', muted && 'text-muted-foreground')}>
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border text-center leading-none',
                muted ? 'bg-muted/40' : 'border-primary/20 bg-primary/5 text-primary',
              )}
              aria-hidden="true"
            >
              <span className="text-[10px] font-semibold uppercase">{date.toLocaleDateString('en-IN', { month: 'short' })}</span>
              <span className="text-sm font-bold">{date.getDate()}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-medium', !muted && 'text-foreground')}>{holiday.name}</p>
              <p className="text-xs text-muted-foreground">
                {date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {whenText(holiday.date, today)}
              </p>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onDelete(holiday)} aria-label={`Remove ${holiday.name}`} title="Remove">
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
