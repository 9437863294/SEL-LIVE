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
import { ArrowLeft, Clock, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
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
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { attendanceLabel } from '@/lib/greythr';
import {
  fetchAttendanceRegister,
  type AttendanceRegisterResponse,
  type AttendanceRegisterRow,
} from '@/lib/greythr-sync-client';

type Row = AttendanceRegisterRow & { id: string };

export default function AttendanceRegisterPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [report, setReport] = useState<AttendanceRegisterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');

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
    return rows.filter((row) => {
      if (department !== 'all' && row.department !== department) return false;
      if (!query) return true;
      return [row.name, row.employeeNo, row.department, row.designation]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query));
    });
  }, [report, search, department]);

  const rows: Row[] = filtered.map((row) => ({ ...row, id: row.employeeId }));

  // Late-in days is the single figure worth a KPI: it is the one number an administrator scanning
  // this register is usually looking for. The rest stay in the table, where every average and day
  // type greytHR reports gets its own column.
  const lateInTotal = useMemo(
    () => (report?.rows ?? []).reduce((sum, row) => sum + (row.summary.days?.lateIn ?? 0), 0),
    [report],
  );

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

  if (authLoading || loading) return <HrLoader label="Loading the attendance register…" />;
  if (!canView) return <HrAccessDenied what="the attendance register" />;

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2">
        <Link href="/employee">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Employee Management
        </Link>
      </Button>

      <HrPageHeader
        title="Attendance register"
        description={
          report?.period
            ? `${report.period.start} to ${report.period.end}, from greytHR's synced monthly summary. Not a day-by-day muster.`
            : "greytHR's synced monthly attendance summary, for everyone at once."
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HrKpiCard label="Employees" value={report?.count ?? 0} icon={Users} tone="indigo" />
        <HrKpiCard label="Late-in days" value={lateInTotal} hint="across everyone, this period" icon={Clock} tone="amber" />
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
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
        </div>
      </HrFilterCard>

      <HrDataList
        rows={rows}
        columns={columns}
        empty={
          <HrEmptyState
            icon={UserCheck}
            title="No attendance records match"
            description={search || department !== 'all' ? 'Try a different search or department.' : 'Nothing synced yet.'}
          />
        }
      />
    </div>
  );
}
