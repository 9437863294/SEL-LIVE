'use client';

/**
 * The organisation-wide leave register.
 *
 * Existed before only as ~1,300 separate profile visits — the sync has written a leave balance
 * document per employee for as long as the detail group has been on, but nothing surfaced them
 * together. This is the register that answers "who is sitting on the most unused leave" and "how
 * many days does the organisation owe in total", which a per-employee tab cannot.
 *
 * Read-only, deliberately. Applying, approving or rejecting leave writes back to greytHR, and this
 * integration does not do that yet (docs/greythr-integration.md §12) — this shows what greytHR has
 * already decided, not a place to decide it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, Download, RefreshCw, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { exportRowsToExcel } from '@/lib/report-excel';
import { fetchLeaveRegister, type LeaveRegisterResponse, type LeaveRegisterRow } from '@/lib/greythr-sync-client';

type Row = LeaveRegisterRow & { id: string };

/**
 * How many rows are put in the DOM at once. Same lesson as position-details: the responsive list
 * renders a mobile card and a table row per employee, and ~1,300 of each froze the page. It grows
 * on request; search and the department filter are the fast way to a specific row.
 */
const PAGE_SIZE = 300;

export default function LeaveRegisterPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [report, setReport] = useState<LeaveRegisterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [sortType, setSortType] = useState<string>('total');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        setReport(await fetchLeaveRegister());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the leave register.');
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

  const balanceOf = useCallback(
    (row: LeaveRegisterRow, type: string) =>
      row.balance.lines.find((line) => line.leaveType === type)?.balance ?? 0,
    [],
  );

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
    const value = (row: LeaveRegisterRow) =>
      sortType === 'total' ? row.balance.totalBalance : balanceOf(row, sortType);
    return scoped.slice().sort((a, b) => value(b) - value(a));
  }, [report, search, department, sortType, balanceOf]);

  const rows = useMemo<Row[]>(() => filtered.map((row) => ({ ...row, id: row.employeeId })), [filtered]);

  // Narrowing the filters should start again from the top of a short list, not halfway down a long one.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, department, sortType]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);

  // The per-type KPI cards take whatever leave types exist, so the grid's column count follows the
  // actual card count instead of leaving a ragged tail when a tenant has fewer than two types.
  const typeKpis = (report?.leaveTypes ?? []).slice(0, 2);
  const kpiGridCols =
    typeKpis.length === 0 ? 'sm:grid-cols-2' : typeKpis.length === 1 ? 'sm:grid-cols-3' : 'sm:grid-cols-4';

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      await exportRowsToExcel(
        'Leave register',
        filtered.map((row) => ({
          'Employee No': row.employeeNo,
          Name: row.name,
          Department: row.department,
          Designation: row.designation,
          ...Object.fromEntries((report?.leaveTypes ?? []).map((type) => [type, balanceOf(row, type)])),
          'Total balance': row.balance.totalBalance,
        })),
        { filename: 'leave-register.xlsx' },
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
    ...(report?.leaveTypes ?? []).map<HrListColumn<Row>>((type) => ({
      header: type,
      align: 'right',
      className: 'hidden lg:table-cell',
      cell: (row) => <span className="tabular-nums">{balanceOf(row, type)}</span>,
    })),
    {
      header: 'Total balance',
      align: 'right',
      mobile: 'aside',
      cell: (row) => (
        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-semibold text-indigo-700">
          {row.balance.totalBalance}
        </Badge>
      ),
    },
  ];

  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Loading the leave register…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrAccessDenied what="the leave register" />
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
        title="Leave register"
        description={`Every employee's leave balance, from greytHR's own record${report?.year ? ` for ${report.year}` : ''}. Read-only — applying or approving leave still happens in greytHR.`}
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

      <div className={`mb-4 grid grid-cols-2 gap-2.5 ${kpiGridCols}`}>
        <HrKpiCard label="Employees" value={report?.count ?? 0} icon={Users} tone="indigo" />
        <HrKpiCard
          label="Total balance"
          value={report?.totalBalance ?? 0}
          hint="days, across everyone"
          icon={CalendarClock}
          tone="emerald"
        />
        {typeKpis.map((type) => (
          <HrKpiCard
            key={type}
            label={type}
            value={report?.totalsByType[type] ?? 0}
            hint="total days outstanding"
            tone="amber"
          />
        ))}
      </div>

      {report && report.missing > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          {report.missing} employee{report.missing === 1 ? '' : 's'} have no leave balance on record —
          usually because the &quot;Leave balances&quot; group was enabled after their last sync. Run a
          sync from{' '}
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
          <Select value={sortType} onValueChange={setSortType}>
            <SelectTrigger><SelectValue placeholder="Sort by" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="total">Sort by total balance</SelectItem>
              {(report?.leaveTypes ?? []).map((type) => (
                <SelectItem key={type} value={type}>Sort by {type}</SelectItem>
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
              icon={CalendarClock}
              title="No leave records match"
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
