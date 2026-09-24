'use client';

/**
 * The daily swipe register — who was in, when, and what greytHR flagged about it.
 *
 * ── What this can and cannot show ───────────────────────────────────────────────────────────────
 *
 * One first-in and one last-out per day, because that is all greytHR's API publishes. There is no
 * raw punch list: `/attendance/v2/employee/muster` is the only day-level endpoint, and `/swipes`,
 * `/punches`, `/logs`, `/transactions` and `swipes=true`-style parameters on muster were all probed
 * against a live tenant and return 404 or nothing extra. So a lunch break taken and returned from is
 * invisible here, and the register says so rather than implying it holds every tap of a card.
 *
 * ── Why a month at a time ───────────────────────────────────────────────────────────────────────
 *
 * The data is stored one document per employee per month (`swipeDocId`), which is the unit the
 * integration doc's retention concern actually wants: a document per swipe would be tens of
 * thousands a month, a month per person is about one per employee. The month selector therefore
 * picks a *stored* month, and **Fetch from greytHR** is what puts one there — the nightly sync only
 * maintains the current month, and only when the Daily swipes detail group is enabled.
 *
 * The register is one row per employee with their month summarised, and a row expands into the
 * day-by-day grid. Thirty days × 135 employees is four thousand cells; rendering them all at once
 * is the mistake the other registers in this module already learned, so the days are rendered only
 * for the row a reader opened.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  DownloadCloud,
  Fingerprint,
  Loader2,
  RefreshCw,
  Search,
  Timer,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  HrAccessDenied,
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrLoader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { SwipeDays, statusTone } from '@/components/employee/swipe-days';
import {
  EmployeeErrorBanner,
  EmployeeHeader,
  EmployeeKpiCard,
  EmployeeListFooter,
  EmployeePageShell,
  EmployeeStatusPill,
  EmployeeSubNav,
  EMP_REGISTER_HEIGHT,
} from '@/components/employee/employee-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  isSinglePunchDay,
  summarizeSwipeDays,
  swipeHours,
  swipeMonthKey,
  swipeStatusLabel,
  type EmployeeSwipeDay,
} from '@/lib/greythr';
import {
  fetchSwipeMonthFromGreytHR,
  fetchSwipeRegister,
  type SwipeRegisterResponse,
  type SwipeRegisterRow,
} from '@/lib/greythr-sync-client';

type Row = SwipeRegisterRow & { id: string };
/** An employee plus the one day being looked at. */
type DayRow = SwipeRegisterRow & { id: string; day: EmployeeSwipeDay };

/** Rows in the DOM at once, as everywhere else in the module. */
const PAGE_SIZE = 200;

/** How many months back the selector offers. Beyond a year the store is unlikely to hold anything. */
const MONTH_CHOICES = 15;

/** `Tue, 16 September 2026` — the picker needs the weekday and the year. */
const fullDayLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
};

const monthLabel = (month: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

export default function SwipeRegisterPage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  const [month, setMonth] = useState(() => swipeMonthKey());
  const [report, setReport] = useState<SwipeRegisterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /**
   * Which question the register is answering.
   *
   * `month` is one row per employee with their month summarised — "how has this person been". `date`
   * is one row per employee for a single day — "who was in on the 16th, and when". Both read the same
   * stored documents; the second is a reshape, not another fetch.
   */
  const [view, setView] = useState<'month' | 'date'>('month');
  const [date, setDate] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTH_CHOICES }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    });
  }, []);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        setReport(await fetchSwipeRegister(target));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the swipe register.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load(month);
  }, [authLoading, canView, load, month]);

  // A new month, a narrowed filter: start from the top of the list rather than halfway down.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setOpenId(null);
  }, [month, search, department, onlyFlagged]);

  const handleFetch = async () => {
    setFetching(true);
    setError(null);
    try {
      const result = await fetchSwipeMonthFromGreytHR(month);
      setReport(result);
      toast({
        title: `${monthLabel(month)} fetched`,
        description:
          `${result.written} employee month(s) stored from ${result.fetched} returned by greytHR` +
          (result.skipped ? `, ${result.skipped} with nothing recorded` : '') +
          (result.complete ? '.' : ' — the muster did not page to the end, so this month may be partial.'),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not fetch the muster from greytHR.';
      setError(message);
      toast({ title: 'Fetch failed', description: message, variant: 'destructive' });
    } finally {
      setFetching(false);
    }
  };

  /**
   * The dates this month's documents actually carry.
   *
   * Taken from the data rather than generated from the month, so the picker cannot offer the 31st of
   * a month greytHR only answered ten days of — an empty day and a day nobody worked look identical
   * on screen, and only one of them is a fact.
   */
  const dates = useMemo(() => {
    const seen = new Set<string>();
    for (const row of report?.rows ?? []) for (const day of row.month.days) seen.add(day.date);
    return [...seen].sort((a, b) => b.localeCompare(a));
  }, [report]);

  // Default to the most recent day the data covers, and follow the month when it changes.
  useEffect(() => {
    if (!dates.length) {
      setDate('');
      return;
    }
    if (!dates.includes(date)) setDate(dates[0]);
  }, [dates, date]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    for (const row of report?.rows ?? []) if (row.department) values.add(row.department);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [report]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (report?.rows ?? []).filter((row) => {
      if (department !== 'all' && row.department !== department) return false;
      if (onlyFlagged && row.month.totals.lateIn + row.month.totals.earlyOut === 0) return false;
      if (!query) return true;
      return [row.name, row.employeeNo, row.employeeId, row.department, row.designation]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [report, search, department, onlyFlagged]);

  const rows = useMemo<Row[]>(() => filtered.map((row) => ({ ...row, id: row.employeeId })), [filtered]);

  /**
   * One row per employee for the selected date.
   *
   * Sorted by first punch, earliest first, with the unpunched at the end: reading down the column
   * then tells you the order people actually arrived, which is the thing a day view is for. An
   * employee with no entry for the date is left out entirely rather than shown as absent — greytHR
   * not answering for somebody is not a statement that they did not come in.
   */
  const dayRows = useMemo<DayRow[]>(() => {
    if (!date) return [];
    return filtered
      .flatMap((row) => {
        const day = row.month.days.find((entry) => entry.date === date);
        return day ? [{ ...row, id: row.employeeId, day }] : [];
      })
      .sort((a, b) => {
        if (Boolean(a.day.firstIn) !== Boolean(b.day.firstIn)) return a.day.firstIn ? -1 : 1;
        if (a.day.firstIn && b.day.firstIn) return a.day.firstIn.localeCompare(b.day.firstIn);
        return (a.name || a.employeeId).localeCompare(b.name || b.employeeId);
      });
  }, [filtered, date]);

  /** The day's own totals, from the same helper the month rows use. */
  const dayTotals = useMemo(() => summarizeSwipeDays(dayRows.map((row) => row.day)), [dayRows]);
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);

  const filtersActive = search.trim() !== '' || department !== 'all' || onlyFlagged;

  /** Averaged over the employees actually shown, so it agrees with the rows beneath it. */
  const averageWorked = useMemo(() => {
    const withWork = filtered.filter((row) => row.month.totals.workMinutes > 0);
    if (!withWork.length) return null;
    const minutes = withWork.reduce((sum, row) => sum + row.month.totals.workMinutes, 0) / withWork.length;
    return swipeHours(minutes);
  }, [filtered]);

  /** One row per employee for the selected day — what the by-date view is showing. */
  const handleExportDay = async () => {
    if (!dayRows.length) return;
    try {
      await exportRowsToExcel(
        `Swipes ${date}`,
        dayRows.map((row) => ({
          'Employee No': row.employeeNo,
          Name: row.name || `Employee ${row.employeeId}`,
          Department: row.department,
          Designation: row.designation,
          Date: row.day.date,
          Status: row.day.status,
          'Status meaning': swipeStatusLabel(row.day.status),
          Shift: row.day.shift,
          'First in': row.day.firstIn ?? '',
          'Last out': isSinglePunchDay(row.day) ? '' : (row.day.lastOut ?? ''),
          'Single punch': isSinglePunchDay(row.day) ? 'Yes' : 'No',
          Worked: row.day.workHrs ?? '',
          Shortfall: row.day.shortfallHrs ?? '',
          Flags: row.day.exceptions.join(', '),
          'Absent reason': row.day.absentReason ?? '',
        })),
        { filename: `swipes-${date}.xlsx` },
      );
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not build the workbook.',
        variant: 'destructive',
      });
    }
  };

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      /*
        Exported one row per employee per *day*, not per month. A workbook of monthly totals is
        already on screen; the reason to export a swipe register is to work through the days in a
        spreadsheet.
      */
      const flat = filtered.flatMap((row) =>
        row.month.days.map((day) => ({
          'Employee No': row.employeeNo,
          Name: row.name || `Employee ${row.employeeId}`,
          Department: row.department,
          Designation: row.designation,
          Date: day.date,
          Status: day.status,
          'Status meaning': swipeStatusLabel(day.status),
          Shift: day.shift,
          'First in': day.firstIn ?? '',
          'Last out': day.lastOut ?? '',
          Worked: day.workHrs ?? '',
          'Actual worked': day.actualWorkHrs ?? '',
          Shortfall: day.shortfallHrs ?? '',
          Excess: day.excessHrs ?? '',
          Flags: day.exceptions.join(', '),
          'Absent reason': day.absentReason ?? '',
          Regularised: day.regularized ? 'Yes' : 'No',
        })),
      );
      await exportRowsToExcel(`Daily swipes ${month}`, flat, { filename: `daily-swipes-${month}.xlsx` });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not build the workbook.',
        variant: 'destructive',
      });
    }
  };

  const columns: Array<HrListColumn<Row>> = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <span className="block">
          <span className={cn('font-medium', row.name ? 'text-slate-800' : 'text-slate-500')}>
            {row.name || `Employee ${row.employeeId}`}
          </span>
          {!row.inMirror && (
            <span className="block text-[11px] font-normal text-amber-700">Not in the roster mirror</span>
          )}
        </span>
      ),
    },
    {
      header: 'Department · designation',
      mobile: 'detail',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {[row.designation, row.department].filter(Boolean).join(' · ') || (row.inMirror ? '—' : 'Unknown')}
        </span>
      ),
    },
    {
      header: 'Days swiped',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (
        <span className="tabular-nums">
          <span className="font-medium text-slate-800">{row.month.totals.swiped}</span>
          <span className="text-muted-foreground"> / {row.month.totals.daysRecorded}</span>
        </span>
      ),
    },
    {
      header: 'Present',
      align: 'right',
      mobile: 'detail',
      className: 'hidden sm:table-cell',
      cell: (row) => <span className="tabular-nums text-emerald-700">{row.month.totals.present}</span>,
    },
    {
      header: 'Absent',
      align: 'right',
      mobile: 'detail',
      className: 'hidden sm:table-cell',
      cell: (row) => (
        <span className={cn('tabular-nums', row.month.totals.absent > 0 ? 'text-rose-700' : 'text-muted-foreground')}>
          {row.month.totals.absent}
        </span>
      ),
    },
    {
      header: 'Worked',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (
        <span className="tabular-nums font-medium text-slate-800">{swipeHours(row.month.totals.workMinutes)}</span>
      ),
    },
    {
      header: 'Flags',
      align: 'right',
      mobile: 'aside',
      cell: (row) => {
        const flags = row.month.totals.lateIn + row.month.totals.earlyOut;
        if (!flags) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
            {row.month.totals.lateIn > 0 && `${row.month.totals.lateIn} late`}
            {row.month.totals.lateIn > 0 && row.month.totals.earlyOut > 0 && ' · '}
            {row.month.totals.earlyOut > 0 && `${row.month.totals.earlyOut} early`}
          </Badge>
        );
      },
    },
  ];

  const dayColumns: Array<HrListColumn<DayRow>> = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <span className="block">
          <span className={cn('font-medium', row.name ? 'text-slate-800' : 'text-slate-500')}>
            {row.name || `Employee ${row.employeeId}`}
          </span>
          <span className="block text-[11px] font-normal text-muted-foreground">
            {[row.designation, row.department].filter(Boolean).join(' · ') || (row.inMirror ? '' : 'Not in the roster mirror')}
          </span>
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'aside',
      cell: (row) => (
        <Badge
          variant="outline"
          className={cn('text-[10px] font-medium', statusTone(row.day.status))}
          title={swipeStatusLabel(row.day.status)}
        >
          {row.day.status || '—'}
        </Badge>
      ),
    },
    {
      header: 'First in',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (
        <span className="tabular-nums font-medium text-slate-800">{row.day.firstIn ?? '—'}</span>
      ),
    },
    {
      header: 'Last out',
      align: 'right',
      mobile: 'detail',
      cell: (row) => (
        <span className="tabular-nums text-slate-800">
          {isSinglePunchDay(row.day) ? <span className="text-muted-foreground">—</span> : (row.day.lastOut ?? '—')}
        </span>
      ),
    },
    {
      header: 'Worked',
      align: 'right',
      mobile: 'detail',
      cell: (row) => <span className="tabular-nums text-slate-800">{row.day.workHrs ?? '—'}</span>,
    },
    {
      header: 'Shift',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <span className="block max-w-[14rem] truncate text-xs text-muted-foreground" title={row.day.shift}>
          {row.day.shift || '—'}
        </span>
      ),
    },
    {
      header: 'Flags',
      mobile: 'footer',
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.day.exceptions.map((exception) => (
            <Badge key={exception} variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              {exception}
            </Badge>
          ))}
          {isSinglePunchDay(row.day) && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              Single punch
            </Badge>
          )}
          {row.day.onLeave && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-800">
              On leave
            </Badge>
          )}
          {!row.day.exceptions.length && !row.day.onLeave && !isSinglePunchDay(row.day) && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
  ];

  if (authLoading || loading) {
    return (
      <EmployeePageShell>
        <HrLoader label={`Loading swipes for ${monthLabel(month)}…`} />
      </EmployeePageShell>
    );
  }

  if (!canView) {
    return (
      <EmployeePageShell>
        <EmployeeHeader
          icon={Fingerprint}
          tone="violet"
          eyebrow="Employee management"
          title="Daily swipes"
          backHref="/employee"
          backLabel="Back to Employee Management"
        />
        <HrAccessDenied what="the swipe register" />
      </EmployeePageShell>
    );
  }

  const totals = report?.totals;

  return (
    <EmployeePageShell>
      <EmployeeHeader
        icon={Fingerprint}
        tone="violet"
        eyebrow="Employee management"
        title="Daily swipes"
        backHref="/employee"
        backLabel="Back to Employee Management"
        status={
          <>
            <EmployeeStatusPill tone="violet" icon={CalendarDays}>
              {monthLabel(month)}
            </EmployeeStatusPill>
            {report?.syncedAt ? (
              <EmployeeStatusPill tone="emerald" icon={Clock}>
                Stored
              </EmployeeStatusPill>
            ) : (
              <EmployeeStatusPill tone="amber" icon={Clock}>
                Not fetched yet
              </EmployeeStatusPill>
            )}
          </>
        }
        meta={
          report?.period?.start
            ? `${report.period.start} to ${report.period.end}`
            : undefined
        }
        actions={
          <>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[160px] bg-white/80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((value) => (
                  <SelectItem key={value} value={value}>
                    {monthLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="bg-white/80"
              onClick={() => void (view === 'date' ? handleExportDay() : handleExport())}
              disabled={view === 'date' ? dayRows.length === 0 : filtered.length === 0}
            >
              <DownloadCloud className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            {canSync && (
              <Button size="sm" onClick={() => void handleFetch()} disabled={fetching}>
                {fetching ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                )}
                Fetch from greytHR
              </Button>
            )}
          </>
        }
      />

      <EmployeeSubNav current="swipes" />

      {error && <EmployeeErrorBanner onRetry={() => void load(month)}>{error}</EmployeeErrorBanner>}

      {/* ── Which question, and for when ─────────────────────────────────────────────────────
          A segmented switch rather than a third tab in the module nav: both views are the same
          register over the same stored data, and a reader flips between them constantly — "this
          person's month" and "everybody on the 16th" are two readings of one dataset. */}
      {report && report.count > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-white/70 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm">
            {(
              [
                ['month', 'By employee', CalendarDays],
                ['date', 'By date', Fingerprint],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  view === value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {view === 'date' && dates.length > 0 && (
            <>
              <Select value={date} onValueChange={setDate}>
                <SelectTrigger className="w-[190px] bg-white/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dates.map((value) => (
                    <SelectItem key={value} value={value}>
                      {fullDayLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Only the days greytHR actually answered for are offered — see `dates`. */}
              <span className="text-[11px] text-muted-foreground">
                {dates.length} day{dates.length === 1 ? '' : 's'} stored for {monthLabel(month)}
              </span>
            </>
          )}
        </div>
      )}

      {report && report.count > 0 && view === 'month' && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <EmployeeKpiCard
            label="Employees"
            value={report.count}
            hint={filtersActive ? `${filtered.length} match your filters` : monthLabel(month)}
            icon={Users}
            tone="violet"
            index={0}
          />
          <EmployeeKpiCard
            label="Days swiped"
            value={totals?.swiped ?? 0}
            hint={`of ${(totals?.daysRecorded ?? 0).toLocaleString()} recorded`}
            icon={Fingerprint}
            tone="indigo"
            index={1}
          />
          <EmployeeKpiCard
            label="Average worked"
            value={averageWorked ?? '—'}
            hint="per employee, this month"
            icon={Timer}
            tone="emerald"
            index={2}
          />
          <EmployeeKpiCard
            label="Late / early"
            value={`${totals?.lateIn ?? 0} / ${totals?.earlyOut ?? 0}`}
            hint="days greytHR flagged"
            icon={AlertTriangle}
            tone={(totals?.lateIn ?? 0) + (totals?.earlyOut ?? 0) > 0 ? 'amber' : 'slate'}
            index={3}
          />
        </div>
      )}

      {/* The same four figures, for one day rather than the month. */}
      {report && report.count > 0 && view === 'date' && (
        <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <EmployeeKpiCard
            label="On the roster"
            value={dayRows.length}
            hint={date ? fullDayLabel(date) : undefined}
            icon={Users}
            tone="violet"
            index={0}
          />
          <EmployeeKpiCard
            label="Swiped in"
            value={dayTotals.swiped}
            hint={`${dayRows.length - dayTotals.swiped} with no punch`}
            icon={Fingerprint}
            tone="indigo"
            index={1}
          />
          <EmployeeKpiCard
            label="Present / absent"
            value={`${dayTotals.present} / ${dayTotals.absent}`}
            hint="counting half days as halves"
            icon={Timer}
            tone="emerald"
            index={2}
          />
          <EmployeeKpiCard
            label="Late / early"
            value={`${dayTotals.lateIn} / ${dayTotals.earlyOut}`}
            hint="flagged by greytHR"
            icon={AlertTriangle}
            tone={dayTotals.lateIn + dayTotals.earlyOut > 0 ? 'amber' : 'slate'}
            index={3}
          />
        </div>
      )}

      {report && report.unidentified > 0 && (
        <div className="mb-3">
          <HrAlertNotice
            tone="amber"
            title={`${report.unidentified} of ${report.count} rows could not be matched to an employee`}
          >
            greytHR has swipes for these employee ids but no employee record exists here for them. Run a
            full sync from{' '}
            <Link href="/employee/sync" className="font-medium underline">
              greytHR Sync
            </Link>{' '}
            to fetch the missing employees.
          </HrAlertNotice>
        </div>
      )}

      {report && report.count === 0 ? (
        <HrEmptyState
          icon={Fingerprint}
          title={`No swipes stored for ${monthLabel(month)}`}
          description={
            canSync
              ? 'Nothing has been fetched for this month yet. Fetch it from greytHR now, or enable the "Daily swipes" group in the sync console so each run keeps the current month up to date.'
              : 'Nothing has been fetched for this month yet. Ask someone with sync permission to fetch it, or pick another month.'
          }
          action={
            canSync ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => void handleFetch()} disabled={fetching}>
                  {fetching ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-4 w-4" />
                  )}
                  Fetch {monthLabel(month)}
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/employee/sync">Open sync console</Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <>
          <HrFilterCard
            summary={
              filtersActive
                ? `${filtered.length} of ${report?.count ?? 0} employees`
                : `${report?.count ?? 0} employees · ${(totals?.daysRecorded ?? 0).toLocaleString()} days`
            }
            actions={
              filtersActive ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    setDepartment('all');
                    setOnlyFlagged(false);
                  }}
                >
                  Clear
                </Button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search name, employee no…"
                  className="pl-8"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={onlyFlagged ? 'flagged' : 'all'} onValueChange={(value) => setOnlyFlagged(value === 'flagged')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="flagged">Only late or early days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </HrFilterCard>

          <div className="space-y-2.5">
            {/* A row opens into its own month; `expandedId` keeps one open at a time, so the four
                thousand cells a full month across everybody would need are never all in the DOM. */}
            {view === 'month' ? (
              <>
                <HrDataList
                  rows={visibleRows}
                  columns={columns}
                  dense
                  maxHeightClassName={EMP_REGISTER_HEIGHT}
                  onRowClick={(row) => setOpenId((current) => (current === row.id ? null : row.id))}
                  expandedId={openId}
                  renderExpanded={(row) => <SwipeDays days={row.month.days} />}
                  empty={
                    <HrEmptyState
                      icon={Search}
                      title="No employees match these filters"
                      description="Try a different name, department, or turn off the flagged-days filter."
                    />
                  }
                />

                <EmployeeListFooter
                  shown={visibleRows.length}
                  total={rows.length}
                  noun="employee"
                  pageSize={PAGE_SIZE}
                  onMore={() => setVisibleCount((count) => count + PAGE_SIZE)}
                />
              </>
            ) : (
              /* One day, everybody. Ordered by first punch, so the column reads as the order people
                 actually arrived. No windowing: a single day is one row per employee. */
              <HrDataList
                rows={dayRows}
                columns={dayColumns}
                dense
                maxHeightClassName={EMP_REGISTER_HEIGHT}
                empty={
                  <HrEmptyState
                    icon={Fingerprint}
                    title={date ? `Nothing recorded on ${fullDayLabel(date)}` : 'Pick a date'}
                    description={
                      filtersActive
                        ? 'No employee matching these filters has an entry for this date.'
                        : 'greytHR returned no muster rows for this day. A day it never answered for is not the same as a day nobody worked.'
                    }
                  />
                }
              />
            )}
          </div>
        </>
      )}
    </EmployeePageShell>
  );
}
