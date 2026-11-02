'use client';

/**
 * The pieces of Settings › Overview that only draw what they are given: what needs attention, the
 * activity chart, recent changes, the working week, upcoming holidays and the next document
 * numbers. The page loads the figures; each piece shows a placeholder while its figure loads and a
 * short line when it failed. The band at the top is `overview-hero.tsx`.
 */

import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { initialsOf, logDate, userLabel, type AuditLogEntry } from '@/components/shared/record-history';
import { nextDocumentNumber, type DocumentSeries } from '@/lib/document-numbers';
import { fromIsoDay, inDaysLabel, relativeTime, type CheckSummary, type CheckTone, type SettingsCheck, type UpcomingHoliday } from '@/lib/settings-overview';
import type { SerialNumberConfig, WorkingHours } from '@/lib/types';
import { cn } from '@/lib/utils';

/** One figure's load: still going, done, or failed. */
export type Figure<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed' };

export const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const plural = (value: number, noun: string) => `${value.toLocaleString('en-IN')} ${noun}${value === 1 ? '' : 's'}`;

/** Hours between two "HH:mm" times; 0 when either is missing or the end is not after the start. */
export function hoursBetween(start?: string, end?: string): number {
  const minutes = (time?: string) => {
    const [h, m] = (time ?? '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : Number.NaN;
  };
  const span = minutes(end) - minutes(start);
  return Number.isFinite(span) && span > 0 ? span / 60 : 0;
}

const Note = ({ children }: { children: string }) => <p className="text-sm text-muted-foreground">{children}</p>;

// ── Needs attention ──────────────────────────────────────────────────────────────────────────────

// Status colours, each beside an icon and words that say the same thing.
const TONE: Record<CheckTone, { icon: typeof Info; badge: 'danger' | 'warning' | 'info'; label: string; tile: string }> = {
  danger: { icon: XCircle, badge: 'danger', label: 'Fix now', tile: 'bg-rose-50 text-rose-600' },
  warning: { icon: AlertTriangle, badge: 'warning', label: 'Missing', tile: 'bg-amber-50 text-amber-600' },
  info: { icon: Info, badge: 'info', label: 'Suggested', tile: 'bg-sky-50 text-sky-600' },
};

/**
 * What the checks found, most serious first, each with the page that puts it right — the one place
 * on the overview that links anywhere, because each link is a fix, not a menu entry. Below them,
 * what passed, so a short list reads as "these are fine", not "these were not checked".
 */
export function AttentionList({ summary, checks }: { summary: CheckSummary; checks: SettingsCheck[] }) {
  const passing = checks.filter((check) => !check.issue);
  return (
    <div className="min-w-0">
      {summary.issues.length ? (
        <ul className="divide-y">
          {summary.issues.map((check) => {
            const issue = check.issue!;
            const tone = TONE[issue.tone];
            const Icon = tone.icon;
            return (
              <li key={check.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone.tile)} aria-hidden="true">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 basis-[12rem]">
                  {/* A div, not a p: Badge renders a div. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold leading-snug">
                    <span>{issue.title}</span>
                    <Badge variant={tone.badge} className="font-medium">{tone.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{issue.detail}</p>
                </div>
                <Button asChild variant="outline" size="sm" className="ml-12 h-8 shrink-0 gap-1 sm:ml-0">
                  <Link href={check.href} aria-label={`${check.action}: ${issue.title}`}>
                    {check.action}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-3 px-4 py-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600" aria-hidden="true">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Everything checked is in order</p>
            <p className="text-xs text-muted-foreground">{plural(summary.total, 'check')} on the settings you can see.</p>
          </div>
        </div>
      )}
      {passing.length > 0 && summary.issues.length > 0 && (
        <div className="border-t bg-muted/30 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Passing</p>
          <ul className="flex flex-wrap gap-1.5">
            {passing.map((check) => (
              <li key={check.id} className="flex min-w-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span className="min-w-0 break-words">{check.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Activity, last 14 days ───────────────────────────────────────────────────────────────────────

export interface ActivityPoint {
  /** "YYYY-MM-DD". */
  day: string;
  count: number;
}

const dayLabel = (iso: string, options: Intl.DateTimeFormatOptions) => fromIsoDay(iso)?.toLocaleDateString('en-IN', options) ?? iso;

/**
 * Audit-log actions per day as columns: one series in the accent, today's column at full strength.
 * Each column is focusable and names its day and count on hover or focus; a table carries the same
 * numbers for screen readers.
 */
export function ActivityChart({ figure }: { figure: Figure<ActivityPoint[]> }) {
  if (figure.status === 'loading') return <Skeleton className="h-[13.5rem] w-full rounded-lg" />;
  if (figure.status === 'failed') return <Note>The audit log could not be counted.</Note>;
  const points = figure.value;
  const max = Math.max(1, ...points.map((point) => point.count));
  const total = points.reduce((sum, point) => sum + point.count, 0);
  const today = points[points.length - 1];
  const busiest = points.reduce((best, point) => (point.count > best.count ? point : best), points[0]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <p className="text-3xl font-bold leading-none tabular-nums tracking-tight">{today.count.toLocaleString('en-IN')}</p>
          <p className="mt-1 text-xs text-muted-foreground">actions today</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div>
            <dt className="text-muted-foreground">Daily average</dt>
            <dd className="font-semibold tabular-nums">{Math.round(total / points.length).toLocaleString('en-IN')}</dd>
          </div>
          {busiest.count > 0 && (
            <div>
              <dt className="text-muted-foreground">Busiest day</dt>
              <dd className="font-semibold">
                {dayLabel(busiest.day, { weekday: 'short', day: 'numeric', month: 'short' })} · <span className="tabular-nums">{busiest.count.toLocaleString('en-IN')}</span>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div>
        <div className="relative h-32">
          {/* One recessive guide at the top value, labelled; the baseline below. */}
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden="true" />
          <span className="absolute -top-2 right-0 bg-card pl-1 text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
            {max.toLocaleString('en-IN')}
          </span>
          <ol className="absolute inset-0 flex items-end gap-0.5 border-b border-border pr-7" aria-label="Actions per day">
            {points.map((point, index) => {
              const isToday = index === points.length - 1;
              const height = point.count ? Math.max(3, (point.count / max) * 100) : 0;
              const name = `${dayLabel(point.day, { weekday: 'short', day: 'numeric', month: 'short' })}: ${point.count.toLocaleString('en-IN')} actions`;
              return (
                <li
                  key={point.day}
                  tabIndex={0}
                  aria-label={name}
                  className="group relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className={cn('block w-full max-w-6 rounded-t-[4px] transition-colors', isToday ? 'bg-primary' : 'bg-primary/40 group-hover:bg-primary/70 group-focus-visible:bg-primary/70')}
                    style={{ height: `${height}%` }}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'pointer-events-none absolute z-10 mb-1.5 hidden whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-md group-hover:block group-focus-visible:block',
                      // Kept inside the card at either end of the row.
                      index < 3 ? 'left-0' : index > points.length - 4 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                    )}
                    style={{ bottom: `${height}%` }}
                  >
                    {name}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        <ol className="mt-1.5 flex gap-0.5 pr-7 text-center text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
          {points.map((point, index) => {
            const isToday = index === points.length - 1;
            return (
              <li key={point.day} className={cn('min-w-0 flex-1 truncate', isToday && 'font-semibold text-foreground', !isToday && index % 2 === 1 && 'invisible sm:visible')}>
                {isToday ? (
                  <>
                    {/* A phone's column is too narrow for the word. */}
                    <span className="sm:hidden">{fromIsoDay(point.day)?.getDate()}</span>
                    <span className="hidden sm:inline">Today</span>
                  </>
                ) : (
                  fromIsoDay(point.day)?.getDate()
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <table className="sr-only">
        <caption>Audit-log actions per day, last {points.length} days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <td>{dayLabel(point.day, { weekday: 'long', day: 'numeric', month: 'long' })}</td>
              <td>{point.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Recent changes ───────────────────────────────────────────────────────────────────────────────

/** The latest entries from Settings' own audit trail: who, what, and how long ago. */
export function RecentChanges({ figure, now }: { figure: Figure<AuditLogEntry[]>; now: number }) {
  if (figure.status === 'loading') {
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (figure.status === 'failed') return <div className="p-4"><Note>Recent changes could not be loaded.</Note></div>;
  if (!figure.value.length) return <div className="p-4"><Note>No changes to Settings have been recorded yet.</Note></div>;
  return (
    <ul className="divide-y">
      {figure.value.map((entry) => {
        const who = userLabel(entry);
        const when = logDate(entry);
        return (
          <li key={entry.id} className="flex min-w-0 items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">
              {initialsOf(who)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm leading-snug">
                <span className="font-semibold">{who}</span> <span className="text-muted-foreground">·</span> {entry.action}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.module}
                {when && (
                  <>
                    {' · '}
                    <time dateTime={when.toISOString()} title={when.toLocaleString('en-IN')}>
                      {relativeTime(when.getTime(), now)}
                    </time>
                  </>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Working week and holidays ────────────────────────────────────────────────────────────────────

/** The seven days, each with its hours or "Off", today ringed, and the week's totals. */
export function WorkingWeekStrip({ figure, today }: { figure: Figure<WorkingHours | null>; today: string }) {
  if (figure.status === 'loading') return <Skeleton className="h-[72px] w-full rounded-lg" />;
  if (figure.status === 'failed') return <Note>The schedule could not be loaded.</Note>;
  const schedule = figure.value;
  if (!schedule) return <Note>No working hours have been saved yet.</Note>;
  const workDays = WEEK_DAYS.filter((day) => schedule[day]?.isWorkDay);
  const weeklyHours = workDays.reduce((sum, day) => sum + hoursBetween(schedule[day]?.startTime, schedule[day]?.endTime), 0);
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEK_DAYS.map((day) => {
          const entry = schedule[day];
          const on = Boolean(entry?.isWorkDay);
          const isToday = day === today;
          return (
            <li
              key={day}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-0.5 py-2 text-center',
                on ? 'border-primary/25 bg-primary/5' : 'border-dashed bg-muted/30 text-muted-foreground',
                isToday && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
              )}
            >
              <span className={cn('text-xs font-semibold', on && 'text-primary')}>{day.slice(0, 3)}</span>
              <span className="text-[10px] leading-tight tabular-nums sm:text-[11px]">{on ? entry?.startTime : 'Off'}</span>
              {on && <span className="text-[10px] leading-tight tabular-nums text-muted-foreground sm:text-[11px]">{entry?.endTime}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        {plural(workDays.length, 'working day')} · {Number.isInteger(weeklyHours) ? weeklyHours : weeklyHours.toFixed(1)} hours a week
      </p>
    </div>
  );
}

/** The next few holidays as dated rows, each with how far off it is. */
export function UpcomingHolidays({ figure }: { figure: Figure<UpcomingHoliday[]> }) {
  if (figure.status === 'loading') return <Skeleton className="h-[120px] w-full rounded-lg" />;
  if (figure.status === 'failed') return <Note>Holidays could not be loaded.</Note>;
  if (!figure.value.length) return <Note>No holidays are scheduled from today on.</Note>;
  return (
    <ul className="space-y-2">
      {figure.value.map((holiday) => {
        const date = fromIsoDay(holiday.date);
        return (
          <li key={`${holiday.date}-${holiday.name}`} className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2">
            <span className="flex w-11 shrink-0 flex-col items-center rounded-md bg-primary/10 py-1 text-primary" aria-hidden="true">
              <span className="text-[10px] font-semibold uppercase leading-none">{date?.toLocaleDateString('en-IN', { month: 'short' })}</span>
              <span className="text-lg font-bold leading-tight tabular-nums">{date?.getDate()}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{holiday.name}</p>
              <p className="truncate text-xs text-muted-foreground">{date?.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <Badge variant={holiday.inDays <= 7 ? 'info' : 'neutral'} className="shrink-0 font-medium">
              {inDaysLabel(holiday.inDays)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}

// ── Document numbers ─────────────────────────────────────────────────────────────────────────────

export interface DocumentNumberRow {
  series: DocumentSeries;
  /** `null` while the series has never been saved. */
  config: SerialNumberConfig | null;
}

/** Each series and the number it hands out next, named as a link to where its module sets it. */
export function DocumentNumberList({ figure }: { figure: Figure<DocumentNumberRow[]> }) {
  if (figure.status === 'loading') return <Skeleton className="h-[72px] w-full rounded-lg" />;
  if (figure.status === 'failed') return <Note>The series could not be loaded.</Note>;
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {figure.value.map(({ series, config }) => {
        const next = config ? nextDocumentNumber(series, config) : null;
        return (
          <li key={series.id} className="min-w-0 rounded-lg border px-3 py-2.5">
            <Link href={series.settingsHref} className="block truncate text-sm font-medium underline-offset-2 hover:text-primary hover:underline">
              {series.name}
            </Link>
            <p className="truncate text-[11px] text-muted-foreground">{series.moduleName}</p>
            <div className="mt-2">
              {config ? (
                next ? (
                  <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">{next}</code>
                ) : (
                  <Badge variant="danger">Invalid date format</Badge>
                )
              ) : (
                <Badge variant="warning">Not set up</Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
