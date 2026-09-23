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

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { isSinglePunchDay, swipeStatusLabel, type EmployeeSwipeDay } from '@/lib/greythr';

/** `dd Mon, Day` — the weekday matters here, because a weekly off should look like one. */
const dayLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' });
};

/** Present green, absent rose, everything else neutral — the statuses a reader scans for. */
export const STATUS_TONE: Record<string, string> = {
  P: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  A: 'border-rose-200 bg-rose-50 text-rose-700',
  WO: 'border-slate-200 bg-slate-50 text-slate-500',
  H: 'border-violet-200 bg-violet-50 text-violet-700',
  L: 'border-amber-200 bg-amber-50 text-amber-800',
  OD: 'border-blue-200 bg-blue-50 text-blue-700',
};

export const statusTone = (status: string): string =>
  STATUS_TONE[status] ?? 'border-slate-200 bg-white text-slate-600';

/** The day grid for one employee, rendered only when their row is open. */
export function SwipeDays({ days }: { days: EmployeeSwipeDay[] }) {
  if (!days.length) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">No days recorded for this month.</p>;
  }

  return (
    <div className="overflow-x-auto px-3 py-3">
      <table className="w-full min-w-[34rem] sm:min-w-[46rem] text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5">Date</th>
            <th className="px-2 py-1.5">Status</th>
            {/* The widest column and the least urgent: on a phone it pushed First in and Last out
                — the two anybody opens this grid for — off the visible area. */}
            <th className="hidden px-2 py-1.5 sm:table-cell">Shift</th>
            <th className="px-2 py-1.5 text-right">First in</th>
            <th className="px-2 py-1.5 text-right">Last out</th>
            <th className="px-2 py-1.5 text-right">Worked</th>
            <th className="px-2 py-1.5 text-right">Shortfall</th>
            <th className="px-2 py-1.5">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {days.map((day) => (
            <tr key={day.date} className={cn(day.exceptions.length > 0 && 'bg-amber-50/40')}>
              <td className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-700">{dayLabel(day.date)}</td>
              <td className="px-2 py-1.5">
                <Badge
                  variant="outline"
                  className={cn('text-[10px] font-medium', statusTone(day.status))}
                  title={swipeStatusLabel(day.status)}
                >
                  {day.status || '—'}
                </Badge>
              </td>
              <td className="hidden max-w-[12rem] truncate px-2 py-1.5 text-muted-foreground sm:table-cell" title={day.shift}>
                {day.shift || '—'}
              </td>
              {/* Wall-clock, exactly as greytHR sent it — never re-parsed through a Date, which would
                  shift every punch by the server's offset. */}
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-800">
                {day.firstIn ?? '—'}
              </td>
              {/* A single punch is not a departure at the same minute as the arrival — see
                  `isSinglePunchDay`. Printing the pair would assert a zero-length working day. */}
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-800">
                {isSinglePunchDay(day) ? <span className="text-muted-foreground">—</span> : (day.lastOut ?? '—')}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">
                {day.workHrs ?? '—'}
              </td>
              {/* Rose only when there *is* a shortfall. A rose em dash on a weekly off reads as a
                  warning about a day nobody was expected to work. */}
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-1.5 text-right tabular-nums',
                  day.shortfallHrs ? 'text-rose-700' : 'text-muted-foreground',
                )}
              >
                {day.shortfallHrs ?? '—'}
              </td>
              <td className="px-2 py-1.5">
                <span className="flex flex-wrap gap-1">
                  {day.exceptions.map((exception) => (
                    <Badge
                      key={exception}
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-[10px] text-amber-800"
                    >
                      {exception}
                    </Badge>
                  ))}
                  {isSinglePunchDay(day) && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                      Single punch
                    </Badge>
                  )}
                  {day.regularized && (
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] text-blue-700">
                      Regularised
                    </Badge>
                  )}
                  {day.onLeave && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                      On leave
                    </Badge>
                  )}
                  {day.absentReason && !day.exceptions.length && (
                    <span className="text-[10px] text-muted-foreground">{day.absentReason}</span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
