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
import { ArrowLeft, RefreshCw, Search, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrDataList,
  HrEmptyState,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
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

  const noticeCount = useMemo(
    () => employees.filter((employee) => employee.employmentState === 'Notice Period').length,
    [employees],
  );

  const columns: HrListColumn<Row>[] = [
    { header: 'Name', mobile: 'title', cell: (row) => row.name || '—' },
    { header: 'Employee No', mobile: 'title', cell: (row) => row.employeeNo || row.employeeId },
    {
      header: 'State',
      mobile: 'aside',
      cell: (row) => (
        <Badge variant="outline" className={STATE_TONE[row.employmentState]} title={row.employmentStateReason}>
          {row.employmentState}
        </Badge>
      ),
    },
    { header: 'Department', cell: (row) => row.department || '—' },
    { header: 'Designation', cell: (row) => row.designation || '—' },
    { header: 'Location', cell: (row) => row.location || '—', className: 'hidden md:table-cell' },
    { header: 'Project', cell: (row) => row.projectName || '—', className: 'hidden lg:table-cell' },
    { header: 'Employment Type', cell: (row) => row.employmentType || '—', className: 'hidden lg:table-cell' },
    { header: 'Date of Join', cell: (row) => row.dateOfJoin || '—', className: 'hidden md:table-cell' },
    { header: 'Email', cell: (row) => row.email || '—', className: 'hidden xl:table-cell' },
  ];

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
        title="Current employees (live from greytHR)"
        description="Fetched directly from greytHR's CURRENT roster on every load — not the stored employee mirror. Use this when the mirror looks wrong."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading || refreshing}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <HrKpiCard label="Current employees" value={employees.length} icon={Users} tone="emerald" />
            <HrKpiCard label="On notice period" value={noticeCount} icon={UserCheck} tone="amber" />
            <HrKpiCard
              label="Fetched"
              value={fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : '—'}
              hint={fetchedAt ? new Date(fetchedAt).toLocaleDateString() : undefined}
              tone="slate"
            />
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, employee no, department, designation, project…"
              className="pl-8"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <HrDataList
            rows={filtered}
            columns={columns}
            empty={
              <HrEmptyState
                title={search ? 'No employees match that search' : 'greytHR reports nobody current'}
                description={search ? 'Try a different name, department or project.' : undefined}
              />
            }
          />

          {search && (
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {employees.length} current employees.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
