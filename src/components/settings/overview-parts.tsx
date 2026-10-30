'use client';

/**
 * The pieces of Settings › Overview that only draw what they are given: the account card, the
 * working-week strip and the next document numbers. The page loads the figures; each piece shows
 * a placeholder while its figure loads and a short line when it failed.
 */

import type { LucideIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { nextDocumentNumber, type DocumentSeries } from '@/lib/document-numbers';
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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

export interface AccountFact {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}

/** Who is signed in, their roles, and a couple of facts about their own account. */
export function OverviewAccount({
  name,
  email,
  photoURL,
  roles,
  facts,
}: {
  name: string;
  email?: string;
  photoURL?: string;
  roles: string[];
  facts: AccountFact[];
}) {
  return (
    <Card className="min-w-0 [--card-pad:1rem]">
      <CardContent className="flex flex-col gap-4 pt-[var(--card-pad)] md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-12 w-12 shrink-0">
            {photoURL && <AvatarImage src={photoURL} alt="" />}
            <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">{name || 'Signed in'}</p>
            {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
            {roles.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {roles.slice(0, 4).map((role) => (
                  <Badge key={role} variant="neutral" className="max-w-[14rem] truncate font-medium">
                    {role}
                  </Badge>
                ))}
                {roles.length > 4 && <Badge variant="outline">+{roles.length - 4}</Badge>}
              </div>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 md:w-[26rem] md:shrink-0">
          {facts.map(({ icon: Icon, label, value, hint }) => (
            <div key={label} className="flex min-w-0 items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                {/* Wrapped, not cut: half a phone's width is too narrow for "Follows the device". */}
                <dd className="break-words text-sm font-semibold leading-snug">{value}</dd>
                {hint && <dd className="break-words text-[11px] leading-snug text-muted-foreground">{hint}</dd>}
              </div>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** The seven days, each with its hours or "Off", and the week's totals. */
export function WorkingWeekStrip({ figure }: { figure: Figure<WorkingHours | null> }) {
  if (figure.status === 'loading') return <Skeleton className="h-[72px] w-full rounded-lg" />;
  if (figure.status === 'failed') return <p className="text-sm text-muted-foreground">The schedule could not be loaded.</p>;
  const schedule = figure.value;
  if (!schedule) return <p className="text-sm text-muted-foreground">No working hours have been saved yet.</p>;
  const workDays = WEEK_DAYS.filter((day) => schedule[day]?.isWorkDay);
  const weeklyHours = workDays.reduce((sum, day) => sum + hoursBetween(schedule[day]?.startTime, schedule[day]?.endTime), 0);
  return (
    <div className="space-y-3">
      <ol className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEK_DAYS.map((day) => {
          const entry = schedule[day];
          const on = Boolean(entry?.isWorkDay);
          return (
            <li
              key={day}
              className={cn(
                'flex min-w-0 flex-col items-center gap-0.5 rounded-lg border px-0.5 py-2 text-center',
                on ? 'border-primary/25 bg-primary/5' : 'border-dashed bg-muted/30 text-muted-foreground',
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

export interface DocumentNumberRow {
  series: DocumentSeries;
  /** `null` while the series has never been saved. */
  config: SerialNumberConfig | null;
}

/** Each series and the number it hands out next. */
export function DocumentNumberList({ figure }: { figure: Figure<DocumentNumberRow[]> }) {
  if (figure.status === 'loading') return <Skeleton className="h-[108px] w-full rounded-lg" />;
  if (figure.status === 'failed') return <p className="text-sm text-muted-foreground">The series could not be loaded.</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {figure.value.map(({ series, config }) => {
        const next = config ? nextDocumentNumber(series, config) : null;
        return (
          <li key={series.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5">
            <span className="min-w-0 text-sm font-medium">{series.name}</span>
            {config ? (
              <code className="min-w-0 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{next ?? 'Invalid date format'}</code>
            ) : (
              <Badge variant="warning">Not set up</Badge>
            )}
          </li>
        );
      })}
    </ul>
  );
}
