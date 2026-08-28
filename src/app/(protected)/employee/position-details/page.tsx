'use client';

/**
 * Every employee's effective-dated position history, as mirrored from greytHR.
 *
 * The freshness line here is the part worth understanding. Two different flows write the
 * `employeePositions` collection:
 *
 *  - the hourly unified greytHR sync, which writes the rows but records its run against
 *    `settings/greythrSync` and never touches `settings/employeePositionSync`; and
 *  - the legacy manual button on this page, which writes both.
 *
 * The old screen read only the legacy document, so on an installation where the hourly sync does the
 * work the timestamp showed blank or months old — fresh data presented as stale, which is exactly what
 * pushes somebody towards the destructive "Clear & Resync". Both documents are now read and the more
 * recent one wins, labelled with which flow it came from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Clock, Download, Layers, Loader2, RefreshCw, Search, Tags, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getAllEmployeePositions } from '@/ai';
import { Badge } from '@/components/ui/badge';
import type { EmployeePosition } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { fetchEmployeeRoster } from '@/lib/greythr-sync-client';
import { exportRowsToExcel } from '@/lib/report-excel';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, getDoc, doc, writeBatch } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAccessDenied,
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  hrDialog,
  type HrListColumn,
} from '@/components/hr/hr-ui';

/** One flattened category row: an employee plus one of their effective-dated values. */
type PositionRow = {
  id: string;
  employeeId: string;
  name: string;
  category: string;
  value: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

/** Which flow wrote the timestamp on screen. Naming it stops "last synced" reading as a single truth. */
type SyncStamp = { at: Date; source: 'the hourly greytHR sync' | 'the manual sync on this page' };

/**
 * How many rows are put in the DOM at once.
 *
 * The register is one row per employee *per category value* — roughly ten thousand at full company
 * size — and the responsive list renders a mobile card and a table row for each. Rendering the lot
 * froze the page, so it grows on request instead; the filters above are the fast way to the row you
 * actually want.
 */
const PAGE_SIZE = 300;

/** ISO strings today; a legacy Firestore `Timestamp` would otherwise render as `Invalid Date`. */
function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const COLUMNS: Array<HrListColumn<PositionRow>> = [
  {
    header: 'Name',
    cell: row => <span className="font-medium text-slate-800">{row.name || '—'}</span>,
    mobile: 'title',
  },
  {
    header: 'Employee ID',
    cell: row => <span className="tabular-nums text-slate-700">{row.employeeId}</span>,
    mobile: 'title',
  },
  {
    header: 'Category',
    cell: row => <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-normal text-indigo-700">{row.category}</Badge>,
    mobile: 'aside',
  },
  {
    header: 'Value',
    cell: row => <Badge variant="secondary" className="font-normal">{row.value}</Badge>,
  },
  {
    header: 'Effective From',
    cell: row => <span className="whitespace-nowrap tabular-nums">{row.effectiveFrom || '—'}</span>,
  },
  {
    header: 'Effective To',
    cell: row => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{row.effectiveTo || 'N/A'}</span>,
  },
];

export default function EmployeePositionDetailsPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();

  const [allPositions, setAllPositions] = useState<EmployeePosition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<SyncStamp | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  /**
   * Employee number/id → name, from the roster endpoint Manage Employee already reads. The position
   * documents themselves carry no names — the sync keys them by employee number alone — so this one
   * extra fetch is what turns a register of bare ids into one a person can scan. Losing it costs
   * the Name column, never the rows.
   */
  const [namesById, setNamesById] = useState<Map<string, string>>(new Map());

  const [filters, setFilters] = useState({
    employeeId: '',
    category: 'all',
  });

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');
  const canDelete = can('Delete', 'Settings.Employee Management');

  const fetchPositionsFromDb = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const q = query(collection(db, 'employeePositions'));
      const [snapshot, legacyDoc, syncDoc] = await Promise.all([
        getDocs(q),
        // Both flows are consulted — see the file header. A failure to read either costs the
        // timestamp, not the rows.
        getDoc(doc(db, 'settings', 'employeePositionSync')).catch(() => null),
        getDoc(doc(db, 'settings', 'greythrSync')).catch(() => null),
      ]);
      const data = snapshot.docs.map(document => document.data() as EmployeePosition);
      setAllPositions(data);

      const legacyAt = legacyDoc?.exists() ? toDate(legacyDoc.data().lastSynced) : null;
      const unifiedAt = syncDoc?.exists()
        ? toDate(syncDoc.data().lastSuccessfulRunAt) ?? toDate(syncDoc.data().lastRunAt)
        : null;

      // The more recent of the two is the age of what is on screen; either one alone can understate it.
      const candidates: SyncStamp[] = [];
      if (unifiedAt) candidates.push({ at: unifiedAt, source: 'the hourly greytHR sync' });
      if (legacyAt) candidates.push({ at: legacyAt, source: 'the manual sync on this page' });
      candidates.sort((a, b) => b.at.getTime() - a.at.getTime());
      setLastSynced(candidates[0] ?? null);
    } catch (error: any) {
      console.error('Error fetching positions from Firestore:', error);
      // On-page rather than a toast: a toast disappears and leaves the empty state behind, which
      // reads as "no position details yet" — a claim about the data, not about the failed read.
      setLoadError(error?.message || 'Failed to read the employeePositions collection.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    if (canView) {
      void fetchPositionsFromDb();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canView, fetchPositionsFromDb]);

  useEffect(() => {
    if (isAuthLoading || !canView) return;
    let cancelled = false;
    fetchEmployeeRoster()
      .then(report => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const row of report.employees) {
          if (!row.name) continue;
          // Position documents are keyed by employee number, falling back to the raw greytHR id
          // when the number was unknown at sync time — so both keys resolve to the name.
          if (row.employeeNo) map.set(String(row.employeeNo), row.name);
          map.set(String(row.employeeId), row.name);
        }
        setNamesById(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthLoading, canView]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await getAllEmployeePositions({ page: 1 });
      if (result.success) {
        toast({ title: 'Sync Successful', description: result.message });
        await fetchPositionsFromDb(); // Refresh data from Firestore
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message || 'Could not sync position details.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearAndResync = async () => {
    setIsDeleting(true);
    try {
      // Step 1: Delete all existing documents
      const positionsRef = collection(db, 'employeePositions');
      const snapshot = await getDocs(positionsRef);
      if (!snapshot.empty) {
        const batch = writeBatch(db);
        snapshot.docs.forEach(document => {
          batch.delete(document.ref);
        });
        await batch.commit();
      }
      toast({ title: 'Cleared', description: `${snapshot.size} records deleted. Starting fresh sync...` });

      // Step 2: Trigger a new sync
      await handleSync();
    } catch (error: any) {
      toast({ title: 'Error', description: `Failed to clear and resync: ${error.message}`, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleFilterChange = (field: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearFilters = () => {
    setFilters({ employeeId: '', category: 'all' });
  };

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    allPositions.forEach(pos => {
      pos.categoryList.forEach(cat => {
        if (cat.category) categories.add(cat.category);
      });
    });
    return Array.from(categories).sort();
  }, [allPositions]);

  const filteredPositions = useMemo(() => {
    const term = filters.employeeId.trim().toLowerCase();
    return allPositions
      .map(pos => {
        const filteredCategoryList = pos.categoryList.filter(cat => {
          const categoryMatch = filters.category === 'all' || cat.category === filters.category;
          return categoryMatch;
        });
        return { ...pos, categoryList: filteredCategoryList };
      })
      .filter(pos => {
        const employeeMatch =
          term === '' ||
          String(pos.employeeId).toLowerCase().includes(term) ||
          (namesById.get(String(pos.employeeId)) ?? '').toLowerCase().includes(term);
        return employeeMatch && pos.categoryList.length > 0;
      });
  }, [allPositions, filters, namesById]);

  /** The register, flattened one row per (employee, category value). */
  const rows = useMemo<PositionRow[]>(
    () =>
      filteredPositions.flatMap(pos =>
        pos.categoryList.map(cat => ({
          id: `${pos.employeeId}-${cat.id}`,
          employeeId: String(pos.employeeId),
          name: namesById.get(String(pos.employeeId)) ?? '',
          category: cat.category,
          value: cat.value,
          effectiveFrom: cat.effectiveFrom,
          effectiveTo: cat.effectiveTo,
        })),
      ),
    [filteredPositions, namesById],
  );

  const handleExport = async () => {
    if (!rows.length) return;
    try {
      await exportRowsToExcel(
        'Employee position details',
        rows.map(row => ({
          'Employee ID': row.employeeId,
          Name: row.name,
          Category: row.category,
          Value: row.value,
          'Effective from': row.effectiveFrom,
          'Effective to': row.effectiveTo ?? '',
        })),
        { filename: 'employee-position-details.xlsx' },
      );
    } catch (error: any) {
      toast({
        title: 'Export failed',
        description: error?.message || 'Could not build the workbook.',
        variant: 'destructive',
      });
    }
  };

  // Narrowing the filters should start again from the top of a short list, not halfway down a long one.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters.employeeId, filters.category]);

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const filtersActive = filters.employeeId !== '' || filters.category !== 'all';

  if (isAuthLoading) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <HrLoader label="Checking your access…" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
        <AuroraBackdrop />
        <div className="mb-4 flex items-center gap-2">
          <Link href="/employee">
            <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold text-slate-800">All Employee Position Details</h1>
        </div>
        <HrAccessDenied what="employee position details" />
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-3 sm:px-5">
      <AuroraBackdrop />

      <div className="mb-1 flex items-center gap-2">
        <Link href="/employee">
          <Button variant="ghost" size="icon" className="rounded-full bg-white/70 shadow-sm backdrop-blur">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      <HrPageHeader
        title="All Employee Position Details"
        description="Browse the effective-dated department, designation, grade, location and project history mirrored from greytHR."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={isLoading || isDeleting || rows.length === 0}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isSyncing || isDeleting || !canDelete}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Clear &amp; Resync
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className={hrDialog.content}>
                <AlertDialogHeader className={hrDialog.header}>
                  <AlertDialogTitle>Delete every position record, then re-fetch?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This is not a refresh. It empties the collection first and only then asks greytHR for
                    the data again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {/*
                  Spelled out because the failure mode is invisible from the button: the delete and the
                  fetch are two separate steps, and nothing puts the old rows back if the second one
                  fails. The plain sync overwrites in place and cannot leave the screen blank.
                */}
                <div className={hrDialog.body}>
                  <HrAlertNotice tone="rose" title="What this does">
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      <li>
                        Deletes <strong>all {allPositions.length} documents</strong> in{' '}
                        <code>employeePositions</code> — the whole collection, not just the rows matching
                        your filters.
                      </li>
                      <li>
                        Then starts a fresh sync. If that sync fails or is interrupted part-way, the
                        collection stays <strong>empty or incomplete</strong> and there is no undo — the
                        deleted history is gone until a later sync refills it.
                      </li>
                      <li>
                        Manage Employee and the salary screens read this same collection, so they will
                        look empty too until the sync finishes.
                      </li>
                    </ul>
                  </HrAlertNotice>
                  <HrAlertNotice tone="blue" title="Usually unnecessary">
                    The hourly greytHR sync already rewrites these records, and{' '}
                    <strong>Sync from GreytHR</strong> overwrites them in place without deleting anything.
                    Use Clear &amp; Resync only to remove records for employees greytHR no longer returns.
                  </HrAlertNotice>
                </div>
                <AlertDialogFooter className={hrDialog.footer}>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleClearAndResync()}>
                    Delete and resync
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={() => void handleSync()} disabled={isSyncing || isDeleting || !canSync}>
              {isSyncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Sync from GreytHR
            </Button>
          </>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HrKpiCard label="Employees" value={isLoading ? '—' : allPositions.length} icon={Users} tone="indigo" />
        <HrKpiCard
          label="Position records"
          value={isLoading ? '—' : rows.length}
          hint={filtersActive ? 'Matching your filters' : 'All category values'}
          icon={Layers}
          tone="blue"
        />
        <HrKpiCard label="Categories" value={isLoading ? '—' : uniqueCategories.length} icon={Tags} tone="violet" />
        <HrKpiCard
          label="Last synced"
          value={lastSynced ? formatDistanceToNow(lastSynced.at, { addSuffix: true }) : 'Unknown'}
          hint={lastSynced ? `By ${lastSynced.source}` : 'No sync run recorded by either flow'}
          icon={Clock}
          tone={lastSynced ? 'emerald' : 'amber'}
        />
      </div>

      <HrFilterCard
        summary={
          filtersActive
            ? `${rows.length} record(s) matching${filters.category !== 'all' ? ` · ${filters.category}` : ''}`
            : `${rows.length} record(s) across ${allPositions.length} employee(s)`
        }
        actions={
          filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs">
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-grow">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search employee ID or name..."
              className="pl-8"
              value={filters.employeeId}
              onChange={e => handleFilterChange('employeeId', e.target.value)}
            />
          </div>
          <Select value={filters.category} onValueChange={value => handleFilterChange('category', value)}>
            <SelectTrigger className="w-full sm:w-[240px]">
              <SelectValue placeholder="Filter by Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {uniqueCategories.map(cat => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </HrFilterCard>

      {isLoading || isDeleting ? (
        <HrLoader label={isDeleting ? 'Clearing records and resyncing…' : 'Loading position details…'} />
      ) : loadError ? (
        <Card className="border-white/60 bg-white/80 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" onClick={() => void fetchPositionsFromDb()}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          <HrDataList
            rows={visibleRows}
            columns={COLUMNS}
            empty={
              <HrEmptyState
                icon={Layers}
                title={filtersActive ? 'No records match these filters' : 'No position details yet'}
                description={
                  filtersActive
                    ? 'Try a different employee ID or category.'
                    : 'The hourly greytHR sync writes these records. If it has not run here, sync now to fetch them.'
                }
                action={
                  filtersActive ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {rows.length > 0 && (
            <div className="flex flex-col items-center gap-2 pb-2 text-center">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-medium text-slate-700">{visibleRows.length}</span> of {rows.length} record
                {rows.length === 1 ? '' : 's'}
              </p>
              {visibleRows.length < rows.length && (
                <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, rows.length - visibleRows.length)} more
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
