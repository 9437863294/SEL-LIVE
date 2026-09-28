'use client';

/**
 * One employee's month of days, as a grid.
 *
 * Split out of `/employee/swipes` so the page reads as data-and-layout rather than 150 lines of
 * table markup, and so this grid can be rendered outside the auth-gated route when it needs looking
 * at.
 *
 * Every value here is printed as greytHR sent it. In particular the punch times are wall-clock text
 * sliced out of the timestamp, never parsed through `Date` — greytHR reports shift times in UTC and
 * punches in local time inside the same record, so constructing a `Date` would move every arrival
 * by the host's offset. See the timezone note in `@/lib/greythr`.
 */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import { isSinglePunchDay, swipeStatusLabel, type EmployeeSwipeDay } from '@/lib/greythr';

/** `dd Mon, Day` — the weekday matters here, because a weekly off should look like one. */
const dayLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' });
};

/**
 * greytHR's day codes on the app's status tones — present green, absent rose, leave amber, on duty
 * blue, and the days nobody was expected to work (weekly off, holiday) neutral. The codes are
 * passed as `tone` because the shared vocabulary reads words, not "P" and "WO".
 */
export const SWIPE_DAY_TONE: Record<string, StatusTone> = {
  P: 'success',
  A: 'danger',
  WO: 'neutral',
  H: 'neutral',
  L: 'warning',
  OD: 'info',
};

export const swipeDayTone = (status: string): StatusTone => SWIPE_DAY_TONE[status] ?? 'neutral';

/** The day grid for one employee, rendered only when their row is open. */
export function SwipeDays({ days }: { days: EmployeeSwipeDay[] }) {
  if (!days.length) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">No days recorded for this month.</p>;
  }

  return (
    <div className="px-3 py-3">
      <Table className="min-w-[34rem] sm:min-w-[46rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Status</TableHead>
            {/* The widest column and the least urgent: on a phone it pushed First in and Last out
                — the two anybody opens this grid for — off the visible area. */}
            <TableHead className="hidden sm:table-cell">Shift</TableHead>
            <TableHead className="text-right">First in</TableHead>
            <TableHead className="text-right">Last out</TableHead>
            <TableHead className="text-right">Worked</TableHead>
            <TableHead className="text-right">Shortfall</TableHead>
            <TableHead>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((day) => (
            <TableRow key={day.date} className={cn(day.exceptions.length > 0 && 'bg-amber-50/40')}>
              <TableCell className="whitespace-nowrap font-medium">{dayLabel(day.date)}</TableCell>
              <TableCell>
                <StatusBadge status={day.status} tone={swipeDayTone(day.status)} title={swipeStatusLabel(day.status)}>
                  {day.status || '—'}
                </StatusBadge>
              </TableCell>
              <TableCell className="hidden max-w-[12rem] truncate sm:table-cell" title={day.shift}>
                {day.shift || '—'}
              </TableCell>
              {/* Wall-clock, exactly as greytHR sent it — never re-parsed through a Date, which would
                  shift every punch by the server's offset. */}
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {day.firstIn ?? '—'}
              </TableCell>
              {/* A single punch is not a departure at the same minute as the arrival — see
                  `isSinglePunchDay`. Printing the pair would assert a zero-length working day. */}
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {isSinglePunchDay(day) ? <span className="text-muted-foreground">—</span> : (day.lastOut ?? '—')}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums font-medium">
                {day.workHrs ?? '—'}
              </TableCell>
              {/* Rose only when there *is* a shortfall. A rose em dash on a weekly off reads as a
                  warning about a day nobody was expected to work. */}
              <TableCell
                className={cn(
                  'whitespace-nowrap text-right tabular-nums',
                  day.shortfallHrs ? 'text-rose-700' : 'text-muted-foreground',
                )}
              >
                {day.shortfallHrs ?? '—'}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {day.exceptions.map((exception) => (
                    <StatusBadge key={exception} tone="warning">
                      {exception}
                    </StatusBadge>
                  ))}
                  {isSinglePunchDay(day) && <StatusBadge status="Single punch" tone="warning" />}
                  {day.regularized && <StatusBadge status="Regularised" tone="info" />}
                  {day.onLeave && <StatusBadge status="On leave" tone="warning" />}
                  {day.absentReason && !day.exceptions.length && (
                    <span className="text-[10px] text-muted-foreground">{day.absentReason}</span>
                  )}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
