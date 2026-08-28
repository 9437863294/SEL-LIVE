'use client';

/**
 * Current employees, live from greytHR — deliberately not the Firestore mirror.
 *
 * `Manage Employee` reads the `employees` collection, which is only as correct as the last sync that
 * wrote it. When that sync is stale, incomplete, or was run before a derivation fix, this page is the
 * escape hatch: it asks greytHR's `state=CURRENT` roster directly, on every load, and shows exactly
 * what it says right now — the cost being a live API round trip per visit, which is the right trade
 * for a page whose entire purpose is "what does greytHR say, this second".
 *
 * ── The fetch also stores what it found ────────────────────────────────────────────────────────
 *
 * Each successful complete fetch replaces the previous snapshot in `greythrCurrentRoster`: current
 * employees written, anyone greytHR no longer lists cleared out. So that collection always holds
 * exactly one dated answer to "who works here" rather than accumulating leavers.
 *
 * That snapshot is **not** the `employees` mirror and never touches it. Pruning the mirror to
 * CURRENT-only cannot hold — the hourly sync fetches `state=ALL` and writes the leavers straight back
 * — and the mirror has to keep departed records anyway, because the exit policy can only close a
 * leaver's login while it can still see a record saying they left. See `greythr-roster-store.ts`.
 *
 * The payoff: when greytHR is unreachable this page serves the stored snapshot, clearly labelled as
 * stored rather than live, instead of failing.
 *
 * Table styled to match `site-account-statement/expenses`: a plain, dense `<table>` in its own
 * scrolling card (sticky slate header, hover rows, truncated cells with a `min-w` floor so it scrolls
 * horizontally instead of squeezing), with a row click opening the full record in a detail dialog —
 * rather than the generic responsive `HrDataList` card/table split used elsewhere in this module.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  Download,
  MapPin,
  RefreshCw,
  Search,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrAlertNotice, HrKpiCard, HrLoader } from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { exportRowsToExcel } from '@/lib/report-excel';
import { fetchCurrentEmployeesLive, type LiveCurrentEmployeesResponse } from '@/lib/greythr-sync-client';
import type { EmploymentState, SyncedEmployee } from '@/lib/greythr';

type Row = SyncedEmployee & { id: string };

const STATE_TONE: Record<EmploymentState, string> = {
  Active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Notice Period': 'border-amber-200 bg-amber-50 text-amber-800',
  Relieved: 'border-rose-200 bg-rose-50 text-rose-700',
  Retired: 'border-slate-200 bg-slate-100 text-slate-600',
  Settled: 'border-slate-200 bg-slate-100 text-slate-600',
  Left: 'border-rose-200 bg-rose-50 text-rose-700',
  Unknown: 'border-slate-300 bg-white text-slate-500',
};

/** A stable colour per person, so the same name always gets the same avatar — not random per render. */
const AVATAR_PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-orange-100 text-orange-700',
];

function avatarTone(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * How often the page re-fetches greytHR's CURRENT roster on its own.
 *
 * Every fetch replaces the list wholesale rather than merging into it, and the stored snapshot is
 * replaced the same way. That is what makes "remove anyone who has left" automatic rather than a
 * separate rule to get wrong: a person absent from the freshest CURRENT response simply isn't in the
 * new array, and isn't in the new snapshot either — whatever either looked like five minutes ago.
 *
 * Five minutes balances that against hammering greytHR from every open tab. Note each tick now also
 * writes, so this interval is a Firestore cost as well as an API one; the write is idempotent, so a
 * tick that finds nothing changed replaces the snapshot with an identical one.
 */
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function formatJoinDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** The compact filter controls, matching Manage Employee's bar so the two rosters read as siblings. */
const FILTER_TRIGGER = 'h-8 text-xs';

/** Applied filters are tinted, so a narrowed list is attributable at a glance. */
const FILTER_TRIGGER_ACTIVE = 'border-primary/40 bg-primary/5 font-medium text-primary';

const INITIAL_FILTERS = { department: 'all', location: 'all', state: 'all' };

/** One field of the detail dialog. Blank values render as an em dash rather than being omitted. */
function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export default function CurrentEmployeesLivePage() {
  const { toast } = useToast();
  const { can, isLoading: authLoading } = useAuthorization();
  const canView = can('View', 'Settings.Employee Management');

  const [employees, setEmployees] = useState<Row[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [viewEmployee, setViewEmployee] = useState<Row | null>(null);
  /** What the last fetch did to the stored snapshot, and whether the data is live at all. */
  const [store, setStore] = useState<{
    source: 'greythr-live' | 'snapshot';
    stale: boolean;
    staleReason?: string;
    snapshot?: LiveCurrentEmployeesResponse['snapshot'];
  } | null>(null);

  // Guards the auto-refresh timer against overlapping requests — a slow greytHR response should not
  // let a second interval tick pile another fetch on top of the one still in flight.
  const isFetchingRef = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'manual' | 'auto') => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const result = await fetchCurrentEmployeesLive();
        // A full replace, not a merge — see the note on `AUTO_REFRESH_MS`. This is the entirety of
        // how a departed employee disappears from the page: they are simply not in this array.
        setEmployees(result.employees.map((employee) => ({ ...employee, id: employee.employeeId })));
        setFetchedAt(result.fetchedAt);
        setStore({
          source: result.source,
          stale: result.stale === true,
          staleReason: result.staleReason,
          snapshot: result.snapshot,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load employees from greytHR.';
        setError(message);
        // A silent background tick that fails does not interrupt with a toast — it retries on its own
        // next cycle, and the "Last fetched" timestamp not moving is signal enough. A manual click
        // failing is different: the person is looking at the button right now and expects an answer.
        if (mode === 'manual') toast({ title: 'Refresh failed', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
        setRefreshing(false);
        isFetchingRef.current = false;
      }
    },
    [toast],
  );

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load('initial');

    const interval = setInterval(() => void load('auto'), AUTO_REFRESH_MS);
    // The greytHR sync workspace announces a finished run with this event — refetch rather than
    // wait out the five-minute tick. `load` already drops the call while a fetch is in flight.
    const onSyncSuccess = () => void load('auto');
    window.addEventListener('greytHRSyncSuccess', onSyncSuccess);
    return () => {
      clearInterval(interval);
      window.removeEventListener('greytHRSyncSuccess', onSyncSuccess);
    };
  }, [authLoading, canView, load]);

  /** Distinct values actually present in the loaded roster — an option list with no dead entries. */
  const filterOptions = useMemo(() => {
    const departments = new Set<string>();
    const locations = new Set<string>();
    const states = new Set<string>();
    for (const employee of employees) {
      if (employee.department) departments.add(employee.department);
      if (employee.location) locations.add(employee.location);
      states.add(employee.employmentState);
    }
    const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
    return { departments: sorted(departments), locations: sorted(locations), states: sorted(states) };
  }, [employees]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (
        query &&
        ![employee.name, employee.employeeNo, employee.email, employee.department, employee.designation, employee.location, employee.projectName]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query))
      ) {
        return false;
      }
      if (filters.department !== 'all' && employee.department !== filters.department) return false;
      if (filters.location !== 'all' && employee.location !== filters.location) return false;
      if (filters.state !== 'all' && employee.employmentState !== filters.state) return false;
      return true;
    });
  }, [employees, search, filters]);

  const activeFilterCount =
    (search.trim() ? 1 : 0) + Object.values(filters).filter((value) => value !== 'all').length;

  const clearFilters = () => {
    setSearch('');
    setFilters(INITIAL_FILTERS);
  };

  const handleExport = async () => {
    if (!filtered.length) return;
    try {
      await exportRowsToExcel(
        'Current employees',
        filtered.map((row) => ({
          'Employee No': row.employeeNo || row.employeeId,
          Name: row.name || '',
          State: row.employmentState,
          Department: row.department || '',
          Designation: row.designation || '',
          Location: row.location || '',
          Project: row.projectName || '',
          Type: row.employmentType || '',
          Joined: row.dateOfJoin ?? '',
          Email: row.email || '',
          Phone: row.phone || '',
        })),
        { filename: 'current-employees.xlsx' },
      );
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Unexpected error.',
        variant: 'destructive',
      });
    }
  };

  const stats = useMemo(() => {
    const notice = employees.filter((employee) => employee.employmentState === 'Notice Period').length;
    const departments = new Set(employees.map((employee) => employee.department).filter(Boolean)).size;
    const locations = new Set(employees.map((employee) => employee.location).filter(Boolean)).size;
    return { notice, departments, locations };
  }, [employees]);

  /*
   * Both guards return before the header card renders. The header carries a working Refresh button,
   * and a viewer without access was previously handed that live control above the denial notice —
   * a click that could only 403. Same shell-around-the-verdict shape as Manage Employee.
   */
  if (authLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Fetching the current roster from greytHR…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrAccessDenied what="the greytHR employee roster" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      {/* ── Header ── */}
      <Card className="mb-4 overflow-hidden border-white/60 bg-white/85 shadow-sm backdrop-blur-sm">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <Link href="/employee">
              <Button variant="ghost" size="icon" className="mt-0.5 shrink-0 rounded-full bg-white/70 shadow-sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-4 ring-emerald-100">
              <Users className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-slate-800 sm:text-xl">Current employees</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live from greytHR
                </span>
              </div>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                Fetched directly from greytHR&apos;s CURRENT roster on every load — not the stored employee mirror.
                Use this when Manage Employee looks wrong.
              </p>
              {fetchedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last fetched {formatDistanceToNow(new Date(fetchedAt), { addSuffix: true })} · auto-refreshes every 5 min
                </p>
              )}
            </div>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={filtered.length === 0}
              className="bg-white"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load('manual')}
              disabled={refreshing}
              className="bg-white"
            >
              <RefreshCw className={cn('mr-1.5 h-4 w-4', refreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card className="border-white/60 bg-white/80 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" onClick={() => void load('manual')}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ── Storage / freshness state ── */}

          {/*
            Three distinct situations, and conflating them is how a screen misleads. Serving a stored
            snapshot is not the same as serving live data; and a live fetch that could not be
            persisted is different again — the answer on screen is right, but the stored copy behind
            it is now older than it looks.
          */}
          {store?.stale && (
            <HrAlertNotice tone="amber" title="greytHR unreachable — showing the stored snapshot">
              {store.staleReason ??
                'Showing the roster stored on the last successful fetch. Anyone who has joined or left since then may be missing or wrongly listed.'}
            </HrAlertNotice>
          )}

          {store && !store.stale && store.snapshot && !store.snapshot.replaced && (
            <HrAlertNotice tone="amber" title="Fetched, but not stored">
              {store.snapshot.refusedReason ??
                'The stored snapshot could not be replaced on this fetch.'}{' '}
              The list below is live and correct; the stored copy is unchanged.
            </HrAlertNotice>
          )}

          {store?.snapshot?.replaced && store.snapshot.deleted > 0 && (
            <HrAlertNotice tone="blue" title={`Snapshot updated — ${store.snapshot.deleted} removed`}>
              {store.snapshot.written} current employee(s) stored, and {store.snapshot.deleted} cleared
              because greytHR no longer lists them as current. Their full records remain in Employee
              Management; only this snapshot was pruned.
            </HrAlertNotice>
          )}

          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HrKpiCard label="Current employees" value={employees.length} icon={Users} tone="emerald" />
            <HrKpiCard label="On notice period" value={stats.notice} icon={UserCheck} tone="amber" />
            <HrKpiCard label="Departments" value={stats.departments} icon={Building2} tone="blue" />
            <HrKpiCard label="Locations" value={stats.locations} icon={MapPin} tone="violet" />
          </div>

          {/* ── Search / toolbar ── */}
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <div className="relative w-full lg:w-[300px]">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, employee no, project…"
                className="h-8 pl-8 pr-8 text-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-2 text-muted-foreground hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <Select value={filters.department} onValueChange={(value) => setFilters((f) => ({ ...f, department: value }))}>
              <SelectTrigger
                className={cn(FILTER_TRIGGER, 'w-full lg:w-[180px]', filters.department !== 'all' && FILTER_TRIGGER_ACTIVE)}
              >
                <SelectValue placeholder="All departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {filterOptions.departments.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.location} onValueChange={(value) => setFilters((f) => ({ ...f, location: value }))}>
              <SelectTrigger
                className={cn(FILTER_TRIGGER, 'w-full lg:w-[160px]', filters.location !== 'all' && FILTER_TRIGGER_ACTIVE)}
              >
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All locations</SelectItem>
                {filterOptions.locations.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.state} onValueChange={(value) => setFilters((f) => ({ ...f, state: value }))}>
              <SelectTrigger
                className={cn(FILTER_TRIGGER, 'w-full lg:w-[160px]', filters.state !== 'all' && FILTER_TRIGGER_ACTIVE)}
              >
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {filterOptions.states.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}

            <p className="text-xs text-muted-foreground lg:ml-auto lg:text-right">
              Showing <span className="font-medium text-slate-700">{filtered.length}</span>
              {activeFilterCount > 0 ? <> of {employees.length}</> : null} current employee{filtered.length === 1 ? '' : 's'}
            </p>
          </div>

          {/* ── Table ── */}
          <Card className="bg-white/80 backdrop-blur-sm">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {activeFilterCount > 0 ? 'No employees match these filters.' : "greytHR reports nobody current."}
                  </p>
                  {activeFilterCount > 0 && (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="max-h-[65vh] overflow-auto">
                  <table className="w-full min-w-[1000px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-slate-100">
                        <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                        <th className="px-4 py-2.5 text-left font-medium">State</th>
                        <th className="px-4 py-2.5 text-left font-medium">Department</th>
                        <th className="px-4 py-2.5 text-left font-medium">Designation</th>
                        <th className="px-4 py-2.5 text-left font-medium">Location</th>
                        <th className="px-4 py-2.5 text-left font-medium">Project</th>
                        <th className="px-4 py-2.5 text-left font-medium">Type</th>
                        <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap">Joined</th>
                        <th className="px-4 py-2.5 text-left font-medium">Email</th>
                        <th className="px-4 py-2.5 text-left font-medium">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr
                          key={row.id}
                          className="cursor-pointer border-b transition-colors hover:bg-muted/20"
                          onClick={() => setViewEmployee(row)}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-8 w-8 shrink-0">
                                <AvatarFallback className={cn('text-[11px] font-semibold', avatarTone(row.id))}>
                                  {initials(row.name || row.employeeNo || '?')}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0 max-w-[160px]">
                                <p className="truncate font-medium text-slate-800">{row.name || '—'}</p>
                                <p className="truncate text-xs text-muted-foreground">{row.employeeNo || row.employeeId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant="outline" className={cn('font-medium', STATE_TONE[row.employmentState])} title={row.employmentStateReason}>
                              {row.employmentState}
                            </Badge>
                          </td>
                          <td className="max-w-[140px] truncate px-4 py-2.5">{row.department || '—'}</td>
                          <td className="max-w-[160px] truncate px-4 py-2.5">{row.designation || '—'}</td>
                          <td className="max-w-[130px] truncate px-4 py-2.5">{row.location || '—'}</td>
                          <td className="max-w-[150px] truncate px-4 py-2.5">{row.projectName || '—'}</td>
                          <td className="px-4 py-2.5">
                            {row.employmentType ? <Badge variant="secondary" className="font-normal">{row.employmentType}</Badge> : '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">{formatJoinDate(row.dateOfJoin)}</td>
                          <td className="max-w-[170px] truncate px-4 py-2.5 text-muted-foreground">{row.email || '—'}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{row.phone || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-2.5" colSpan={2}>
                          Total
                        </td>
                        <td className="px-4 py-2.5 text-emerald-700" colSpan={8}>
                          {filtered.length} current employee{filtered.length === 1 ? '' : 's'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Employee detail dialog ── */}
      <Dialog open={!!viewEmployee} onOpenChange={() => setViewEmployee(null)}>
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-emerald-600" />
              Employee Details
            </DialogTitle>
          </DialogHeader>
          {viewEmployee && (
            <div className="space-y-4 py-1">
              {/* Identity highlight */}
              <div className="flex items-center gap-3 rounded-xl border bg-emerald-50 px-4 py-3">
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarFallback className={cn('text-sm font-semibold', avatarTone(viewEmployee.id))}>
                    {initials(viewEmployee.name || viewEmployee.employeeNo || '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-slate-800">{viewEmployee.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{viewEmployee.employeeNo || viewEmployee.employeeId}</p>
                </div>
                <Badge variant="outline" className={cn('shrink-0 font-medium', STATE_TONE[viewEmployee.employmentState])}>
                  {viewEmployee.employmentState}
                </Badge>
              </div>

              {/* Fields grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <DetailField label="Email" value={viewEmployee.email} />
                <DetailField label="Phone" value={viewEmployee.phone} />
                <DetailField label="Department" value={viewEmployee.department} />
                <DetailField label="Designation" value={viewEmployee.designation} />
                <DetailField
                  label="Location"
                  value={
                    viewEmployee.location && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {viewEmployee.location}
                      </span>
                    )
                  }
                />
                <DetailField label="Grade" value={viewEmployee.grade} />
                <DetailField label="Project" value={viewEmployee.projectName} />
                <DetailField label="Project Division" value={viewEmployee.projectDivision} />
                <DetailField label="Cost Center" value={viewEmployee.costCenter} />
                <DetailField label="Employee Type" value={viewEmployee.employeeType} />
                <DetailField
                  label="Employment Type"
                  value={viewEmployee.employmentType && <Badge variant="secondary">{viewEmployee.employmentType}</Badge>}
                />
                <DetailField
                  label="Date of Join"
                  value={
                    viewEmployee.dateOfJoin && (
                      <span className="inline-flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                        {formatJoinDate(viewEmployee.dateOfJoin)}
                      </span>
                    )
                  }
                />
                {viewEmployee.confirmDate && <DetailField label="Confirmed On" value={formatJoinDate(viewEmployee.confirmDate)} />}
                {viewEmployee.noticePeriodDays !== null && (
                  <DetailField label="Notice Period" value={`${viewEmployee.noticePeriodDays} days`} />
                )}
                <div className="col-span-2 border-t pt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employment State Reason</p>
                  <p className="mt-0.5 text-sm text-slate-700">{viewEmployee.employmentStateReason}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
