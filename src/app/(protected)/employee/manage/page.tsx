'use client';

/**
 * Manage Employee — the complete greytHR roster, current and departed.
 *
 * ── What changed here, and why it mattered ─────────────────────────────────────────────────────
 *
 * This screen used to read the `employees` collection straight from the browser and render whatever
 * it found. That is how it came to report 182 employee records with **one** person still employed:
 * the mirror is only ever as correct as the last sync that wrote it, no scheduler was actually
 * running (the crons lived in `vercel.json`, which Firebase App Hosting never reads), and greytHR
 * fills `leavingDate` with a placeholder for employees who have *not* left. Read literally, that
 * placeholder relieves the entire workforce — and this page had no way to know it was presenting a
 * stale derivation as fact.
 *
 * It now reads `/api/greythr/employees/roster`, which overlays greytHR's live CURRENT roster onto
 * the mirror through the shared `overlayLiveRosterState`. Three consequences worth knowing:
 *
 *   1. **It self-heals.** Anyone greytHR currently employs shows as working even if the mirror still
 *      says Relieved, so a stale sync degrades the *detail* on this screen, never the headline fact
 *      of who works here.
 *   2. **It is honest when it cannot verify.** If greytHR is unreachable the mirror is shown as-is
 *      and the page says so, rather than quietly implying the states were confirmed.
 *   3. **Corrections are visible, not silent.** A row whose stored state was overruled is marked, so
 *      "this person is Active" and "we disbelieved greytHR's leaving date for this person" are
 *      distinguishable — an administrator deciding whether to give somebody a login should be able
 *      to tell those apart.
 *
 * Editing and deleting still write Firestore directly: those are single-document operations on a
 * record the user is looking at, and routing them through an API would add a hop without adding a
 * rule that the security rules do not already enforce.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Building2,
  CloudOff,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied, HrAlertNotice, HrEmptyState, HrFilterCard, HrKpiCard, HrLoader, HrPageHeader, hrDialog,
} from '@/components/hr/hr-ui';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { fetchEmployeeRoster, type EmployeeRosterResponse, type RosterEmployeeRow } from '@/lib/greythr-sync-client';
import { hasExited, isWorkingState, type EmploymentState } from '@/lib/greythr';

/**
 * How often the roster re-verifies itself against greytHR.
 *
 * Ten minutes rather than the five used by `/employee/current`: that page exists to answer "what
 * does greytHR say *right now*", whereas this one is a working register somebody keeps open while
 * filtering and editing, and a refetch that reorders rows underneath them is disruptive. Long enough
 * to stay honest, rare enough not to fight the user.
 */
const AUTO_REFRESH_MS = 10 * 60 * 1000;

const STATE_TONE: Record<EmploymentState, string> = {
  Active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  'Notice Period': 'border-amber-200 bg-amber-50 text-amber-800',
  Relieved: 'border-rose-200 bg-rose-50 text-rose-700',
  Retired: 'border-violet-200 bg-violet-50 text-violet-700',
  Settled: 'border-slate-300 bg-slate-100 text-slate-700',
  Left: 'border-rose-200 bg-rose-50 text-rose-700',
  Unknown: 'border-slate-200 bg-white text-slate-500',
};

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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Filter columns, in display order. The server only returns the ones a tenant actually uses.
 *
 * Ten of them, which is why the grid below is five across: two exact rows, no ragged tail.
 */
const FILTER_ORDER = [
  'Project Name', 'Project Division', 'Department', 'Location', 'Cost Center',
  'Designation', 'EMPLOYEE TYPE', 'Grade', 'Shift', 'COST CENTER CODE',
];

/**
 * The compact filter control, one class string so all eleven selects stay identical.
 *
 * `h-8 text-xs` against the `h-10 text-sm` default: these are secondary controls sitting above the
 * thing somebody actually came to read, and at full size eleven of them crowd the table off the
 * screen entirely.
 */
const FILTER_TRIGGER = 'h-8 text-xs';

/** Applied filters are tinted, so the set ones are findable among the unset ones without reading all ten. */
const FILTER_TRIGGER_ACTIVE = 'border-primary/40 bg-primary/5 font-medium text-primary';

const initialFilters = { status: 'all' as string, categories: {} as Record<string, string> };

interface EditState {
  employeeId: string;
  employeeNo: string;
  name: string;
  dateOfJoin: string;
}

export default function ManageEmployeePage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const canView = can('View', 'Settings.Employee Management');
  const canAdd = can('Add', 'Settings.Employee Management');
  const canEdit = can('Edit', 'Settings.Employee Management');
  const canDelete = can('Delete', 'Settings.Employee Management');

  const [report, setReport] = useState<EmployeeRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ employeeNo: '', name: '', dateOfJoin: '' });
  const [editing, setEditing] = useState<EditState | null>(null);

  const isFetchingRef = useRef(false);

  const load = useCallback(
    async (mode: 'initial' | 'manual' | 'auto') => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (mode === 'initial') setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        setReport(await fetchEmployeeRoster());
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load the employee roster.';
        setError(message);
        // A background tick that fails retries on its own next cycle; interrupting a filtering
        // session with a toast for that would be noise. A click is different — somebody is waiting.
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
    if (isAuthLoading || !canView) {
      if (!isAuthLoading) setLoading(false);
      return;
    }
    void load('initial');
    const interval = setInterval(() => void load('auto'), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isAuthLoading, canView, load]);

  const employees = report?.employees ?? [];
  const filterOptions = report?.filterOptions ?? {};

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return employees.filter((row) => {
      if (query) {
        const haystack = [row.name, row.employeeNo, row.employeeId, row.email, row.phone]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (filters.status === 'working' && !isWorkingState(row.employmentState)) return false;
      if (filters.status === 'departed' && !hasExited(row.employmentState)) return false;
      if (filters.status === 'corrected' && !row.employmentStateCorrected) return false;
      if (filters.status === 'awaitingSync' && !row.awaitingSync) return false;
      if (
        filters.status !== 'all' &&
        !['working', 'departed', 'corrected', 'awaitingSync'].includes(filters.status) &&
        row.employmentState !== filters.status
      ) {
        return false;
      }
      for (const [category, value] of Object.entries(filters.categories)) {
        if (value && value !== 'all' && row.categories[category] !== value) return false;
      }
      return true;
    });
  }, [employees, search, filters]);

  const activeFilterCount =
    (filters.status !== 'all' ? 1 : 0) +
    Object.values(filters.categories).filter((value) => value && value !== 'all').length +
    (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setFilters({ status: 'all', categories: {} });
    setSearch('');
  };

  /* ── Writes ── */

  const handleAdd = async () => {
    if (!newEmployee.employeeNo.trim() || !newEmployee.name.trim()) {
      toast({ title: 'Validation', description: 'Employee No and Name are required.', variant: 'destructive' });
      return;
    }
    try {
      await addDoc(collection(db, 'employees'), {
        ...newEmployee,
        employeeId: '',
        email: '',
        phone: '',
        status: 'Active',
        department: '',
        designation: '',
      });
      toast({ title: 'Added', description: `${newEmployee.name} added.` });
      setNewEmployee({ employeeNo: '', name: '', dateOfJoin: '' });
      setAddOpen(false);
      void load('manual');
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Could not add.', variant: 'destructive' });
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    try {
      await updateDoc(doc(db, 'employees', editing.employeeId), {
        employeeNo: editing.employeeNo,
        name: editing.name,
        dateOfJoin: editing.dateOfJoin || null,
      });
      toast({ title: 'Updated', description: 'Employee updated.' });
      setEditing(null);
      void load('manual');
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Could not update.', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employees', id));
      toast({ title: 'Deleted', description: 'Employee record deleted.' });
      void load('manual');
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete.', variant: 'destructive' });
    }
  };

  const handleDeleteSelected = async () => {
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => batch.delete(doc(db, 'employees', id)));
      await batch.commit();
      toast({ title: 'Deleted', description: `${selectedIds.length} record(s) deleted.` });
      setSelectedIds([]);
      void load('manual');
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Could not delete.', variant: 'destructive' });
    }
  };

  /* ── Render ── */

  if (isAuthLoading || loading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Loading the employee roster…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrAccessDenied what="Employee Management" />
      </div>
    );
  }

  const counts = report?.counts;

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
        title="Manage Employee"
        description="The complete greytHR roster, current and departed — verified against greytHR on load."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load('manual')} disabled={refreshing} className="bg-white">
              <RefreshCw className={cn('mr-1.5 h-4 w-4', refreshing && 'animate-spin')} />
              Refresh
            </Button>
            {canAdd && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add Employee
              </Button>
            )}
          </>
        }
      />

      {error ? (
        <Card className="border-white/60 bg-white/80 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" onClick={() => void load('manual')}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ── Honesty notices ── */}

          {/*
            The distinction this page previously could not draw. `liveRoster: false` means greytHR
            could not be reached, so every state below is whatever the last sync happened to write —
            which is exactly the condition that made this screen wrong in the first place.
          */}
          {report && !report.liveRoster && (
            <HrAlertNotice tone="amber" title="Showing stored data — not verified against greytHR">
              greytHR could not be reached, so these employment states are whatever the last sync wrote
              {report.mirrorSyncedAt
                ? ` (${formatDistanceToNow(new Date(report.mirrorSyncedAt), { addSuffix: true })})`
                : ''}
              . Anyone who has joined or left since then may be shown incorrectly.
            </HrAlertNotice>
          )}

          {report && report.liveRoster && counts && counts.corrected > 0 && (
            <HrAlertNotice tone="blue" title={`${counts.corrected} record(s) corrected on the fly`}>
              greytHR still lists these people as current, but the stored record said they had left —
              usually a placeholder leaving date, or a sync that ran before that was handled. They are
              shown as working here; a full resync will correct the stored records themselves.
            </HrAlertNotice>
          )}

          {/*
            Deliberately two different messages, because "not in the mirror" has two causes that want
            opposite responses. If the mirror holds plenty of records and yet almost nothing matched,
            the join is at fault and running a sync would change nothing — saying "run a sync" there
            sends somebody to do useless work and leaves them no wiser.
          */}
          {report && counts && counts.awaitingSync > 0 && (() => {
            const join = report.joinDiagnostics;
            const suspectJoin =
              !!join && join.mirrorRecords > 0 && join.unmatched > 0 && join.matchedById + join.matchedByEmployeeNo === 0;

            return suspectJoin ? (
              <HrAlertNotice tone="amber" title={`${counts.awaitingSync} employee(s) could not be matched to a stored record`}>
                The mirror holds {join!.mirrorRecords} record(s), but none of them matched a current
                greytHR employee by either employee id or employee number. That points at a data
                mismatch rather than a missing sync — running one is unlikely to help. The list below is
                correct and comes from greytHR directly.
              </HrAlertNotice>
            ) : (
              <HrAlertNotice tone="blue" title={`${counts.awaitingSync} employee(s) not yet in the local mirror`}>
                greytHR has them but no sync has written them here yet, so their department, designation
                and project may be blank until the next run. They are listed rather than hidden.
              </HrAlertNotice>
            );
          })()}

          {report && counts && counts.salaryRows > 0 && (
            <HrAlertNotice tone="blue" title={`${counts.salaryRows} monthly salary row(s) hidden`}>
              The salary sync writes one document per employee per month into the same collection as
              employees. They are excluded here, but they do inflate any headcount that reads that
              collection directly.
            </HrAlertNotice>
          )}

          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HrKpiCard label="Employee records" value={counts?.total ?? 0} icon={Users} tone="slate" />
            <HrKpiCard label="Currently working" value={counts?.working ?? 0} icon={UserCheck} tone="emerald" />
            <HrKpiCard label="Departed" value={counts?.departed ?? 0} icon={UserMinus} tone="rose" />
            <HrKpiCard
              label="Verified"
              value={report?.liveRoster ? 'Live' : 'Stored'}
              hint={
                report?.liveRoster
                  ? 'Checked against greytHR just now'
                  : report?.mirrorSyncedAt
                    ? `Mirror from ${formatDistanceToNow(new Date(report.mirrorSyncedAt), { addSuffix: true })}`
                    : 'Never synced'
              }
              icon={report?.liveRoster ? ShieldCheck : CloudOff}
              tone={report?.liveRoster ? 'blue' : 'amber'}
            />
          </div>

          {/* ── Filters ── */}
          <HrFilterCard
            summary={activeFilterCount ? `${activeFilterCount} filter(s) active` : 'No filters applied'}
            actions={
              activeFilterCount ? (
                <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
              ) : undefined
            }
          >
            {/*
              Two bands, not one twelve-cell grid.

              Search and status answer "find this person"; the ten category selects answer "narrow
              this list", and they are used at different moments. Sharing one three-column grid gave
              every control the same 600px on a wide screen — a box that wide to hold the word
              "Grade" — and stacked twelve of them into four full-height rows that pushed the table
              itself below the fold.

              Now the finders keep a fixed, readable width instead of stretching to fill, and the
              categories sit in a five-across grid that divides exactly into two rows. Same twelve
              controls, roughly half the height, and nothing hidden behind a disclosure — on a screen
              whose whole purpose is filtering, a filter you have to go looking for is worse than a
              small one.
            */}
            <div className="flex flex-col gap-2">
              {/*
                The record count moved in here, into the width the fixed-size finders leave over.
                It was a standalone line below the card; now the row carries it instead of trailing a
                thousand pixels of nothing, and the page is one element shorter.
              */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-[340px]">
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search name, employee no, email…"
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

                <Select value={filters.status} onValueChange={(value) => setFilters((f) => ({ ...f, status: value }))}>
                  <SelectTrigger
                    className={cn(
                      FILTER_TRIGGER,
                      'w-full sm:w-[200px]',
                      filters.status !== 'all' && FILTER_TRIGGER_ACTIVE,
                    )}
                  >
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="working">Currently working</SelectItem>
                    <SelectItem value="departed">Departed</SelectItem>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Notice Period">Notice Period</SelectItem>
                    <SelectItem value="Relieved">Relieved</SelectItem>
                    <SelectItem value="Retired">Retired</SelectItem>
                    <SelectItem value="Settled">Settled</SelectItem>
                    <SelectItem value="Left">Left</SelectItem>
                    <SelectItem value="corrected">Corrected on the fly</SelectItem>
                    <SelectItem value="awaitingSync">Awaiting first sync</SelectItem>
                  </SelectContent>
                </Select>

                <p className="text-xs text-muted-foreground sm:ml-auto">
                  Showing <span className="font-medium text-slate-700">{filtered.length}</span>
                  {filtered.length !== employees.length ? <> of {employees.length}</> : null} record
                  {filtered.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {FILTER_ORDER.filter((category) => filterOptions[category]?.length).map((category) => {
                  const value = filters.categories[category] ?? 'all';
                  const isActive = value !== 'all';
                  return (
                    <Select
                      key={category}
                      value={value}
                      onValueChange={(next) =>
                        setFilters((f) => ({ ...f, categories: { ...f.categories, [category]: next } }))
                      }
                    >
                      {/*
                        Tinted when set, so which of the ten are actually filtering is answerable at a
                        glance. A chip row below would say the same thing twice and would spend the
                        height this change just saved.

                        The label is carried in the trigger rather than left to `SelectValue`, which
                        renders the bare value: "S1" and "Directors" sitting in a ten-cell grid do not
                        say *which* filter they are, and once the fields are small enough to fit two
                        rows there is no column heading to infer it from either. Prefixing costs
                        nothing when the field is wide and truncates the value — never the category —
                        when it is not, so the more useful half always survives.
                      */}
                      <SelectTrigger
                        className={cn(FILTER_TRIGGER, isActive && FILTER_TRIGGER_ACTIVE)}
                        title={isActive ? `${category}: ${value}` : `Filter by ${category}`}
                      >
                        <span className="truncate">
                          {isActive ? (
                            <>
                              <span className="opacity-70">{category}:</span> {value}
                            </>
                          ) : (
                            `All ${category}`
                          )}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All {category}</SelectItem>
                        {filterOptions[category].map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })}
              </div>
            </div>
          </HrFilterCard>

          {/*
            Only the bulk action lives here now — the record count moved up into the filter row,
            which had spare width and no reason not to carry it. Rendered conditionally rather than
            left as an empty flex row, so an unselected table has no gap above it at all.
          */}
          {selectedIds.length > 0 && canDelete && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete ({selectedIds.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.length} employee record(s)?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the local records only — it does not change anything in greytHR, so the
                      next sync will recreate anyone greytHR still has. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleDeleteSelected()} className="bg-destructive hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {/* ── Table ── */}
          <Card className="bg-white/80 backdrop-blur-sm">
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <div className="py-4">
                  <HrEmptyState
                    icon={Users}
                    title={activeFilterCount ? 'No employees match these filters' : 'No employee records yet'}
                    description={
                      activeFilterCount
                        ? 'Try a different name, status, department or project.'
                        : 'Run a greytHR sync to populate the roster.'
                    }
                    action={
                      activeFilterCount ? (
                        <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <div className="max-h-[65vh] overflow-auto">
                  <table className="w-full min-w-[1100px] text-sm">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b bg-slate-100">
                        {canDelete && (
                          <th className="w-[44px] px-4 py-2.5">
                            <Checkbox
                              checked={filtered.length > 0 && selectedIds.length === filtered.length}
                              onCheckedChange={(checked) =>
                                setSelectedIds(checked ? filtered.map((row) => row.employeeId) : [])
                              }
                              aria-label="Select all"
                            />
                          </th>
                        )}
                        <th className="px-4 py-2.5 text-left font-medium">Employee</th>
                        <th className="px-4 py-2.5 text-left font-medium">State</th>
                        <th className="px-4 py-2.5 text-left font-medium">Department</th>
                        <th className="px-4 py-2.5 text-left font-medium">Designation</th>
                        <th className="px-4 py-2.5 text-left font-medium">Location</th>
                        <th className="px-4 py-2.5 text-left font-medium">Project</th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Joined</th>
                        <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Exit date</th>
                        {(canEdit || canDelete) && <th className="px-4 py-2.5 text-right font-medium">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <RosterRow
                          key={row.employeeId}
                          row={row}
                          canEdit={canEdit}
                          canDelete={canDelete}
                          selected={selectedIds.includes(row.employeeId)}
                          onSelect={(checked) =>
                            setSelectedIds((prev) =>
                              checked ? [...prev, row.employeeId] : prev.filter((id) => id !== row.employeeId),
                            )
                          }
                          onEdit={() =>
                            setEditing({
                              employeeId: row.employeeId,
                              employeeNo: row.employeeNo ?? '',
                              name: row.name ?? '',
                              dateOfJoin: row.dateOfJoin ?? '',
                            })
                          }
                          onDelete={() => void handleDelete(row.employeeId)}
                        />
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-4 py-2.5" colSpan={canDelete ? 3 : 2}>Total</td>
                        <td className="px-4 py-2.5" colSpan={(canEdit || canDelete) ? 8 : 7}>
                          {filtered.length} record{filtered.length === 1 ? '' : 's'} ·{' '}
                          <span className="text-emerald-700">
                            {filtered.filter((row) => isWorkingState(row.employmentState)).length} working
                          </span>{' '}
                          ·{' '}
                          <span className="text-rose-700">
                            {filtered.filter((row) => hasExited(row.employmentState)).length} departed
                          </span>
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

      {/* ── Add ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className={hrDialog.content}>
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
            <DialogDescription>
              For someone greytHR does not have. A greytHR sync will not overwrite this record unless the
              employee number matches.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="addEmployeeNo">Employee No</Label>
              <Input id="addEmployeeNo" value={newEmployee.employeeNo}
                onChange={(e) => setNewEmployee((s) => ({ ...s, employeeNo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addName">Name</Label>
              <Input id="addName" value={newEmployee.name}
                onChange={(e) => setNewEmployee((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="addDoj">Date of join</Label>
              <Input id="addDoj" type="date" value={newEmployee.dateOfJoin}
                onChange={(e) => setNewEmployee((s) => ({ ...s, dateOfJoin: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleAdd()}>Add employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit ── */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className={hrDialog.content}>
          <DialogHeader>
            <DialogTitle>Edit employee</DialogTitle>
            <DialogDescription>
              greytHR is the source of truth for these fields — the next sync will overwrite anything you
              change here for an employee greytHR still has.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="editEmployeeNo">Employee No</Label>
                <Input id="editEmployeeNo" value={editing.employeeNo}
                  onChange={(e) => setEditing({ ...editing, employeeNo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editName">Name</Label>
                <Input id="editName" value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editDoj">Date of join</Label>
                <Input id="editDoj" type="date" value={editing.dateOfJoin}
                  onChange={(e) => setEditing({ ...editing, dateOfJoin: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button onClick={() => void handleUpdate()}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RosterRow({
  row, canEdit, canDelete, selected, onSelect, onEdit, onDelete,
}: {
  row: RosterEmployeeRow;
  canEdit: boolean;
  canDelete: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b transition-colors hover:bg-muted/20" data-state={selected ? 'selected' : undefined}>
      {canDelete && (
        <td className="px-4 py-2.5">
          <Checkbox checked={selected} onCheckedChange={(checked) => onSelect(!!checked)}
            aria-label={`Select ${row.name || row.employeeId}`} />
        </td>
      )}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className={cn('text-[11px] font-semibold', avatarTone(row.employeeId))}>
              {initials(row.name || row.employeeNo || '?')}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 max-w-[170px]">
            {/* The profile screen holds every field greytHR has, plus the restricted block. */}
            <Link href={`/employee/${encodeURIComponent(row.employeeId)}`} className="truncate font-medium text-slate-800 hover:underline block">
              {row.name || '—'}
            </Link>
            <p className="truncate text-xs text-muted-foreground">{row.employeeNo || row.employeeId}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-col items-start gap-1">
          <Badge variant="outline" className={cn('font-medium', STATE_TONE[row.employmentState])} title={row.employmentStateReason}>
            {row.employmentState}
          </Badge>
          {/*
            Surfaced rather than applied silently: "Active because greytHR says so" and "Active
            because we disbelieved the stored leaving date" are different claims, and somebody
            deciding whether to grant a login should be able to tell them apart.
          */}
          {row.employmentStateCorrected && (
            <span className="text-[10px] font-medium text-blue-600" title={row.employmentStateReason}>
              corrected
            </span>
          )}
          {row.awaitingSync && (
            <span className="text-[10px] font-medium text-amber-600" title="In greytHR but not yet written to the local mirror">
              awaiting sync
            </span>
          )}
        </div>
      </td>
      <td className="max-w-[140px] truncate px-4 py-2.5">{row.categories['Department'] || row.department || '—'}</td>
      <td className="max-w-[160px] truncate px-4 py-2.5">{row.categories['Designation'] || row.designation || '—'}</td>
      <td className="max-w-[130px] truncate px-4 py-2.5">{row.categories['Location'] || row.location || '—'}</td>
      <td className="max-w-[150px] truncate px-4 py-2.5">{row.categories['Project Name'] || row.projectName || '—'}</td>
      <td className="whitespace-nowrap px-4 py-2.5">{formatDate(row.dateOfJoin)}</td>
      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDate(row.exitDate)}</td>
      {(canEdit || canDelete) && (
        <td className="px-4 py-2.5 text-right">
          <div className="flex justify-end gap-1">
            {canEdit && <Button variant="outline" size="sm" onClick={onEdit}>Edit</Button>}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {row.name || 'this employee'}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes the local record only — it does not change greytHR, so the next sync will
                      recreate them if greytHR still has them. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}
