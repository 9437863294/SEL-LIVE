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
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Building2,
  Mail,
  MapPin,
  Phone,
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
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
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

/** The stripe down the left edge of each row, so scanning a long list for anyone on notice is a glance, not a read. */
const STATE_ACCENT: Record<EmploymentState, string> = {
  Active: 'border-l-4 border-l-emerald-300',
  'Notice Period': 'border-l-4 border-l-amber-400',
  Relieved: 'border-l-4 border-l-rose-300',
  Retired: 'border-l-4 border-l-slate-300',
  Settled: 'border-l-4 border-l-slate-300',
  Left: 'border-l-4 border-l-rose-300',
  Unknown: 'border-l-4 border-l-slate-200',
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

function formatJoinDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

  const load = useCallback(
    async (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const result = await fetchCurrentEmployeesLive();
        setEmployees(result.employees.map((employee) => ({ ...employee, id: employee.employeeId })));
        setFetchedAt(result.fetchedAt);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load employees from greytHR.';
        setError(message);
        if (isRefresh) toast({ title: 'Refresh failed', description: message, variant: 'destructive' });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (authLoading || !canView) {
      if (!authLoading) setLoading(false);
      return;
    }
    void load(false);
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

  const columns: HrListColumn<Row>[] = [
    {
      header: 'Employee',
      mobile: 'title',
      className: 'min-w-[220px]',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className={cn('text-xs font-semibold', avatarTone(row.id))}>
              {initials(row.name || row.employeeNo || '?')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-slate-800">{row.name || '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{row.employeeNo || row.employeeId}</p>
          </div>
        </div>
      ),
    },
    {
      header: 'State',
      mobile: 'aside',
      cell: (row) => (
        <Badge variant="outline" className={cn('font-medium', STATE_TONE[row.employmentState])} title={row.employmentStateReason}>
          {row.employmentState}
        </Badge>
      ),
    },
    {
      header: 'Department / Designation',
      className: 'min-w-[200px]',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-800">{row.designation || '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{row.department || '—'}</p>
        </div>
      ),
    },
    {
      header: 'Location',
      className: 'hidden md:table-cell',
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{row.location || '—'}</span>
        </span>
      ),
    },
    {
      header: 'Project',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-700">{row.projectName || '—'}</p>
          {row.projectDivision && <p className="truncate text-xs text-muted-foreground">{row.projectDivision}</p>}
        </div>
      ),
    },
    {
      header: 'Type',
      className: 'hidden lg:table-cell',
      cell: (row) => (row.employmentType ? <Badge variant="secondary" className="font-normal">{row.employmentType}</Badge> : '—'),
    },
    {
      header: 'Joined',
      className: 'hidden md:table-cell whitespace-nowrap',
      cell: (row) => formatJoinDate(row.dateOfJoin),
    },
    {
      header: 'Contact',
      className: 'hidden xl:table-cell',
      cell: (row) => (
        <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
          {row.email && (
            <div className="flex items-center gap-1.5">
              <Mail className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.email}</span>
            </div>
          )}
          {row.phone && (
            <div className="flex items-center gap-1.5">
              <Phone className="h-3 w-3 shrink-0" />
              <span className="truncate">{row.phone}</span>
            </div>
          )}
          {!row.email && !row.phone && '—'}
        </div>
      ),
    },
  ];

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
                  Last fetched {formatDistanceToNow(new Date(fetchedAt), { addSuffix: true })}
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(true)}
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
        <HrEmptyState
          title="Could not reach greytHR"
          description={error}
          action={
            <Button size="sm" onClick={() => void load(true)}>
              Try again
            </Button>
          }
        />
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
          {/*
            `w-auto` overrides the shared list's default `w-full`: with only a handful of columns,
            stretching the table edge-to-edge on a wide screen pads every cell with dead space and
            makes each row read as scattered values rather than one record. `fitContent` then shrinks
            the bordered card itself to match, so there is no leftover empty box beside the table —
            every bit of visible surface is the table.
          */}
          <HrDataList
            rows={filtered}
            columns={columns}
            rowClassName={(row) => STATE_ACCENT[row.employmentState]}
            tableClassName="w-auto"
            fitContent
            empty={
              <HrEmptyState
                title={search ? 'No employees match that search' : 'greytHR reports nobody current'}
                description={search ? 'Try a different name, department or project.' : undefined}
                icon={Users}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
