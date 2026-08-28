'use client';

/**
 * The organisation-wide attendance register — the monthly summary greytHR's `insights` endpoint
 * returns, for everyone, gathered onto one screen instead of 1,300 separate profile visits.
 *
 * Not a muster roll. greytHR's day-level swipe data is a separate, much larger endpoint this
 * integration has never fetched — see docs/greythr-integration.md's deferred list. This shows exactly
 * what the employee profile's own "Attendance summary" tab shows for one person, as a register, so a
 * pattern across people is visible without opening every profile.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Download, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
  type HrTone,
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { attendanceLabel } from '@/lib/greythr';
import { exportRowsToExcel } from '@/lib/report-excel';
import {
  fetchAttendanceRegister,
  type AttendanceRegisterResponse,
  type AttendanceRegisterRow,
} from '@/lib/greythr-sync-client';

type Row = AttendanceRegisterRow & { id: string };

/**
 * How many rows are put in the DOM at once. The register is ~1,300 employees and the responsive
 * list renders a mobile card and a table row for each — position-details learned first that the
 * full set freezes the page. It grows on request; search and the department filter are the fast
 * way to a specific row.
 */
const PAGE_SIZE = 300;

export default function AttendanceRegisterPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [report, setReport] = useState<AttendanceRegisterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        setReport(await fetchAttendanceRegister());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the attendance register.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load(false);
  }, [authLoading, canView, load]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    for (const row of report?.rows ?? []) if (row.department) values.add(row.department);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [report]);

  const filtered = useMemo(() => {
    const rows = report?.rows ?? [];
    const query = search.trim().toLowerCase();
    const scoped = rows.filter((row) => {
      if (department !== 'all' && row.department !== department) return false;
      if (!query) return true;
      return [row.name, row.employeeNo, row.department, row.designation]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
    if (sortBy === 'name') return scoped;
    return scoped
      .slice()
      .sort((a, b) => (b.summary.days?.[sortBy] ?? 0) - (a.summary.days?.[sortBy] ?? 0));
  }, [report, search, department, sortBy]);

  const rows = useMemo<Row[]>(() => filtered.map((row) => ({ ...row, id: row.employeeId })), [filtered]);

  // Narrowing the filters should start again from the top of a short list, not halfway down a long one.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, department, sortBy]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);

  const lateInTotal = useMemo(
    () => (report?.rows ?? []).reduce((sum, row) => sum + (row.summary.days?.lateIn ?? 0), 0),
    [report],
  );

  /**
   * The two remaining KPI slots, in preference order. Only day types this tenant's data actually
   * reports get a card — a headline claiming "0 absences" out of data that never counted absences
   * would be a lie, not a statistic — so the list pads with figures the register always carries.
   */
  const extraKpis = useMemo(() => {
    const allRows = report?.rows ?? [];
    const dayTypes = report?.dayTypes ?? [];
    const total = (type: string) => allRows.reduce((sum, row) => sum + (row.summary.days?.[type] ?? 0), 0);
    const cards: Array<{ label: string; value: string | number; hint: string; tone: HrTone }> = [];
    if (dayTypes.includes('present') && allRows.length) {
      cards.push({
        label: 'Avg present days',
        value: (total('present') / allRows.length).toFixed(1),
        hint: 'per employee, this period',
        tone: 'emerald',
      });
    }
    if (dayTypes.includes('absent')) {
      cards.push({ label: 'Absent days', value: total('absent'), hint: 'across everyone, this period', tone: 'rose' });
    }
    if (dayTypes.includes('penalty')) {
      cards.push({ label: 'Penalty days', value: total('penalty'), hint: 'across everyone, this period', tone: 'violet' });
    }
    cards.push({
      label: 'Late at least once',
      value: allRows.filter((row) => (row.summary.days?.lateIn ?? 0) > 0).length,
      hint: 'employees with a late arrival',
      tone: 'blue',
    });
    cards.push({
      label: 'Awaiting summary',
      value: report?.missing ?? 0,
      hint: 'employees with nothing synced',
      tone: 'slate',
    });
    return cards.slice(0, 2);
  }, [report]);

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      await exportRowsToExcel(
        'Attendance register',
        filtered.map((row) => ({
          'Employee No': row.employeeNo,
          Name: row.name,
          Department: row.department,
          Designation: row.designation,
          ...Object.fromEntries(
            (report?.averageTypes ?? []).map((type) => [attendanceLabel(type), row.summary.averages?.[type] ?? '']),
          ),
          ...Object.fromEntries(
            (report?.dayTypes ?? []).map((type) => [attendanceLabel(type), row.summary.days?.[type] ?? 0]),
          ),
        })),
        { filename: 'attendance-register.xlsx' },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the register.');
    }
  };

  const columns: Array<HrListColumn<Row>> = [
    {
      header: 'Employee',
      mobile: 'title',
      cell: (row) => (
        <Link href={`/employee/${row.employeeId}`} className="font-medium text-slate-800 hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      header: 'Department · designation',
      mobile: 'detail',
      className: 'hidden md:table-cell',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {[row.designation, row.department].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    ...(report?.averageTypes ?? []).map<HrListColumn<Row>>((type) => ({
      header: attendanceLabel(type),
      align: 'right',
      mobile: 'aside',
      className: 'hidden lg:table-cell',
      cell: (row) => <span className="tabular-nums">{row.summary.averages?.[type] ?? '—'}</span>,
    })),
    ...(report?.dayTypes ?? []).map<HrListColumn<Row>>((type) => ({
      header: attendanceLabel(type),
      align: 'right',
      className: 'hidden xl:table-cell',
      cell: (row) => <span className="tabular-nums">{row.summary.days?.[type] ?? 0}</span>,
    })),
  ];

  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Loading the attendance register…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrAccessDenied what="the attendance register" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="mb-1 flex items-center gap-2">
        <Link href="/employee">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <HrPageHeader
        title="Attendance register"
        description={
          report?.period
            ? `${report.period.start} to ${report.period.end}, from greytHR's synced monthly summary. Not a day-by-day muster.`
            : "greytHR's synced monthly attendance summary, for everyone at once."
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void handleExport()} disabled={filtered.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
              Refresh
            </Button>
          </>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HrKpiCard
          label="Employees"
          value={report?.count ?? 0}
          hint={report?.missing ? `${report.missing} more not covered yet` : undefined}
          icon={Users}
          tone="indigo"
        />
        <HrKpiCard label="Late-in days" value={lateInTotal} hint="across everyone, this period" icon={Clock} tone="amber" />
        {extraKpis.map((kpi) => (
          <HrKpiCard key={kpi.label} label={kpi.label} value={kpi.value} hint={kpi.hint} tone={kpi.tone} />
        ))}
      </div>

      {report && report.missing > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {report.missing} employee{report.missing === 1 ? '' : 's'} have no attendance summary on
          record — usually because the &quot;Attendance summary&quot; group was enabled after their
          last sync. Run a sync from{' '}
          <Link href="/employee/sync" className="underline">
            greytHR Sync
          </Link>{' '}
          to pick them up.
        </p>
      )}

      <HrFilterCard summary={`${filtered.length} of ${report?.count ?? 0} employees`}>
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
            <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger><SelectValue placeholder="Sort by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Sort by name</SelectItem>
              {(report?.dayTypes ?? []).map((type) => (
                <SelectItem key={type} value={type}>Sort by {attendanceLabel(type).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </HrFilterCard>

      <div className="space-y-2.5">
        <HrDataList
          rows={visibleRows}
          columns={columns}
          empty={
            <HrEmptyState
              icon={UserCheck}
              title="No attendance records match"
              description={search || department !== 'all' ? 'Try a different search or department.' : 'Nothing synced yet.'}
            />
          }
        />

        {rows.length > 0 && (
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium text-slate-700">{visibleRows.length}</span> of {rows.length} employee
              {rows.length === 1 ? '' : 's'}
            </p>
            {visibleRows.length < rows.length && (
              <Button variant="outline" size="sm" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, rows.length - visibleRows.length)} more
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
