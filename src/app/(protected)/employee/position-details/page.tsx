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
import {
  Briefcase,
  Clock,
  Columns3,
  Download,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getAllEmployeePositions } from '@/ai';
import { Badge } from '@/components/ui/badge';
import type { EmployeePosition } from '@/lib/types';
import { useAuthorization } from '@/hooks/useAuthorization';
import { fetchEmployeeRoster } from '@/lib/greythr-sync-client';
import { exportRowsToExcel } from '@/lib/report-excel';
import { cn } from '@/lib/utils';
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
import {
  HrAccessDenied,
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrLoader,
  hrDialog,
  type HrListColumn,
} from '@/components/hr/hr-ui';
import {
  EmployeeColumnPicker,
  EmployeeHeader,
  EmployeeKpiCard,
  EmployeeListFooter,
  EmployeePageShell,
  EmployeeStatusPill,
  EmployeeSubNav,
  EMP_CARD_CLASS,
  EMP_REGISTER_HEIGHT,
} from '@/components/employee/employee-ui';

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

/**
 * One employee and their whole position history — the register's row.
 *
 * `entries` is every effective-dated value the filters left for them, so the expanded grid and the
 * summary on the row can never disagree about what is being counted.
 */
type EmployeeGroup = {
  id: string;
  employeeId: string;
  name: string;
  entries: PositionRow[];
  /** Distinct category names, for the row's summary. */
  categories: string[];
  /** Entries with no end date — what this person's position is *now*. */
  current: PositionRow[];
  /** The most recent `effectiveFrom`, so a row can say when it last changed. */
  latestFrom: string;
};

/** Which flow wrote the timestamp on screen. Naming it stops "last synced" reading as a single truth. */
type SyncStamp = { at: Date; source: 'the hourly greytHR sync' | 'the manual sync on this page' };

/**
 * How many employees are put in the DOM at once.
 *
 * Was three hundred *rows*, which at one row per category value was fifty-odd people. Now that a row
 * is an employee — with their entries rendered only when the row is opened — the same budget covers
 * the whole company, so the window is a guard rather than a routine limit.
 */
const PAGE_SIZE = 150;

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

/**
 * The column that identifies the row, in both views.
 *
 * Named once because the column picker locks it: a table whose first column can be hidden becomes a
 * grid of values belonging to nobody.
 */
const EMPLOYEE_COLUMN = 'Employee';

/** The current value of a category is the one greytHR left open-ended. */
const isCurrentEntry = (entry: PositionRow): boolean => !entry.effectiveTo;

/**
 * One employee's effective-dated values, as a table.
 *
 * Rendered only for the row a reader opened — the whole point of grouping the register by employee.
 *
 * Sorted by category, then by the value in force, then newest first. That ordering is what lets the
 * Category column repeat its label on every row rather than blanking the repeats: the groups stay
 * contiguous, so the column reads as a group heading *and* survives being scanned from any row,
 * which a blanked cell does not.
 */
function PositionEntries({ entries }: { entries: PositionRow[] }) {
  const ordered = [...entries].sort((a, b) => {
    const byCategory = a.category.localeCompare(b.category);
    if (byCategory !== 0) return byCategory;
    // An open-ended row is the newest there is, whatever its start date says.
    if (isCurrentEntry(a) !== isCurrentEntry(b)) return isCurrentEntry(a) ? -1 : 1;
    return String(b.effectiveFrom).localeCompare(String(a.effectiveFrom));
  });

  if (!ordered.length) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">No position records for this employee.</p>;
  }

  return (
    <div className="overflow-x-auto px-3 py-3">
      <table className="w-full min-w-[32rem] text-xs">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5">Category</th>
            <th className="px-2 py-1.5">Value</th>
            <th className="px-2 py-1.5">Effective from</th>
            <th className="px-2 py-1.5">Effective to</th>
            <th className="px-2 py-1.5 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {ordered.map((entry, index) => {
            const current = isCurrentEntry(entry);
            // A hairline above the first row of each category, so the groups read without needing
            // the label to disappear on the repeats.
            const startsCategory = index === 0 || ordered[index - 1].category !== entry.category;
            return (
              <tr
                key={entry.id}
                className={cn(current && 'bg-emerald-50/40', startsCategory && index > 0 && 'border-t-slate-200')}
              >
                <td className="whitespace-nowrap px-2 py-1.5">
                  <Badge
                    variant="outline"
                    className="border-indigo-200 bg-indigo-50 text-[10px] font-normal text-indigo-700"
                  >
                    {entry.category}
                  </Badge>
                </td>
                <td className="px-2 py-1.5 font-medium text-slate-800">{entry.value || '—'}</td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700">
                  {entry.effectiveFrom || '—'}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                  {/* greytHR leaves the end date empty for the value in force; the old "N/A" read as
                      missing data rather than as "still applies". */}
                  {entry.effectiveTo || <span className="font-medium text-emerald-700">present</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  {current ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700"
                    >
                      Current
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">Superseded</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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

  /**
   * The register: one entry per employee, their history attached.
   *
   * Named employees first and then by id, the same order the other registers in the module use — a
   * block of bare ids interleaved through an alphabetical list reads as corruption, and at the end
   * it reads as the queue of people the mirror cannot name yet.
   */
  const groups = useMemo<EmployeeGroup[]>(() => {
    const byEmployee = new Map<string, EmployeeGroup>();
    for (const row of rows) {
      const existing = byEmployee.get(row.employeeId);
      if (existing) {
        existing.entries.push(row);
        continue;
      }
      byEmployee.set(row.employeeId, {
        id: row.employeeId,
        employeeId: row.employeeId,
        name: row.name,
        entries: [row],
        categories: [],
        current: [],
        latestFrom: '',
      });
    }

    const list = [...byEmployee.values()];
    for (const group of list) {
      group.categories = [...new Set(group.entries.map(entry => entry.category).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      );
      group.current = group.entries.filter(isCurrentEntry);
      group.latestFrom = group.entries.reduce(
        (latest, entry) => (String(entry.effectiveFrom) > latest ? String(entry.effectiveFrom) : latest),
        '',
      );
    }

    return list.sort((a, b) => {
      if (Boolean(a.name) !== Boolean(b.name)) return a.name ? -1 : 1;
      if (a.name) return a.name.localeCompare(b.name);
      return Number(a.employeeId) - Number(b.employeeId);
    });
  }, [rows]);

  /**
   * The export follows whichever view is on screen.
   *
   * A reader who has pivoted to one column per category and then exports expects that shape, not a
   * ten-thousand-row history — and the history export is still one click away in the other view.
   * Both respect the filters, because exporting more than the screen shows is how a spreadsheet ends
   * up disagreeing with the page it came from.
   */
  const handleExport = async () => {
    if (!rows.length) return;
    try {
      if (view === 'columns') {
        await exportRowsToExcel(
          'Employee positions by category',
          groups.map(group => ({
            'Employee ID': group.employeeId,
            Name: group.name || `Employee ${group.employeeId}`,
            // One column per category, matching the table — and only the categories on screen, so a
            // hidden column is absent from the workbook too.
            ...Object.fromEntries(
              uniqueCategories
                .filter(category => !hiddenPivot.has(category))
                .map(category => [
                  category,
                  group.current
                    .filter(entry => entry.category === category)
                    .map(entry => entry.value)
                    .join(', '),
                ]),
            ),
          })),
          { filename: 'employee-positions-by-category.xlsx' },
        );
        return;
      }

      await exportRowsToExcel(
        'Employee position details',
        rows.map(row => ({
          'Employee ID': row.employeeId,
          Name: row.name,
          Category: row.category,
          Value: row.value,
          'Effective from': row.effectiveFrom,
          'Effective to': row.effectiveTo ?? '',
          Status: row.effectiveTo ? 'Superseded' : 'Current',
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

  const visibleGroups = useMemo(() => groups.slice(0, visibleCount), [groups, visibleCount]);
  const filtersActive = filters.employeeId !== '' || filters.category !== 'all';

  /** One expanded employee at a time, so a long history never fights another for the screen. */
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * Which shape the register takes.
   *
   * `grouped` is one row per employee, expanding to their history. `columns` is one row per
   * employee with a column per category, showing the value in force. Same data, two questions: the
   * first is about one person over time, the second about everybody right now.
   */
  const [view, setView] = useState<'grouped' | 'columns'>('grouped');

  /**
   * Hidden columns, tracked per view.
   *
   * Separately, because the two views share no columns beyond Employee — carrying one set across
   * would hide "Records" in the grouped view because somebody hid "Grade" in the other.
   */
  const [hiddenGrouped, setHiddenGrouped] = useState<Set<string>>(new Set());
  const [hiddenPivot, setHiddenPivot] = useState<Set<string>>(new Set());

  // A narrowed filter should not leave a row open that is no longer in the list.
  useEffect(() => {
    setOpenId(null);
  }, [filters.employeeId, filters.category]);

  /**
   * One column per category, in the order the category list is in.
   *
   * The cell is the value greytHR left open-ended. An employee with no open-ended value for a
   * category gets an em dash rather than their most recent closed one: "was a Site Engineer until
   * March" is not an answer to "what is their designation", and quietly showing a superseded value
   * as current is the kind of wrong this module has been fixing all day.
   */
  const pivotColumns: Array<HrListColumn<EmployeeGroup>> = [
    {
      header: EMPLOYEE_COLUMN,
      mobile: 'title',
      cell: group => (
        <span className="block">
          <span className={cn('font-medium', group.name ? 'text-slate-800' : 'text-slate-500')}>
            {group.name || `Employee ${group.employeeId}`}
          </span>
          <span className="block text-[11px] font-normal tabular-nums text-muted-foreground">
            ID {group.employeeId}
          </span>
        </span>
      ),
    },
    ...uniqueCategories.map<HrListColumn<EmployeeGroup>>(category => ({
      header: category,
      mobile: 'detail',
      cell: group => {
        const current = group.current.filter(entry => entry.category === category);
        if (!current.length) {
          // Distinguishes "greytHR has nothing in force" from "this employee has no record at all",
          // which a bare dash in both cases would not.
          const everHad = group.entries.some(entry => entry.category === category);
          return (
            <span className="text-xs text-muted-foreground" title={everHad ? 'Only superseded values on record' : undefined}>
              {everHad ? 'ended' : '—'}
            </span>
          );
        }
        return (
          <span className="flex flex-wrap gap-1">
            {current.map(entry => (
              <span key={entry.id} className="whitespace-nowrap text-sm text-slate-800">
                {entry.value}
              </span>
            ))}
          </span>
        );
      },
    })),
  ];

  const columns: Array<HrListColumn<EmployeeGroup>> = [
    {
      header: EMPLOYEE_COLUMN,
      mobile: 'title',
      cell: group => (
        <span className="block">
          <span className={cn('font-medium', group.name ? 'text-slate-800' : 'text-slate-500')}>
            {group.name || `Employee ${group.employeeId}`}
          </span>
          <span className="block text-[11px] font-normal tabular-nums text-muted-foreground">
            ID {group.employeeId}
          </span>
        </span>
      ),
    },
    {
      header: 'Current position',
      mobile: 'detail',
      cell: group => {
        if (!group.current.length) {
          return <span className="text-xs text-muted-foreground">Nothing open-ended</span>;
        }
        return (
          <span className="flex flex-wrap gap-1">
            {group.current.slice(0, 3).map(entry => (
              <Badge
                key={entry.id}
                variant="secondary"
                className="max-w-[12rem] truncate text-[10px] font-normal"
                title={`${entry.category}: ${entry.value}`}
              >
                {entry.value}
              </Badge>
            ))}
            {group.current.length > 3 && (
              <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                +{group.current.length - 3}
              </Badge>
            )}
          </span>
        );
      },
    },
    {
      header: 'Categories',
      align: 'right',
      mobile: 'detail',
      className: 'hidden sm:table-cell',
      cell: group => <span className="tabular-nums text-slate-700">{group.categories.length}</span>,
    },
    {
      header: 'Records',
      align: 'right',
      mobile: 'aside',
      cell: group => (
        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 font-semibold text-indigo-700">
          {group.entries.length}
        </Badge>
      ),
    },
    {
      header: 'Last change',
      align: 'right',
      mobile: 'detail',
      className: 'hidden md:table-cell',
      cell: group => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">{group.latestFrom || '—'}</span>
      ),
    },
  ];

  const activeColumns = view === 'grouped' ? columns : pivotColumns;
  const hidden = view === 'grouped' ? hiddenGrouped : hiddenPivot;
  const setHidden = view === 'grouped' ? setHiddenGrouped : setHiddenPivot;
  const columnKeys = activeColumns.map(column => column.header);
  const shownColumns = activeColumns.filter(column => !hidden.has(column.header));

  if (isAuthLoading) {
    return (
      <EmployeePageShell>
        <HrLoader label="Checking your access…" />
      </EmployeePageShell>
    );
  }

  if (!canView) {
    return (
      <EmployeePageShell>
        <EmployeeHeader
          icon={Briefcase}
          tone="violet"
          eyebrow="Employee management"
          title="Position details"
          backHref="/employee"
          backLabel="Back to Employee Management"
        />
        <HrAccessDenied what="employee position details" />
      </EmployeePageShell>
    );
  }

  return (
    <EmployeePageShell>
      <EmployeeHeader
        icon={Briefcase}
        tone="violet"
        eyebrow="Employee management"
        title="Position details"
        backHref="/employee"
        backLabel="Back to Employee Management"
        description="The effective-dated department, designation, grade, location and project history mirrored from greytHR — one row per employee per category value."
        status={
          lastSynced ? (
            <EmployeeStatusPill tone="emerald" icon={Clock}>
              Synced {formatDistanceToNow(lastSynced.at, { addSuffix: true })}
            </EmployeeStatusPill>
          ) : (
            <EmployeeStatusPill tone="amber" icon={Clock}>
              No sync recorded
            </EmployeeStatusPill>
          )
        }
        meta={lastSynced ? `Written by ${lastSynced.source}.` : undefined}
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

      <EmployeeSubNav current="position" />

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <EmployeeKpiCard
          label="Employees"
          value={isLoading ? '—' : groups.length}
          // The filtered count, with the total beside it: a KPI that ignores the filters below it is
          // the "two numbers about the same fact" problem this module has already had once.
          hint={filtersActive ? `of ${allPositions.length} with position records` : 'With position records'}
          icon={Users}
          tone="indigo"
          index={0}
        />
        <EmployeeKpiCard
          label="Position records"
          value={isLoading ? '—' : rows.length}
          hint={filtersActive ? 'Matching your filters' : 'All category values'}
          icon={Layers}
          tone="blue"
          index={1}
        />
        <EmployeeKpiCard
          label="Categories"
          value={isLoading ? '—' : uniqueCategories.length}
          icon={Tags}
          tone="violet"
          index={2}
        />
        <EmployeeKpiCard
          label="Last synced"
          value={lastSynced ? formatDistanceToNow(lastSynced.at, { addSuffix: true }) : 'Unknown'}
          hint={lastSynced ? `By ${lastSynced.source}` : 'No sync run recorded by either flow'}
          icon={Clock}
          tone={lastSynced ? 'emerald' : 'amber'}
          index={3}
        />
      </div>

      <HrFilterCard
        summary={
          filtersActive
            ? `${groups.length} employee(s) · ${rows.length} record(s) matching${
                filters.category !== 'all' ? ` · ${filters.category}` : ''
              }`
            : `${groups.length} employee(s) · ${rows.length} position record(s)`
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

      {/* ── View, and which columns of it ────────────────────────────────────────────────────
          A segmented switch rather than two screens: it is one register read two ways, and the
          filters, counts and export above apply to both. */}
      {!isLoading && !isDeleting && !loadError && groups.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-full border border-white/70 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm">
            {(
              [
                ['grouped', 'Grouped by employee', Users],
                ['columns', 'Column per category', Columns3],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setView(value)}
                aria-pressed={view === value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  view === value ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {view === 'columns' && (
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Showing each employee&apos;s value in force
              </span>
            )}
            <EmployeeColumnPicker
              columns={columnKeys}
              hidden={hidden}
              onChange={setHidden}
              locked={[EMPLOYEE_COLUMN]}
            />
          </div>
        </div>
      )}

      {isLoading || isDeleting ? (
        <HrLoader label={isDeleting ? 'Clearing records and resyncing…' : 'Loading position details…'} />
      ) : loadError ? (
        <Card className={EMP_CARD_CLASS}>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Layers className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" onClick={() => void fetchPositionsFromDb()}>Try again</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          <HrDataList
            rows={visibleGroups}
            columns={shownColumns}
            // Expansion belongs to the grouped view. In the column view the row already shows every
            // category, so a click that opened a history under it would be answering a question the
            // reader did not ask — and the pivot's own row is wide enough as it is.
            onRowClick={
              view === 'grouped'
                ? group => setOpenId(current => (current === group.id ? null : group.id))
                : undefined
            }
            expandedId={view === 'grouped' ? openId : null}
            renderExpanded={view === 'grouped' ? group => <PositionEntries entries={group.entries} /> : undefined}
            dense
            maxHeightClassName={EMP_REGISTER_HEIGHT}
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

          <EmployeeListFooter
            shown={visibleGroups.length}
            total={groups.length}
            noun="employee"
            pageSize={PAGE_SIZE}
            onMore={() => setVisibleCount(count => count + PAGE_SIZE)}
          />
        </div>
      )}
    </EmployeePageShell>
  );
}
