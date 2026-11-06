'use client';

/**
 * The recurrence and reminder editors (§11, §12).
 *
 * Both are controlled components over the stored shapes — `MeetingRecurrence` and a
 * `ReminderOffsetMinutes[]` — so the meeting form holds one piece of state per concept and the
 * service receives exactly what the model defines.
 *
 * ── The "Repeats" builder (redesigned 2026-11-06 from the user's mockup) ────────────────────────
 *
 * Pattern on one side, every date it produces on the other. A rule assembled from controls is easy
 * to get subtly wrong and nearly impossible to check by re-reading the controls, so the preview is
 * the point: a two-month calendar and a list, where any date can be skipped or restored with a
 * click (`exceptions`), holidays are ringed, and "Skip company holidays" writes those dates into
 * `exceptions` too (`withHolidaySkips`). Nothing here needs a field the model does not have.
 *
 * The tiles are the way people think ("daily, weekdays only"); the stored rule is what the expander
 * runs ("weekly, Monday to Friday"). The editor keeps which tile was picked in its own state, so the
 * two can differ without the screen jumping between them.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  Repeat,
  SlidersHorizontal,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  DEFAULT_REMINDER_CHOICES,
  NO_RECURRENCE,
  OFFICE_HUB_WEEKDAYS,
  addMonths,
  describeRecurrence,
  endDatePresets,
  formatHours,
  formatIsoDate,
  holidaySkipsActive,
  monthGridDays,
  normalizeRecurrence,
  repeatPreview,
  repeatWarnings,
  startOfMonth,
  toggleSkip,
  weekdayOf,
  withHolidaySkips,
  type IsoDate,
  type MeetingRecurrence,
} from '@/lib/office-hub';

type Tile = 'None' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly' | 'Custom';
type DailyDays = 'all' | 'weekdays' | 'mon-sat';
type Unit = 'day' | 'week' | 'month' | 'year';

const TILES: { value: Tile; label: string; icon: LucideIcon }[] = [
  { value: 'None', label: 'Does not repeat', icon: CalendarDays },
  { value: 'Daily', label: 'Daily', icon: Sun },
  { value: 'Weekly', label: 'Weekly', icon: Repeat },
  { value: 'Monthly', label: 'Monthly', icon: CalendarClock },
  { value: 'Yearly', label: 'Yearly', icon: Star },
  { value: 'Custom', label: 'Custom', icon: SlidersHorizontal },
];

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];
const WEEKDAYS_MON_SAT = [1, 2, 3, 4, 5, 6];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const sameDays = (a: readonly number[] | undefined, b: readonly number[]) =>
  (a ?? []).length === b.length && b.every((day) => (a ?? []).includes(day));

function tileOf(rule: MeetingRecurrence): Tile {
  if (rule.frequency === 'None') return 'None';
  if (rule.interval === 1 && rule.frequency === 'Weekly' && (sameDays(rule.weekdays, WEEKDAYS_MON_FRI) || sameDays(rule.weekdays, WEEKDAYS_MON_SAT))) {
    return 'Daily';
  }
  if (rule.frequency === 'Custom') return 'Custom';
  return rule.frequency;
}

function dailyDaysOf(rule: MeetingRecurrence): DailyDays {
  if (sameDays(rule.weekdays, WEEKDAYS_MON_FRI)) return 'weekdays';
  if (sameDays(rule.weekdays, WEEKDAYS_MON_SAT)) return 'mon-sat';
  return 'all';
}

function unitOf(rule: MeetingRecurrence): Unit {
  if (rule.frequency === 'Daily') return 'day';
  if (rule.frequency === 'Monthly') return 'month';
  if (rule.frequency === 'Yearly') return 'year';
  return 'week';
}

export function RecurrenceEditor({
  value,
  startDate,
  onChange,
  holidays = [],
  workingDays,
  durationMinutes,
  today,
}: {
  value: MeetingRecurrence;
  startDate: string;
  onChange: (next: MeetingRecurrence) => void;
  /** Company holidays, to ring on the preview and skip if asked. */
  holidays?: readonly { date: string; name: string }[];
  /** 0 = Sunday … 6 = Saturday; days outside it draw a warning when picked. */
  workingDays?: readonly number[];
  /** For "time for each person" on the preview. */
  durationMinutes?: number;
  today?: string;
}) {
  const [tile, setTile] = useState<Tile>(() => tileOf(value));
  const [dailyDays, setDailyDays] = useState<DailyDays>(() => dailyDaysOf(value));
  const [unit, setUnit] = useState<Unit>(() => unitOf(value));
  const [skipHolidays, setSkipHolidays] = useState<boolean>(() =>
    value.frequency === 'None' ? true : holidaySkipsActive(value, startDate, holidays),
  );
  const [monthOffset, setMonthOffset] = useState(0);

  const rule = useMemo(() => normalizeRecurrence(value, startDate), [value, startDate]);
  const preview = useMemo(() => repeatPreview(rule, startDate, holidays), [rule, startDate, holidays]);
  const startWeekday = weekdayOf(startDate);
  const startDay = Number(startDate.slice(8, 10));
  const nth = Math.min(4, Math.floor((startDay - 1) / 7) + 1);

  /** Write a rule: normalised, with holiday skips kept in step. */
  const emit = (next: MeetingRecurrence, skip = skipHolidays) => {
    if (next.frequency === 'None') return onChange({ ...NO_RECURRENCE });
    onChange(withHolidaySkips(normalizeRecurrence(next, startDate), startDate, holidays, skip));
  };

  /** What the rule ends with, kept across tile changes; a brand-new series ends with the financial year. */
  const ending = (): Pick<MeetingRecurrence, 'endMode' | 'endDate' | 'occurrences' | 'exceptions'> =>
    value.frequency === 'None'
      ? { endMode: 'on-date', endDate: endDatePresets(startDate).find((preset) => preset.label.startsWith('End of FY'))?.date ?? addMonths(startDate, 6) }
      : { endMode: value.endMode, endDate: value.endDate, occurrences: value.occurrences, exceptions: value.exceptions };

  const ruleFor = (nextTile: Tile, options: { days?: DailyDays; unit?: Unit; interval?: number } = {}): MeetingRecurrence => {
    const interval = Math.max(1, options.interval ?? (value.frequency === 'None' ? 1 : value.interval));
    const base = ending();
    switch (nextTile) {
      case 'Daily': {
        const days = options.days ?? dailyDays;
        if (days === 'weekdays') return { ...base, frequency: 'Weekly', interval: 1, weekdays: WEEKDAYS_MON_FRI };
        if (days === 'mon-sat') return { ...base, frequency: 'Weekly', interval: 1, weekdays: WEEKDAYS_MON_SAT };
        return { ...base, frequency: 'Daily', interval };
      }
      case 'Weekly':
        return { ...base, frequency: 'Weekly', interval, weekdays: value.weekdays?.length ? value.weekdays : [startWeekday] };
      case 'Monthly':
        return { ...base, frequency: 'Monthly', interval, monthlyMode: value.monthlyMode ?? 'day-of-month', dayOfMonth: value.dayOfMonth, weekday: value.weekday, weekdayOrdinal: value.weekdayOrdinal };
      case 'Yearly':
        return { ...base, frequency: 'Yearly', interval };
      case 'Custom': {
        const nextUnit = options.unit ?? unit;
        if (nextUnit === 'day') return { ...base, frequency: 'Daily', interval };
        if (nextUnit === 'month') return { ...base, frequency: 'Monthly', interval, monthlyMode: value.monthlyMode ?? 'day-of-month' };
        if (nextUnit === 'year') return { ...base, frequency: 'Yearly', interval };
        return { ...base, frequency: 'Custom', interval, weekdays: value.weekdays?.length ? value.weekdays : [startWeekday] };
      }
      default:
        return { ...NO_RECURRENCE };
    }
  };

  const pickTile = (next: Tile) => {
    setTile(next);
    emit(ruleFor(next));
  };

  const changeInterval = (interval: number) => {
    const clamped = Math.max(1, Math.min(99, Math.round(interval) || 1));
    emit({ ...value, ...ruleFor(tile, { interval: clamped }), interval: clamped });
  };

  const toggleWeekday = (day: number) => {
    const current = rule.weekdays ?? [startWeekday];
    const next = current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day];
    // Never empty: a weekly rule with no weekday selects nothing at all.
    if (next.length) emit({ ...rule, weekdays: next });
  };

  const presets: { label: string; apply: () => void }[] = [
    { label: 'Every weekday', apply: () => { setTile('Weekly'); emit({ ...ruleFor('Weekly', { interval: 1 }), weekdays: WEEKDAYS_MON_FRI }); } },
    { label: 'Every 2 weeks', apply: () => { setTile('Weekly'); emit({ ...ruleFor('Weekly', { interval: 2 }), interval: 2, weekdays: [startWeekday] }); } },
    {
      label: `${ORDINALS[nth][0].toUpperCase()}${ORDINALS[nth].slice(1)} ${OFFICE_HUB_WEEKDAYS[startWeekday].short} of the month`,
      apply: () => { setTile('Monthly'); emit({ ...ruleFor('Monthly', { interval: 1 }), monthlyMode: 'weekday-of-month', weekday: startWeekday, weekdayOrdinal: nth }); },
    },
    { label: 'Mon to Sat', apply: () => { setTile('Weekly'); emit({ ...ruleFor('Weekly', { interval: 1 }), weekdays: WEEKDAYS_MON_SAT }); } },
  ];

  const unitWord = tile === 'Custom' ? unit : tile === 'Daily' ? 'day' : tile === 'Weekly' ? 'week' : tile === 'Monthly' ? 'month' : 'year';
  const showWeekdays = (tile === 'Weekly' || (tile === 'Custom' && unit === 'week'));
  const showMonthly = tile === 'Monthly' || (tile === 'Custom' && unit === 'month');
  const showEvery = tile !== 'None' && !(tile === 'Daily' && dailyDays !== 'all');
  const warnings = repeatWarnings(rule, startDate, { workingDays, formatDate: (date) => formatIsoDate(date, { withWeekday: true, year: false }) });

  const skippedHolidays = preview.dates.filter((entry) => entry.skipped && entry.holiday).length;
  const lastMeeting = [...preview.dates].reverse().find((entry) => !entry.skipped);

  if (tile === 'None' || rule.frequency === 'None') {
    return (
      <div>
        <SectionLabel>Repeats</SectionLabel>
        <TileRow value="None" onPick={pickTile} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <PresetChip key={preset.label} onClick={preset.apply}>
              {preset.label}
            </PresetChip>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel>Repeats</SectionLabel>
      <TileRow value={tile} onPick={pickTile} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <PresetChip key={preset.label} onClick={preset.apply}>
            {preset.label}
          </PresetChip>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-4 overflow-hidden rounded-2xl border 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] 2xl:gap-0">
        {/* ── the pattern ── */}
        <div className="min-w-0 space-y-4 p-3.5 sm:p-4">
          {showEvery && (
            <div>
              <SectionLabel>Every</SectionLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Stepper value={rule.interval} onChange={changeInterval} label="Repeat interval" />
                {tile === 'Custom' ? (
                  <select
                    value={unit}
                    aria-label="Unit"
                    onChange={(event) => {
                      const next = event.target.value as Unit;
                      setUnit(next);
                      emit(ruleFor('Custom', { unit: next }));
                    }}
                    className="h-[34px] rounded-[11px] border bg-card px-2.5 text-sm font-semibold"
                  >
                    <option value="day">{rule.interval > 1 ? 'days' : 'day'}</option>
                    <option value="week">{rule.interval > 1 ? 'weeks' : 'week'}</option>
                    <option value="month">{rule.interval > 1 ? 'months' : 'month'}</option>
                    <option value="year">{rule.interval > 1 ? 'years' : 'year'}</option>
                  </select>
                ) : (
                  <span className="text-sm font-bold text-muted-foreground">{rule.interval > 1 ? `${unitWord}s` : unitWord}</span>
                )}
              </div>
            </div>
          )}

          {tile === 'Daily' && (
            <div>
              <SectionLabel>Which days</SectionLabel>
              <div className="grid gap-1.5">
                {(
                  [
                    ['all', 'Every day', 'Including weekends'],
                    ['weekdays', 'Monday to Friday', 'Skips Saturday and Sunday'],
                    ['mon-sat', 'Monday to Saturday', 'Skips Sunday only'],
                  ] as const
                ).map(([key, title, note]) => (
                  <OptionCard
                    key={key}
                    selected={dailyDays === key}
                    title={title}
                    note={note}
                    onSelect={() => {
                      setDailyDays(key);
                      emit(ruleFor('Daily', { days: key }));
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {showWeekdays && (
            <div>
              <SectionLabel>On these days</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                  const on = (rule.weekdays ?? []).includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWeekday(day)}
                      className={cn(
                        'h-11 w-11 rounded-full border text-xs font-extrabold transition-colors',
                        on ? 'border-transparent bg-gradient-to-br from-primary to-indigo-600 text-white shadow-md' : 'bg-card text-muted-foreground hover:border-primary/50',
                        !on && workingDays && !workingDays.includes(day) && 'text-primary/50',
                      )}
                    >
                      {OFFICE_HUB_WEEKDAYS[day].short}
                    </button>
                  );
                })}
                <span className="ml-1 flex items-center gap-1.5 text-[11.5px] font-bold text-primary">
                  <button type="button" className="hover:underline" onClick={() => emit({ ...rule, weekdays: WEEKDAYS_MON_FRI })}>
                    Weekdays
                  </button>
                  ·
                  <button type="button" className="hover:underline" onClick={() => emit({ ...rule, weekdays: WEEKDAYS_MON_SAT })}>
                    Mon–Sat
                  </button>
                </span>
              </div>
            </div>
          )}

          {showMonthly && (
            <div>
              <SectionLabel>On</SectionLabel>
              <div className="grid gap-1.5">
                <OptionCard
                  selected={rule.monthlyMode !== 'weekday-of-month'}
                  title={`Day ${startDay} of the month`}
                  note={startDay > 28 ? 'Shorter months use their last day' : 'Same date each month'}
                  onSelect={() => emit({ ...rule, monthlyMode: 'day-of-month', dayOfMonth: startDay })}
                />
                <OptionCard
                  selected={rule.monthlyMode === 'weekday-of-month' && rule.weekdayOrdinal !== -1}
                  title={`The ${ORDINALS[nth]} ${OFFICE_HUB_WEEKDAYS[startWeekday].name}`}
                  note="Same weekday each month"
                  onSelect={() => emit({ ...rule, monthlyMode: 'weekday-of-month', weekday: startWeekday, weekdayOrdinal: nth })}
                />
                <OptionCard
                  selected={rule.monthlyMode === 'weekday-of-month' && rule.weekdayOrdinal === -1}
                  title={`The last ${OFFICE_HUB_WEEKDAYS[startWeekday].name}`}
                  note="Good for month-end reviews"
                  onSelect={() => emit({ ...rule, monthlyMode: 'weekday-of-month', weekday: startWeekday, weekdayOrdinal: -1 })}
                />
              </div>
            </div>
          )}

          <div>
            <SectionLabel>Ends</SectionLabel>
            <div className="grid gap-1.5">
              <OptionCard
                selected={rule.endMode === 'on-date'}
                title="On a date"
                note="Recommended — the series stops by itself"
                onSelect={() => emit({ ...rule, endMode: 'on-date', endDate: rule.endDate ?? endDatePresets(startDate)[1]?.date ?? addMonths(startDate, 6) })}
                aside={
                  <input
                    type="date"
                    value={rule.endDate ?? ''}
                    min={startDate}
                    aria-label="Last date"
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => event.target.value && emit({ ...rule, endMode: 'on-date', endDate: event.target.value })}
                    className="rounded-[9px] border bg-card px-2 py-1 text-xs font-semibold"
                  />
                }
              />
              {rule.endMode === 'on-date' && (
                <div className="ml-9 flex flex-wrap gap-1">
                  {endDatePresets(startDate).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => emit({ ...rule, endMode: 'on-date', endDate: preset.date })}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-bold transition-colors hover:border-primary/60 hover:text-primary',
                        rule.endDate === preset.date ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground',
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <OptionCard
                selected={rule.endMode === 'after-occurrences'}
                title="After a number of meetings"
                note="Skipped dates count towards the number"
                onSelect={() => emit({ ...rule, endMode: 'after-occurrences', occurrences: rule.occurrences ?? 10 })}
                aside={
                  <span onClick={(event) => event.stopPropagation()}>
                    <Stepper
                      small
                      value={rule.occurrences ?? 10}
                      label="Number of meetings"
                      onChange={(next) => emit({ ...rule, endMode: 'after-occurrences', occurrences: Math.max(1, Math.min(260, next)) })}
                    />
                  </span>
                }
              />
              <OptionCard
                selected={rule.endMode === 'never'}
                title="Never"
                note="Keeps going until somebody ends the series"
                onSelect={() => emit({ ...rule, endMode: 'never' })}
              />
            </div>
          </div>

          <div>
            <SectionLabel>Holidays &amp; exceptions</SectionLabel>
            {holidays.length ? (
              <label className="flex cursor-pointer items-start gap-2.5 py-1">
                <Switch
                  checked={skipHolidays}
                  onCheckedChange={(next) => {
                    setSkipHolidays(next);
                    emit(rule, next);
                  }}
                />
                <span>
                  <b className="block text-[12.5px]">Skip company holidays</b>
                  <span className="text-[11.5px] text-muted-foreground">A meeting that falls on a holiday is not created.</span>
                </span>
              </label>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">No company holidays are set up yet. Once they are (Office Hub settings), they can be skipped here.</p>
            )}
            {warnings.map((warning) => (
              <div
                key={warning.text}
                className={cn(
                  'mt-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs',
                  warning.tone === 'caution'
                    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
                    : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200',
                )}
              >
                {warning.tone === 'caution' ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span>{warning.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── every date ── */}
        <div className="min-w-0 border-t bg-primary/[0.02] p-3.5 sm:p-4 2xl:border-l 2xl:border-t-0">
          <div className="keep-light oh-hero relative flex items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-3 text-white">
            <span aria-hidden className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-white/20">
              <Repeat className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <b className="block text-[15px] leading-snug">{describeRecurrence({ ...rule, endMode: 'never' }, startDate)}</b>
              <span className="text-xs text-indigo-100">
                {preview.openEnded
                  ? `Starting ${formatIsoDate(startDate, { year: false })} · no end date`
                  : `${formatIsoDate(startDate, { year: false })} – ${lastMeeting ? formatIsoDate(lastMeeting.date) : '—'}`}
              </span>
            </div>
          </div>

          <div className="my-2.5 grid grid-cols-3 gap-2">
            <Stat label="Meetings" value={`${preview.meetings}${preview.openEnded ? '+' : ''}`} />
            <Stat
              label="Per person"
              value={durationMinutes ? `${formatHours(preview.meetings * durationMinutes)}${preview.openEnded ? '+' : ''}` : '—'}
            />
            <Stat label="Holidays" value={skippedHolidays ? `${skippedHolidays} skipped` : 'None hit'} tone={skippedHolidays ? 'pink' : 'good'} />
          </div>

          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Earlier months"
              disabled={monthOffset <= 0}
              onClick={() => setMonthOffset((current) => Math.max(0, current - 1))}
              className="grid h-7 w-7 place-items-center rounded-lg border bg-card disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <b className="text-[12.5px]">Click a date to skip or restore it</b>
            <button
              type="button"
              aria-label="Later months"
              onClick={() => setMonthOffset((current) => current + 1)}
              className="grid h-7 w-7 place-items-center rounded-lg border bg-card"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {[0, 1].map((index) => (
              <MiniPreviewMonth
                key={index}
                month={addMonths(startOfMonth(startDate), monthOffset + index)}
                dates={preview.dates}
                holidays={holidays}
                today={today}
                startDate={startDate}
                skipHolidays={skipHolidays}
                onToggle={(date) => emit(toggleSkip(rule, startDate, date))}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="h-2.5 w-2.5 rounded-[3px] bg-gradient-to-br from-primary to-indigo-600" />
              Meeting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="oh-cal-pending h-2.5 w-2.5 rounded-[3px] border" />
              Skipped
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="h-2.5 w-2.5 rounded-[3px] ring-[1.5px] ring-inset ring-pink-400" />
              Holiday
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="h-[7px] w-[7px] rounded-full bg-emerald-600" />
              First meeting
            </span>
          </div>

          <ul className="mt-2.5 max-h-52 overflow-y-auto rounded-xl border bg-card">
            {preview.dates.slice(0, 40).map((entry, index) => {
              const number = preview.dates.slice(0, index + 1).filter((candidate) => !candidate.skipped).length;
              const lockedHoliday = Boolean(entry.holiday && skipHolidays && entry.skipped);
              return (
                <li key={entry.date} className={cn('flex items-center gap-2.5 border-t px-3 py-1.5 text-xs first:border-t-0', entry.skipped && 'text-muted-foreground')}>
                  <em className="w-6 text-[11px] font-bold not-italic text-muted-foreground">{entry.skipped ? '–' : number}</em>
                  <b className={cn('min-w-0 flex-1 truncate font-bold', entry.skipped && 'font-semibold line-through')}>
                    {formatIsoDate(entry.date, { withWeekday: true })}
                  </b>
                  {entry.holiday && (
                    <span className="shrink-0 rounded-full bg-pink-100 px-2 py-px text-[10.5px] font-bold text-pink-700">
                      {entry.holiday}
                      {entry.skipped ? ' · skipped' : ''}
                    </span>
                  )}
                  {entry.skipped && !entry.holiday && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-px text-[10.5px] font-bold text-primary">Skipped by you</span>
                  )}
                  {!entry.first && !lockedHoliday && (
                    <button type="button" onClick={() => emit(toggleSkip(rule, startDate, entry.date))} className="shrink-0 text-[11.5px] font-bold text-primary hover:underline">
                      {entry.skipped ? 'Restore' : 'Skip'}
                    </button>
                  )}
                </li>
              );
            })}
            {preview.dates.length > 40 && <li className="border-t px-3 py-1.5 text-xs text-muted-foreground">and {preview.dates.length - 40} more…</li>}
            {preview.openEnded && <li className="border-t px-3 py-1.5 text-xs text-muted-foreground">∞ Continues with no end date</li>}
          </ul>
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {preview.openEnded
              ? 'Meetings are created twelve weeks ahead and topped up automatically, so an open-ended series never runs out.'
              : 'Every meeting in the list is created when you schedule; skipped dates are not.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── small parts ─────────────────────────────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.07em] text-muted-foreground">{children}</span>;
}

function TileRow({ value, onPick }: { value: Tile; onPick: (tile: Tile) => void }) {
  return (
    <div role="radiogroup" aria-label="How often" className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {TILES.map((tile) => {
        const Icon = tile.icon;
        const on = tile.value === value;
        return (
          <button
            key={tile.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(tile.value)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-[13px] border px-1 pb-1.5 pt-2 text-xs font-bold transition-colors',
              on ? 'border-primary bg-primary/5 text-primary ring-[3px] ring-primary/10' : 'bg-card text-muted-foreground hover:border-primary/40',
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
            <span className="text-center leading-tight">{tile.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PresetChip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-dashed border-primary/40 bg-primary/5 px-2.5 py-0.5 text-[11.5px] font-bold text-primary hover:bg-primary/10"
    >
      {children}
    </button>
  );
}

function Stepper({ value, onChange, label, small }: { value: number; onChange: (next: number) => void; label: string; small?: boolean }) {
  return (
    <span className="inline-flex items-center overflow-hidden rounded-[11px] border bg-card">
      <button type="button" aria-label={`Fewer — ${label}`} onClick={() => onChange(value - 1)} className={cn('bg-muted font-extrabold text-muted-foreground hover:text-primary', small ? 'h-7 w-6' : 'h-[34px] w-8')}>
        −
      </button>
      <input
        value={value}
        inputMode="numeric"
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value.replace(/\D/g, ''));
          if (next) onChange(next);
        }}
        className={cn('border-0 bg-transparent text-center font-extrabold outline-none', small ? 'w-9 text-[13px]' : 'w-11 text-sm')}
      />
      <button type="button" aria-label={`More — ${label}`} onClick={() => onChange(value + 1)} className={cn('bg-muted font-extrabold text-muted-foreground hover:text-primary', small ? 'h-7 w-6' : 'h-[34px] w-8')}>
        +
      </button>
    </span>
  );
}

function OptionCard({ selected, title, note, onSelect, aside }: { selected: boolean; title: string; note: string; onSelect: () => void; aside?: ReactNode }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'flex cursor-pointer flex-wrap items-center gap-2.5 rounded-[13px] border px-3 py-2 transition-colors',
        selected ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40',
      )}
    >
      <span aria-hidden className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2', selected ? 'border-primary' : 'border-muted-foreground/40')}>
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[12.5px]">{title}</b>
        <span className="text-[11.5px] text-muted-foreground">{note}</span>
      </span>
      {aside}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pink' | 'good' }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-2.5 py-1.5">
      <small className="block truncate text-[10.5px] font-bold text-muted-foreground">{label}</small>
      <b className={cn('text-[15px]', tone === 'pink' && 'text-pink-700 dark:text-pink-300', tone === 'good' && 'text-emerald-700 dark:text-emerald-300')}>{value}</b>
    </div>
  );
}

function MiniPreviewMonth({
  month,
  dates,
  holidays,
  today,
  startDate,
  skipHolidays,
  onToggle,
}: {
  month: IsoDate;
  dates: readonly { date: string; skipped: boolean; holiday: string | null; first: boolean }[];
  holidays: readonly { date: string; name: string }[];
  today?: string;
  startDate: string;
  skipHolidays: boolean;
  onToggle: (date: string) => void;
}) {
  const byDate = new Map(dates.map((entry) => [entry.date, entry]));
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday.name]));
  const prefix = month.slice(0, 7);
  const days = monthGridDays(month);
  return (
    <div className="rounded-[14px] border bg-card p-2">
      <h6 className="mb-1.5 text-center text-xs font-extrabold">
        {MONTHS_LONG[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
      </h6>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <div key={weekday} className="text-[9.5px] font-extrabold text-muted-foreground">
            {OFFICE_HUB_WEEKDAYS[weekday].short.slice(0, 1)}
          </div>
        ))}
        {days.map((date) => {
          if (!date.startsWith(prefix)) return <span key={date} aria-hidden className="h-[26px]" />;
          const entry = byDate.get(date);
          const holiday = holidayByDate.get(date);
          const locked = Boolean(entry?.first || (entry?.holiday && skipHolidays && entry.skipped));
          const content = (
            <>
              {Number(date.slice(8, 10))}
              {entry?.first && <span aria-hidden className="absolute right-[3px] top-0.5 h-[5px] w-[5px] rounded-full bg-emerald-500" />}
            </>
          );
          const className = cn(
            'relative grid h-[26px] place-items-center rounded-lg text-[11px] font-semibold',
            entry && !entry.skipped && 'bg-gradient-to-br from-primary to-indigo-600 font-extrabold text-white',
            entry?.skipped && 'oh-cal-pending text-primary/60 line-through',
            holiday && 'ring-[1.5px] ring-inset ring-pink-400',
            !entry && today && date < today && 'text-muted-foreground/50',
          );
          return entry && !locked ? (
            <button
              key={date}
              type="button"
              title={`${holiday ? `${holiday} · ` : ''}${entry.skipped ? 'Skipped — click to restore' : 'Click to skip'}`}
              onClick={() => onToggle(date)}
              className={cn(className, 'hover:ring-2 hover:ring-primary/40')}
            >
              {content}
            </button>
          ) : (
            <span key={date} className={className} title={holiday ?? (date === startDate ? 'First meeting' : undefined)}>
              {content}
            </span>
          );
        })}
      </div>
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
