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
import { CalendarClock, Download, RefreshCw, Search, Users } from 'lucide-react';
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
import { cn } from '@/lib/utils';
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
      // `employeeId` is in the searchable set because for an unidentified row it is the only
      // thing on screen — leaving it out would make those rows impossible to search for.
      return [row.name, row.employeeNo, row.employeeId, row.department, row.designation]
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
          // The same label the screen shows, so a workbook row is never a blank name cell.
          Name: row.name || `Employee ${row.employeeId}`,
          'In roster mirror': row.inMirror ? 'Yes' : 'No',
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
      /*
        An unnamed row is labelled as one rather than shown as a person called "10".
        `inMirror: false` means greytHR returned a leave balance for somebody the employee sync has
        never written here — so the id is genuinely all this screen knows, and saying so is the
        difference between a gap in the data and a person with a numeric name. The link still works:
        the profile route falls back to asking greytHR directly for an employee the mirror lacks.
      */
      cell: (row) => (
        <Link href={`/employee/${row.employeeId}`} className="group/name block">
          <span className={cn('font-medium', row.name ? 'text-slate-800 group-hover/name:underline' : 'text-slate-500')}>
            {row.name || `Employee ${row.employeeId}`}
          </span>
          {!row.inMirror && (
            <span className="block text-[11px] font-normal text-amber-700">Not in the roster mirror</span>
          )}
        </Link>
      ),
    },
    {
      header: 'Department · designation',
      mobile: 'detail',
      className: 'hidden md:table-cell',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {[row.designation, row.department].filter(Boolean).join(' · ') || (row.inMirror ? '—' : 'Unknown')}
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
      <EmployeePageShell>
        <HrLoader label="Loading the leave register…" />
      </EmployeePageShell>
    );
  }

  if (!canView) {
    return (
      <EmployeePageShell>
        <HrAccessDenied what="the leave register" />
      </EmployeePageShell>
    );
  }

  return (
    <EmployeePageShell>
      <EmployeeHeader
        icon={CalendarClock}
        tone="cyan"
        eyebrow="Employee management"
        title="Leave register"
        backHref="/employee"
        backLabel="Back to Employee Management"
        status={
          <>
            {report?.year && (
              <EmployeeStatusPill tone="cyan" icon={CalendarClock}>
                Year {report.year}
              </EmployeeStatusPill>
            )}
            <EmployeeStatusPill tone="slate">Read-only</EmployeeStatusPill>
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" className="bg-white/80" onClick={() => void handleExport()} disabled={filtered.length === 0}>
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button variant="outline" size="sm" className="bg-white/80" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={refreshing ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
              Refresh
            </Button>
          </>
        }
      />

      <EmployeeSubNav current="leave" />

      {error && <EmployeeErrorBanner onRetry={() => void load(true)}>{error}</EmployeeErrorBanner>}

      <div className={`mb-3 grid grid-cols-2 gap-2.5 ${kpiGridCols}`}>
        <EmployeeKpiCard label="Employees" value={report?.count ?? 0} icon={Users} tone="indigo" index={0} />
        <EmployeeKpiCard
          label="Total balance"
          value={report?.totalBalance ?? 0}
          hint="days, across everyone"
          icon={CalendarClock}
          tone="emerald"
          index={1}
        />
        {typeKpis.map((type, position) => (
          <EmployeeKpiCard
            key={type}
            label={type}
            value={report?.totalsByType[type] ?? 0}
            hint="total days outstanding"
            tone={position === 0 ? 'amber' : 'violet'}
            index={2 + position}
          />
        ))}
      </div>

      {/*
        The register cannot name these people, and that is a fact about the *mirror*, not about
        their leave. It goes above the "not covered" notice because it is the more serious of the
        two: one says some employees are missing from this register, the other says this register
        holds balances for employees the roster has never heard of.
      */}
      {report && report.unidentified > 0 && (
        <div className="mb-3">
          <HrAlertNotice
            tone="amber"
            title={`${report.unidentified} of ${report.count} rows could not be matched to an employee`}
          >
            greytHR returned a leave balance for these employee ids, but no employee record exists
            here for them — so their name, department and designation are blank. That is a gap in the
            roster mirror rather than in the leave data. Run a full sync from{' '}
            <Link href="/employee/sync" className="font-medium underline">
              greytHR Sync
            </Link>{' '}
            to fetch the missing employees.
          </HrAlertNotice>
        </div>
      )}

      {/* A tinted notice rather than the grey paragraph this used to be: "1,100 of your employees
          are missing from this register" is not a footnote, and at `text-muted-foreground` on the
          aurora backdrop it read as one. */}
      {report && report.missing > 0 && (
        <div className="mb-3">
          <HrAlertNotice
            tone="blue"
            title={`${report.missing} employee${report.missing === 1 ? '' : 's'} not covered`}
          >
            No leave balance on record — usually because the &quot;Leave balances&quot; group was
            enabled after their last sync. Run a sync from{' '}
            <Link href="/employee/sync" className="font-medium underline">
              greytHR Sync
            </Link>{' '}
            to pick them up.
          </HrAlertNotice>
        </div>
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
          dense
          maxHeightClassName={EMP_REGISTER_HEIGHT}
          empty={
            <HrEmptyState
              icon={CalendarClock}
              title="No leave records match"
              description={search || department !== 'all' ? 'Try a different search or department.' : 'Nothing synced yet.'}
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
      </div>
    </EmployeePageShell>
  );
}
