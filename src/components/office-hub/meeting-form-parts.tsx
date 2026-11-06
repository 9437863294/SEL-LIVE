'use client';

/**
 * The pieces of the meeting form's layout (2026-11-06 redesign, from the user's mockup).
 *
 * Presentational only: every value arrives as a prop and every change leaves as a callback, so the
 * form in `meeting-form.tsx` stays the one place that holds the draft and decides what is valid.
 */

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  CircleEllipsis,
  ClipboardList,
  GraduationCap,
  Handshake,
  HardHat,
  Laptop,
  ListChecks,
  MapPin,
  ShoppingCart,
  Siren,
  Truck,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  OFFICE_HUB_WEEKDAYS,
  addDays,
  daysBetween,
  weekdayOf,
  type OfficeHubPriority,
} from '@/lib/office-hub';
import { FieldError } from './ui';

/* ── small shared bits ───────────────────────────────────────────────────────────────────────── */

const AVATAR_COLOURS = ['#0f766e', '#7c3aed', '#2563eb', '#ea580c', '#db2777', '#047857', '#9333ea', '#0891b2', '#b45309', '#4f46e5'];

/** A stable colour per person, so the same face is the same colour everywhere on the page. */
export function avatarColour(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length];
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

export function Avatar({ seed, name, size = 22, square = false, className }: { seed: string; name: string; size?: number; square?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-grid shrink-0 place-items-center font-extrabold text-white', square ? 'rounded-md' : 'rounded-full', className)}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.38)), background: avatarColour(seed) }}
    >
      {initialsOf(name)}
    </span>
  );
}

/** A gradient app tile, as on the mockup's card headers. */
function Tile({ icon: Icon, from, to, size = 34 }: { icon: LucideIcon; from: string; to: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center text-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: `linear-gradient(145deg, ${from}, ${to})`,
        boxShadow: `0 6px 14px -6px ${to}99, inset 0 1px 0 rgb(255 255 255 / 0.27)`,
      }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export const CARD_TONES = {
  violet: ['#c4b5fd', '#6d28d9'],
  blue: ['#93c5fd', '#1d4ed8'],
  emerald: ['#6ee7b7', '#047857'],
  amber: ['#fcd34d', '#d97706'],
  pink: ['#f9a8d4', '#be185d'],
} as const;

/** One section of the form: a card with a tile, a title and a line saying what it is for. */
export function FormCard({
  id,
  icon,
  tone,
  title,
  description,
  aside,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  tone: keyof typeof CARD_TONES;
  title: string;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const [from, to] = CARD_TONES[tone];
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border bg-card text-card-foreground shadow-sm">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
        <Tile icon={icon} from={from} to={to} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold leading-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

/** A labelled field row; `required` adds the star. */
export function FieldLabel({ children, required, hint, htmlFor }: { children: ReactNode; required?: boolean; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-muted-foreground">
      {children}
      {required && <span className="ml-0.5 text-destructive">*</span>}
      {hint && <span className="ml-1 font-medium text-muted-foreground/80">({hint})</span>}
    </label>
  );
}

/** A row of pill buttons where one is chosen. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-0.5 rounded-xl bg-muted p-1', className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
              selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── the hero ────────────────────────────────────────────────────────────────────────────────── */

const TYPE_ICONS: [RegExp, LucideIcon][] = [
  [/manage/i, Briefcase],
  [/depart/i, Building2],
  [/project/i, HardHat],
  [/client|customer/i, Handshake],
  [/vendor|supplier/i, Truck],
  [/review/i, BarChart3],
  [/site/i, MapPin],
  [/financ|account/i, Wallet],
  [/\bhr\b|human/i, Users],
  [/purchas|procure/i, ShoppingCart],
  [/\bit\b|tech/i, Laptop],
  [/emergen|urgent/i, Siren],
  [/train/i, GraduationCap],
  [/plan/i, ClipboardList],
  [/one.?to.?one/i, UserRound],
];

/** An icon for a meeting type by its name; the types are configurable, so this guesses. */
export function meetingTypeIcon(type: string): LucideIcon {
  return TYPE_ICONS.find(([pattern]) => pattern.test(type))?.[1] ?? (/other/i.test(type) ? CircleEllipsis : CalendarDays);
}

const PRIORITY_TEXT: Record<OfficeHubPriority, string> = {
  Low: 'text-emerald-700',
  Medium: 'text-violet-800',
  High: 'text-orange-700',
  Critical: 'text-rose-700',
};

export function MeetingHero({
  eyebrow,
  subtitle,
  backHref,
  title,
  onTitleChange,
  onTitleBlur,
  titleError,
  meetingTypes,
  meetingType,
  onMeetingTypeChange,
  typeError,
  priorities,
  priority,
  onPriorityChange,
  autoFocus,
}: {
  eyebrow: string;
  subtitle?: string;
  backHref: string;
  title: string;
  onTitleChange: (next: string) => void;
  onTitleBlur: () => void;
  titleError?: string;
  meetingTypes: readonly string[];
  meetingType: string;
  onMeetingTypeChange: (next: string) => void;
  typeError?: string;
  priorities: readonly OfficeHubPriority[];
  priority: OfficeHubPriority;
  onPriorityChange: (next: OfficeHubPriority) => void;
  autoFocus?: boolean;
}) {
  return (
    <section className="oh-hero keep-light relative overflow-hidden rounded-[22px] px-4 py-4 text-white sm:px-6 sm:py-5">
      <div aria-hidden className="wd-hero-dots pointer-events-none absolute inset-0" />
      <div className="relative">
        <div className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-violet-100">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{eyebrow}</span>
          <span className="flex-1" />
          <Link
            href={backHref}
            className="flex shrink-0 items-center gap-1.5 rounded-[10px] border border-white/25 bg-white/10 px-3 py-1 text-xs normal-case tracking-normal text-white transition-colors hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </Link>
        </div>
        {subtitle && <p className="mt-1 text-xs text-violet-100/90">{subtitle}</p>}

        <input
          id="oh-title"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={onTitleBlur}
          placeholder="Meeting title, e.g. Monthly Finance Review"
          aria-label="Meeting title"
          aria-invalid={Boolean(titleError)}
          autoFocus={autoFocus}
          className={cn(
            'mt-3 w-full rounded-2xl border-[1.5px] bg-white/10 px-4 py-3 text-lg font-extrabold text-white outline-none transition-colors placeholder:text-white/60 focus:border-white focus:bg-white/15 sm:text-[22px]',
            titleError ? 'border-rose-300 bg-rose-500/20' : 'border-white/25',
          )}
        />
        {titleError && <p className="mt-1.5 text-xs font-bold text-rose-100">{titleError}</p>}

        <div id="oh-types" className="mt-3 flex flex-wrap items-center gap-1.5 scroll-mt-24" role="radiogroup" aria-label="Meeting type">
          {meetingTypes.map((type) => {
            const Icon = meetingTypeIcon(type);
            const selected = type === meetingType;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onMeetingTypeChange(type)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                  selected
                    ? 'border-white bg-white text-violet-900'
                    : cn('bg-white/10 text-white hover:bg-white/20', typeError ? 'border-rose-300' : 'border-white/25'),
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {type}
              </button>
            );
          })}

          <div
            role="radiogroup"
            aria-label="Priority"
            className="flex w-full gap-1 rounded-full bg-black/15 p-[3px] sm:ml-auto sm:w-auto"
          >
            {priorities.map((option) => {
              const selected = option === priority;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onPriorityChange(option)}
                  className={cn(
                    'flex-1 rounded-full px-2.5 py-0.5 text-xs font-bold transition-colors sm:flex-none',
                    selected ? cn('bg-white', PRIORITY_TEXT[option]) : 'text-white hover:bg-white/15',
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        </div>
        {typeError && <p className="mt-1.5 text-xs font-bold text-rose-100">{typeError}</p>}
      </div>
    </section>
  );
}

/* ── when ────────────────────────────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A week of days to tap, plus a picker for anything further out.
 *
 * The strip starts today while the chosen day is inside this week, and otherwise centres on the
 * chosen day, so the selection is always on screen — a template's date six weeks out included.
 */
export function DayStrip({
  value,
  onChange,
  today,
  min,
  workingDays,
  holidays,
}: {
  value: string;
  onChange: (next: string) => void;
  today: string;
  min?: string;
  workingDays: readonly number[];
  holidays: readonly { date: string; name: string }[];
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const offset = daysBetween(today, value);
  let start = offset >= 0 && offset < 7 ? today : addDays(value, -3);
  if (min && daysBetween(min, start) < 0) start = min;
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));

  const openPicker = () => {
    const input = pickerRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
      input.click();
    }
  };

  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
      {days.map((day) => {
        const selected = day === value;
        const weekday = weekdayOf(day);
        const offDay = !workingDays.includes(weekday);
        const holiday = holidays.find((entry) => entry.date === day);
        const disabled = Boolean(min && daysBetween(min, day) < 0);
        const fromToday = daysBetween(today, day);
        return (
          <button
            key={day}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            title={holiday ? holiday.name : offDay ? 'Not a working day' : undefined}
            onClick={() => onChange(day)}
            className={cn(
              'relative rounded-xl border px-1 py-1.5 text-center text-[11px] font-bold leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'border-transparent bg-gradient-to-br from-primary to-blue-600 text-indigo-100 shadow-md'
                : cn('text-muted-foreground hover:border-primary/50', offDay || holiday ? 'bg-muted/60' : 'bg-card'),
            )}
          >
            {OFFICE_HUB_WEEKDAYS[weekday].short}
            <b className={cn('block text-[17px]', selected ? 'text-white' : 'text-foreground')}>{Number(day.slice(8, 10))}</b>
            <small className="block truncate text-[10px] font-semibold">
              {holiday ? 'Holiday' : fromToday === 0 ? 'Today' : fromToday === 1 ? 'Tomorrow' : MONTHS[Number(day.slice(5, 7)) - 1]}
            </small>
            {holiday && !selected && <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />}
          </button>
        );
      })}
      <div className="relative">
        <button
          type="button"
          onClick={openPicker}
          className="h-full w-full rounded-xl border border-dashed bg-card px-1 py-1.5 text-center text-[11px] font-bold leading-tight text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <CalendarDays className="mx-auto h-4 w-4" aria-hidden />
          <span className="mt-1 block">Other date</span>
        </button>
        {/* The browser's own calendar, opened by the button; invisible, but there to be opened. */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-label="Pick another date"
          value={value}
          min={min}
          onChange={(event) => event.target.value && onChange(event.target.value)}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </div>
    </div>
  );
}

export function DurationChips({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {[15, 30, 45, 60, 90, 120].map((minutes) => (
        <button
          key={minutes}
          type="button"
          aria-pressed={value === minutes}
          onClick={() => onChange(minutes)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-bold transition-colors',
            value === minutes ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
          )}
        >
          {minutes < 60 ? `${minutes}m` : `${minutes / 60}h`}
        </button>
      ))}
    </div>
  );
}

/* ── choices ─────────────────────────────────────────────────────────────────────────────────── */

/** Big pick-one cards: the meeting's mode. */
export function ModeCards<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; title: string; description: string; icon: LucideIcon; tone: keyof typeof CARD_TONES }[];
  onChange: (next: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Where the meeting happens" className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {options.map((option) => {
        const selected = option.value === value;
        const [from, to] = CARD_TONES[option.tone];
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-2xl border p-3 text-left transition-colors',
              selected ? 'border-primary bg-primary/5 ring-[3px] ring-primary/10' : 'bg-card hover:border-primary/40',
            )}
          >
            <Tile icon={option.icon} from={from} to={to} size={32} />
            <span className="min-w-0">
              <b className="block text-[13px]">{option.title}</b>
              <small className="block text-[11.5px] leading-snug text-muted-foreground">{option.description}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One question answered by picking a card: a radio group that reads as a choice, not a setting. */
export function ChoiceCards<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  error,
}: {
  id?: string;
  label: string;
  value: T | null;
  onChange: (next: T) => void;
  options: { value: T; icon: LucideIcon; title: string; description: string }[];
  error?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <FieldLabel required>{label}</FieldLabel>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {options.map((option) => {
          const selected = value === option.value;
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex min-w-0 items-start gap-2.5 rounded-2xl border p-3 text-left transition-colors',
                selected
                  ? 'border-primary bg-primary/5 ring-[3px] ring-primary/10'
                  : cn('bg-card hover:border-primary/40', error && 'border-rose-300'),
              )}
            >
              <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              <span className="min-w-0">
                <b className="block text-[13px]">{option.title}</b>
                <small className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">{option.description}</small>
              </span>
            </button>
          );
        })}
      </div>
      <FieldError message={error} />
    </div>
  );
}

/** Reminder offsets as toggles. Empty is allowed: each participant's own default then applies. */
export function ReminderChips({
  choices,
  value,
  onChange,
  defaults,
}: {
  choices: readonly { minutes: number; label: string }[];
  value: readonly number[];
  onChange: (next: number[]) => void;
  defaults?: readonly number[];
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = value.includes(choice.minutes);
          return (
            <button
              key={choice.minutes}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? value.filter((entry) => entry !== choice.minutes) : [...value, choice.minutes])}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <Bell className="h-3 w-3" aria-hidden />
              {choice.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {value.length === 0
          ? `No reminder chosen, so each participant's own default applies${
              defaults?.length ? ` (the office default is ${defaults.join(', ')} minutes before)` : ''
            }.`
          : 'Reminders are sent by the server, so they arrive whether or not the app is open.'}
      </p>
    </div>
  );
}

/* ── the side panel ──────────────────────────────────────────────────────────────────────────── */

export interface InvitationPreviewRow {
  icon: LucideIcon;
  title: string;
  detail?: string | null;
}

/** What participants will receive, built from the draft as it is typed. */
export function InvitationPreview({
  date,
  title,
  meta,
  rows,
}: {
  date: string;
  title: string;
  meta: string;
  rows: InvitationPreviewRow[];
}) {
  const weekday = OFFICE_HUB_WEEKDAYS[weekdayOf(date)]?.short ?? '';
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_50px_-36px_rgba(76,29,149,0.9)]">
      <div className="flex gap-3 border-b bg-gradient-to-br from-primary/10 to-blue-500/10 p-4">
        <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-white text-center shadow-sm keep-light">
          <small className="block bg-rose-600 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">
            {MONTHS[Number(date.slice(5, 7)) - 1] ?? ''}
          </small>
          <b className="block pt-0.5 text-[22px] font-extrabold text-slate-900">{Number(date.slice(8, 10)) || '–'}</b>
          <span className="block pb-1 text-[10px] font-bold text-slate-500">{weekday}</span>
        </div>
        <div className="min-w-0">
          <span className="inline-flex rounded-full bg-slate-100 px-2 py-px text-[11px] font-bold text-slate-600">Invitation preview</span>
          <h3 className={cn('mt-1 break-words text-base font-extrabold leading-snug', !title && 'text-muted-foreground')}>
            {title || 'Your meeting title'}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
        </div>
      </div>
      <div className="px-4 pb-3 pt-1.5">
        {rows.map((row, index) => {
          const Icon = row.icon;
          return (
            <div key={index} className="flex items-start gap-2.5 border-b border-dashed py-2 text-[12.5px] last:border-b-0">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <b className="block break-words">{row.title}</b>
                {row.detail && <small className="block whitespace-pre-line break-words text-[11.5px] text-muted-foreground">{row.detail}</small>}
              </div>
            </div>
          );
        })}
      </div>
      <div aria-hidden className="flex gap-1.5 px-4 pb-4">
        <span className="flex-1 rounded-[10px] border border-emerald-600 bg-emerald-600 py-1.5 text-center text-xs font-bold text-white">Accept</span>
        <span className="flex-1 rounded-[10px] border py-1.5 text-center text-xs font-bold text-muted-foreground">Maybe</span>
        <span className="flex-1 rounded-[10px] border py-1.5 text-center text-xs font-bold text-muted-foreground">Decline</span>
      </div>
    </div>
  );
}

export type CheckState = 'ok' | 'missing' | 'warn';

export interface PreflightCheck {
  key: string;
  state: CheckState;
  label: string;
  /** The element to scroll to when the line is clicked. */
  target?: string;
}

/** "Before you send": what is done, what is missing, and what is worth a second look. */
export function PreflightChecklist({ checks, onJump }: { checks: PreflightCheck[]; onJump: (target: string) => void }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <h3 className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-[13.5px] font-extrabold">
        <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden />
        Before you send
      </h3>
      <ul className="px-2 pb-3">
        {checks.map((check) => {
          const Icon = check.state === 'ok' ? Check : check.state === 'missing' ? X : AlertTriangle;
          const content = (
            <>
              <span
                className={cn(
                  'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
                  check.state === 'ok' && 'bg-emerald-100 text-emerald-700',
                  check.state === 'missing' && 'bg-rose-100 text-rose-700',
                  check.state === 'warn' && 'bg-amber-100 text-amber-700',
                )}
              >
                <Icon className="h-[11px] w-[11px]" strokeWidth={3} aria-hidden />
              </span>
              <span className="min-w-0 text-left">{check.label}</span>
            </>
          );
          return (
            <li key={check.key}>
              {check.target && check.state !== 'ok' ? (
                <button
                  type="button"
                  onClick={() => onJump(check.target as string)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] font-semibold transition-colors hover:bg-muted"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-2 py-1 text-[12.5px] font-semibold">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
