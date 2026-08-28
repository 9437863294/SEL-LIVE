'use client';

/**
 * Headcount, movement and category reports — built from the same corrected roster Manage Employee
 * shows, so a number here can never disagree with that screen about who counts as working.
 *
 * Deliberately aggregate-only. If a report needs to name individuals, that is Manage Employee's job
 * with a filter applied there, not a reason to duplicate its table here.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, RefreshCw, UserMinus, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrBarList,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  HrSection,
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { isWorkingState } from '@/lib/greythr';
import { fetchEmployeeRoster, type EmployeeRosterResponse, type RosterEmployeeRow } from '@/lib/greythr-sync-client';

/** Group and count, sorted largest first — every breakdown on this page is this one shape. */
function tally(rows: RosterEmployeeRow[], key: (row: RosterEmployeeRow) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = key(row);
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** The last 12 calendar months, oldest first, as `YYYY-MM` — the join/exit trend's x-axis. */
function last12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let index = 11; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

const monthLabel = (key: string): string => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

const deptOf = (row: RosterEmployeeRow) => row.categories?.Department || row.department;
const locationOf = (row: RosterEmployeeRow) => row.categories?.Location || row.location;

export default function EmployeeReportsPage() {
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [report, setReport] = useState<EmployeeRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeDepartment, setScopeDepartment] = useState('all');
  const [scopeLocation, setScopeLocation] = useState('all');

  const load = async (isRefresh: boolean) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setReport(await fetchEmployeeRoster());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the roster.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const rows = useMemo(() => report?.employees ?? [], [report]);

  const departmentOptions = useMemo(
    () => [...new Set(rows.map(deptOf).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const locationOptions = useMemo(
    () => [...new Set(rows.map(locationOf).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // One scope, applied to every figure below it. A KPI filtered one way and a breakdown filtered
  // another is exactly the "two numbers disagreeing about the same fact" this page exists to avoid.
  const scoped = useMemo(
    () =>
      rows.filter(
        (row) =>
          (scopeDepartment === 'all' || deptOf(row) === scopeDepartment) &&
          (scopeLocation === 'all' || locationOf(row) === scopeLocation),
      ),
    [rows, scopeDepartment, scopeLocation],
  );

  const scopeActive = scopeDepartment !== 'all' || scopeLocation !== 'all';

  const working = useMemo(() => scoped.filter((row) => isWorkingState(row.employmentState)), [scoped]);
  const departed = useMemo(() => scoped.filter((row) => !isWorkingState(row.employmentState)), [scoped]);

  const byDepartment = useMemo(() => tally(working, deptOf), [working]);
  const byDesignation = useMemo(() => tally(working, (row) => row.categories?.Designation || row.designation), [working]);
  const byLocation = useMemo(() => tally(working, locationOf), [working]);
  const byProject = useMemo(
    () => tally(working, (row) => row.categories?.['Project Name'] || row.projectName),
    [working],
  );
  const byState = useMemo(() => tally(scoped, (row) => row.employmentState), [scoped]);

  /** Joiners and exits, by month, over the last year — the one trend a static headcount cannot show. */
  const movement = useMemo(() => {
    const months = last12Months();
    const joins = new Map(months.map((month) => [month, 0]));
    const exits = new Map(months.map((month) => [month, 0]));
    for (const row of scoped) {
      const joinMonth = row.dateOfJoin?.slice(0, 7);
      if (joinMonth && joins.has(joinMonth)) joins.set(joinMonth, (joins.get(joinMonth) ?? 0) + 1);
      const exitMonth = row.exitDate?.slice(0, 7);
      if (exitMonth && exits.has(exitMonth)) exits.set(exitMonth, (exits.get(exitMonth) ?? 0) + 1);
    }
    return months.map((month) => ({ month, joined: joins.get(month) ?? 0, left: exits.get(month) ?? 0 }));
  }, [scoped]);

  const maxMovement = Math.max(...movement.map((entry) => Math.max(entry.joined, entry.left)), 1);

  /** Bar height in px against a 96px chart area; a non-zero month always gets a visible sliver. */
  const barHeight = (value: number) => (value > 0 ? Math.max(Math.round((value / maxMovement) * 96), 4) : 0);

  const clearScope = () => {
    setScopeDepartment('all');
    setScopeLocation('all');
  };

  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Building reports from the roster…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrAccessDenied what="employee reports" />
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
        title="Reports"
        description="Headcount, movement and category breakdowns — built from the corrected roster, not a separate count that can drift from it."
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

      {!report?.liveRoster && !error && rows.length > 0 && (
        <p className="mb-4 text-xs text-amber-700">
          greytHR could not be reached live for this report — figures reflect the stored mirror only.
        </p>
      )}

      {rows.length === 0 && !error ? (
        <HrEmptyState
          icon={Users}
          title="No employees to report on"
          description="Reports are built from the synced roster, and nothing has been synced yet. Run a greytHR sync to populate it."
          action={
            <Button asChild size="sm">
              <Link href="/employee/sync">Go to greytHR Sync</Link>
            </Button>
          }
        />
      ) : rows.length > 0 ? (
        <>
          <HrFilterCard
            title="Scope"
            summary={
              scopeActive
                ? `${scoped.length} of ${rows.length} records in scope`
                : `All ${rows.length} records`
            }
            actions={
              scopeActive ? (
                <Button variant="ghost" size="sm" onClick={clearScope}>Clear</Button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <Select value={scopeDepartment} onValueChange={setScopeDepartment}>
                <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departmentOptions.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={scopeLocation} onValueChange={setScopeLocation}>
                <SelectTrigger><SelectValue placeholder="Location" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locationOptions.map((value) => (
                    <SelectItem key={value} value={value}>{value}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </HrFilterCard>

          {scoped.length === 0 ? (
            <HrEmptyState
              icon={Users}
              title="No employees match this scope"
              description="Try a different department or location."
              action={
                <Button variant="outline" size="sm" onClick={clearScope}>Clear scope</Button>
              }
            />
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <HrKpiCard label="Total records" value={scoped.length} icon={Users} tone="indigo" />
                <HrKpiCard label="Currently working" value={working.length} icon={UserPlus} tone="emerald" />
                <HrKpiCard label="Departed" value={departed.length} icon={UserMinus} tone="rose" />
                <HrKpiCard
                  label="Departments"
                  value={byDepartment.length}
                  hint={`${byLocation.length} location${byLocation.length === 1 ? '' : 's'}`}
                  icon={Building2}
                  tone="blue"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <HrSection
                  title="Joiners and exits, last 12 months"
                  description="From `dateOfJoin` / the derived exit date on each record. A month with neither bar had no movement recorded."
                >
                  {/*
                    Values are printed above every bar rather than tucked into hover tooltips — this
                    page is read on phones, where hover does not exist — and the shared baseline is
                    what lets a short bar read as "one" instead of "nothing".
                  */}
                  <div className="overflow-x-auto">
                    <div className="min-w-[540px]">
                      <div className="flex items-end gap-1 border-b border-slate-300">
                        {movement.map((entry) => (
                          <div key={entry.month} className="flex flex-1 items-end justify-center gap-0.5">
                            <div className="flex w-1/2 max-w-[20px] flex-col items-center gap-0.5">
                              <span className="text-[10px] font-medium tabular-nums text-emerald-700">
                                {entry.joined}
                              </span>
                              <div className="w-full rounded-t bg-emerald-400" style={{ height: `${barHeight(entry.joined)}px` }} />
                            </div>
                            <div className="flex w-1/2 max-w-[20px] flex-col items-center gap-0.5">
                              <span className="text-[10px] font-medium tabular-nums text-rose-700">
                                {entry.left}
                              </span>
                              <div className="w-full rounded-t bg-rose-300" style={{ height: `${barHeight(entry.left)}px` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1 flex gap-1">
                        {movement.map((entry) => (
                          <span key={entry.month} className="flex-1 text-center text-[10px] text-muted-foreground">
                            {monthLabel(entry.month)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Joined</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-300" /> Left</span>
                  </div>
                </HrSection>

                <HrSection
                  title="By employment state"
                  description="Every record in scope, corrected against greytHR's live roster."
                >
                  <HrBarList rows={byState} tone="indigo" />
                </HrSection>

                <HrSection title="By department" description="Currently working employees only.">
                  <HrBarList rows={byDepartment.slice(0, 10)} tone="emerald" />
                </HrSection>

                <HrSection title="By designation" description="Top 10, currently working.">
                  <HrBarList rows={byDesignation.slice(0, 10)} tone="amber" />
                </HrSection>

                <HrSection title="By location" description="Currently working employees only.">
                  <HrBarList rows={byLocation.slice(0, 10)} tone="rose" />
                </HrSection>

                <HrSection title="By project" description="Top 10, currently working.">
                  <HrBarList rows={byProject.slice(0, 10)} tone="indigo" />
                </HrSection>
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
