'use client';

/**
 * Current employees, live from greytHR — deliberately not the Firestore mirror.
 *
 * `Manage Employee` reads the `employees` collection, which is only as correct as the last sync that
 * wrote it. When that sync is stale, incomplete, or was run before a derivation fix, this page is the
 * escape hatch: it asks greytHR's `state=CURRENT` roster directly, on every load, and shows exactly
 * what it says right now. Nothing here is cached in Firestore and nothing here can go stale in the
 * way the mirror can — the cost is that every visit is a live API round trip, which is the right
 * trade for a page whose entire purpose is "what does greytHR say, this second".
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
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import { HrAccessDenied, HrKpiCard, HrLoader } from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { fetchCurrentEmployeesLive } from '@/lib/greythr-sync-client';
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
 * Every fetch replaces `employees` wholesale rather than merging into it — that is what makes
 * "remove anyone who has left" automatic rather than a separate rule to get wrong: a person absent
 * from the freshest CURRENT response simply isn't in the new array, whatever they looked like five
 * minutes ago. Five minutes balances that against hammering greytHR's API from every open tab.
 */
const AUTO_REFRESH_MS = 5 * 60 * 1000;

function formatJoinDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

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
  const [viewEmployee, setViewEmployee] = useState<Row | null>(null);

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
    return () => clearInterval(interval);
  }, [authLoading, canView, load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) =>
      [employee.name, employee.employeeNo, employee.email, employee.department, employee.designation, employee.location, employee.projectName]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query)),
    );
  }, [employees, search]);

  const stats = useMemo(() => {
    const notice = employees.filter((employee) => employee.employmentState === 'Notice Period').length;
    const departments = new Set(employees.map((employee) => employee.department).filter(Boolean)).size;
    const locations = new Set(employees.map((employee) => employee.location).filter(Boolean)).size;
    return { notice, departments, locations };
  }, [employees]);

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
              {fetchedAt && !loading && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Last fetched {formatDistanceToNow(new Date(fetchedAt), { addSuffix: true })} · auto-refreshes every 5 min
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load('manual')}
            disabled={loading || refreshing}
            className="w-full shrink-0 bg-white sm:w-auto"
          >
            <RefreshCw className={cn('mr-1.5 h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {authLoading || loading ? (
        <HrLoader label="Fetching the current roster from greytHR…" />
      ) : !canView ? (
        <HrAccessDenied what="the greytHR employee roster" />
      ) : error ? (
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
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HrKpiCard label="Current employees" value={employees.length} icon={Users} tone="emerald" />
            <HrKpiCard label="On notice period" value={stats.notice} icon={UserCheck} tone="amber" />
            <HrKpiCard label="Departments" value={stats.departments} icon={Building2} tone="blue" />
            <HrKpiCard label="Locations" value={stats.locations} icon={MapPin} tone="violet" />
          </div>

          {/* ── Search / toolbar ── */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, employee no, department, designation, project…"
                className="pl-8 pr-8"
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
            <p className="text-xs text-muted-foreground sm:text-right">
              Showing <span className="font-medium text-slate-700">{filtered.length}</span>
              {search ? <> of {employees.length}</> : null} current employee{filtered.length === 1 ? '' : 's'}
            </p>
          </div>

          {/* ── Table ── */}
          <Card className="bg-white/80 backdrop-blur-sm">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Users className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {search ? 'No employees match that search.' : "greytHR reports nobody current."}
                  </p>
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
