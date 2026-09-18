'use client';

/**
 * The recurrence and reminder editors (§11, §12).
 *
 * Both are controlled components over the stored shapes — `MeetingRecurrence` and a
 * `ReminderOffsetMinutes[]` — so the meeting form holds one piece of state per concept and the
 * service receives exactly what the model defines.
 *
 * The recurrence editor's one non-obvious feature is the sentence under it. A rule assembled from
 * four dropdowns is very easy to get subtly wrong and almost impossible to check by re-reading the
 * dropdowns, so `describeRecurrence` renders it back in words ("Every 2 weeks on Monday, Wednesday,
 * until 31 Dec 2026") and the first few dates it will actually produce. That preview has caught
 * more mistakes than any validation rule could.
 */

import { useMemo } from 'react';
import { Bell, CalendarClock, Repeat } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DEFAULT_REMINDER_CHOICES,
  OFFICE_HUB_WEEKDAYS,
  RECURRENCE_FREQUENCIES,
  describeRecurrence,
  expandRecurrence,
  formatIsoDate,
  normalizeRecurrence,
  type MeetingRecurrence,
  type RecurrenceFrequency,
} from '@/lib/office-hub';
import { DateField } from './selectors';

export function RecurrenceEditor({
  value,
  startDate,
  onChange,
}: {
  value: MeetingRecurrence;
  startDate: string;
  onChange: (next: MeetingRecurrence) => void;
}) {
  const normalized = useMemo(() => normalizeRecurrence(value, startDate), [value, startDate]);

  /** The first few dates the rule will actually produce — the preview that catches mistakes. */
  const preview = useMemo(() => {
    if (normalized.frequency === 'None') return [];
    try {
      return expandRecurrence(normalized, startDate, { limit: 6 });
    } catch {
      return [];
    }
  }, [normalized, startDate]);

  const set = (patch: Partial<MeetingRecurrence>) => onChange({ ...value, ...patch });

  const toggleWeekday = (day: number) => {
    const current = normalized.weekdays ?? [];
    const next = current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort();
    // Never empty: a weekly rule with no weekday selects nothing and would silently produce a
    // one-occurrence "series".
    set({ weekdays: next.length ? next : current });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block text-xs">Repeats</Label>
        <Select
          value={value.frequency}
          onValueChange={(next) =>
            onChange(normalizeRecurrence({ ...value, frequency: next as RecurrenceFrequency }, startDate))
          }
        >
          <SelectTrigger className="bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECURRENCE_FREQUENCIES.map((frequency) => (
              <SelectItem key={frequency} value={frequency}>
                {frequency === 'None' ? 'Does not repeat' : frequency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {normalized.frequency !== 'None' && (
        <>
          <div className="flex items-end gap-2">
            <div className="w-24">
              <Label className="mb-1 block text-xs">Every</Label>
              <Input
                type="number"
                min={1}
                max={52}
                value={normalized.interval}
                onChange={(event) => set({ interval: Math.max(1, Number(event.target.value) || 1) })}
                className="bg-white"
                aria-label="Repeat interval"
              />
            </div>
            <p className="pb-2 text-sm text-muted-foreground">
              {normalized.frequency === 'Daily' || normalized.frequency === 'Custom'
                ? normalized.interval === 1 ? 'day' : 'days'
                : normalized.frequency === 'Weekly'
                  ? normalized.interval === 1 ? 'week' : 'weeks'
                  : normalized.frequency === 'Monthly'
                    ? normalized.interval === 1 ? 'month' : 'months'
                    : normalized.interval === 1 ? 'year' : 'years'}
            </p>
          </div>

          {(normalized.frequency === 'Weekly' || normalized.frequency === 'Custom') && (
            <div>
              <Label className="mb-1 block text-xs">On these days</Label>
              <div className="flex flex-wrap gap-1">
                {OFFICE_HUB_WEEKDAYS.map((weekday) => {
                  const active = (normalized.weekdays ?? []).includes(weekday.index);
                  return (
                    <Button
                      key={weekday.index}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      className={cn('h-8 w-11 px-0 text-xs', !active && 'bg-white')}
                      aria-pressed={active}
                      onClick={() => toggleWeekday(weekday.index)}
                    >
                      {weekday.short}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {normalized.frequency === 'Monthly' && (
            <div className="space-y-2">
              <RadioGroup
                value={normalized.monthlyMode ?? 'day-of-month'}
                onValueChange={(next) => set({ monthlyMode: next as MeetingRecurrence['monthlyMode'] })}
                className="space-y-2"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="day-of-month" id="monthly-date" />
                  <Label htmlFor="monthly-date" className="flex items-center gap-2 text-sm font-normal">
                    On day
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      value={normalized.dayOfMonth ?? 1}
                      onChange={(event) =>
                        set({
                          monthlyMode: 'day-of-month',
                          dayOfMonth: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                        })
                      }
                      className="h-8 w-16 bg-white"
                      aria-label="Day of the month"
                    />
                    of the month
                  </Label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RadioGroupItem value="weekday-of-month" id="monthly-weekday" />
                  <Label htmlFor="monthly-weekday" className="flex flex-wrap items-center gap-2 text-sm font-normal">
                    On the
                    <Select
                      value={String(normalized.weekdayOrdinal ?? 1)}
                      onValueChange={(next) =>
                        set({ monthlyMode: 'weekday-of-month', weekdayOrdinal: Number(next) })
                      }
                    >
                      <SelectTrigger className="h-8 w-28 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">first</SelectItem>
                        <SelectItem value="2">second</SelectItem>
                        <SelectItem value="3">third</SelectItem>
                        <SelectItem value="4">fourth</SelectItem>
                        <SelectItem value="-1">last</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(normalized.weekday ?? 1)}
                      onValueChange={(next) => set({ monthlyMode: 'weekday-of-month', weekday: Number(next) })}
                    >
                      <SelectTrigger className="h-8 w-32 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {OFFICE_HUB_WEEKDAYS.map((weekday) => (
                          <SelectItem key={weekday.index} value={String(weekday.index)}>
                            {weekday.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-[11px] text-muted-foreground">
                &ldquo;Last&rdquo; tracks the real last occurrence, so a month with five Fridays still meets on the fifth.
              </p>
            </div>
          )}

          <div>
            <Label className="mb-1 block text-xs">Ends</Label>
            <RadioGroup
              value={normalized.endMode}
              onValueChange={(next) => set({ endMode: next as MeetingRecurrence['endMode'] })}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="never" id="ends-never" />
                <Label htmlFor="ends-never" className="text-sm font-normal">
                  Never
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="after-occurrences" id="ends-count" />
                <Label htmlFor="ends-count" className="flex items-center gap-2 text-sm font-normal">
                  After
                  <Input
                    type="number"
                    min={1}
                    max={260}
                    value={normalized.occurrences ?? 10}
                    onChange={(event) =>
                      set({
                        endMode: 'after-occurrences',
                        occurrences: Math.max(1, Math.min(260, Number(event.target.value) || 1)),
                      })
                    }
                    className="h-8 w-20 bg-white"
                    aria-label="Number of occurrences"
                  />
                  meetings
                </Label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <RadioGroupItem value="on-date" id="ends-date" />
                <Label htmlFor="ends-date" className="text-sm font-normal">
                  On
                </Label>
                <DateField
                  value={normalized.endDate ?? null}
                  min={startDate}
                  onChange={(next) => set({ endMode: 'on-date', endDate: next ?? undefined })}
                  className="w-40"
                />
              </div>
            </RadioGroup>
          </div>

          <div className="rounded-lg border border-sky-100 bg-sky-50/60 p-3">
            <p className="flex items-start gap-2 text-xs font-semibold text-sky-900">
              <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {describeRecurrence(normalized, startDate)}
            </p>
            {preview.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {preview.map((occurrence) => (
                  <Badge key={occurrence.occurrenceKey} variant="outline" className="border-sky-200 bg-white text-[11px] font-normal">
                    {formatIsoDate(occurrence.date, { withWeekday: true, year: false })}
                  </Badge>
                ))}
                {normalized.endMode !== 'after-occurrences' && (
                  <Badge variant="outline" className="border-sky-200 bg-white text-[11px] font-normal">
                    …
                  </Badge>
                )}
              </div>
            )}
            <p className="mt-2 text-[11px] text-sky-900/70">
              Instances are created up to twelve weeks ahead and topped up automatically, so an
              open-ended series never runs out.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Which reminders this meeting sends (§12).
 *
 * Multiple reminders are the norm — a day before to plan around, fifteen minutes before to walk to
 * the room — so this is a set of toggles rather than a single choice. Empty means "use each
 * participant's own default", which is said in as many words rather than left to be inferred from
 * an empty list.
 */
export function ReminderEditor({
  value,
  onChange,
  defaults,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  /** The office default, shown when nothing is selected. */
  defaults?: number[];
}) {
  const toggle = (minutes: number) => {
    onChange(value.includes(minutes) ? value.filter((entry) => entry !== minutes) : [...value, minutes]);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {DEFAULT_REMINDER_CHOICES.map((choice) => {
          const active = value.includes(choice.minutes);
          return (
            <Button
              key={choice.minutes}
              type="button"
              size="sm"
              variant={active ? 'default' : 'outline'}
              aria-pressed={active}
              className={cn('h-8 gap-1.5 text-xs', !active && 'bg-white')}
              onClick={() => toggle(choice.minutes)}
            >
              <Bell className="h-3.5 w-3.5" />
              {choice.label}
            </Button>
          );
        })}
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" />
        {value.length === 0
          ? `No reminder chosen — each participant's own default applies${
              defaults?.length ? ` (currently ${defaults.join(', ')} minutes before)` : ''
            }.`
          : 'Reminders are sent by the server, so they arrive whether or not anyone has the app open.'}
      </p>
    </div>
  );
}
