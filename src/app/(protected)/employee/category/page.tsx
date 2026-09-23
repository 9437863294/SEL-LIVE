'use client';

/**
 * The greytHR category master — Department, Designation, Grade, Location, Project and the rest.
 *
 * Read-only by design: greytHR owns these values, this screen only shows what has been mirrored into
 * the `categories` collection. The important thing a reader needs and the old screen never told them
 * is *how old* that mirror is, which is why the header carries a timestamp taken from
 * `settings/greythrSync`: the hourly unified sync writes this collection on every run, so its
 * last-successful-run stamp is the honest answer to "is this current". The manual button below is a
 * top-up for when you cannot wait for the next tick — not the only way these rows get refreshed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, Clock, Loader2, RefreshCw, Search, Tags, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  HrEmptyState,
  HrLoader,
  HrAccessDenied,
} from '@/components/hr/hr-ui';
import { cn } from '@/lib/utils';
import {
  EmployeeHeader,
  EmployeePageShell,
  EmployeeStatusPill,
  EmployeeSubNav,
  EMP_CARD_CLASS,
} from '@/components/employee/employee-ui';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { syncGreytHRCategories } from '@/ai';
import { useAuthorization } from '@/hooks/useAuthorization';

interface Category {
  id: number;
  name: string;
  type: string;
}

/** One value of a category type. */
type CategoryRow = { id: string; categoryId: number; name: string };

/**
 * Firestore timestamps arrive here as ISO strings today (the sync writes `run.startedAt`), but a
 * `Timestamp` from an older document would otherwise render as `Invalid Date`, so both are handled.
 */
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

export default function ManageCategoryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [categoriesByType, setCategoriesByType] = useState<Record<string, Category[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Which type's values are on the right. Falls back to the first available — see the effect below. */
  const [selectedType, setSelectedType] = useState<string>('');
  /** When the mirror was last written, and by which flow — see the file header. */
  const [lastSynced, setLastSynced] = useState<{ at: Date; successful: boolean } | null>(null);

  const canView = can('View', 'Settings.Employee Management');
  const canSync = can('Sync from GreytHR', 'Settings.Employee Management');

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const q = query(collection(db, 'categories'), orderBy('type'));
      const [querySnapshot, syncDoc] = await Promise.all([
        getDocs(q),
        // Read separately from the rows so a missing/unreadable settings doc costs a timestamp, not
        // the whole page.
        getDoc(doc(db, 'settings', 'greythrSync')).catch(() => null),
      ]);
      const categoriesData = querySnapshot.docs.map(document => document.data() as Category);

      /**
       * Grouped by type, and deduplicated by type + id on the way in.
       *
       * Two documents can describe the same value: the manual sync wrote auto-generated ids until
       * it was aligned with the hourly one, so a collection touched by both held `Designation 47`
       * twice. The screen should not list "Site Engineer" twice, the counts above it should not
       * count it twice, and the row key below is `type-id` — which React saw duplicated. The
       * writers converge the stored documents on their next run; this keeps the screen honest
       * against whatever is in the collection right now.
       */
      const seen = new Set<string>();
      const grouped = categoriesData.reduce((acc, category) => {
        const { type } = category;
        const key = `${type}::${category.id}`;
        if (seen.has(key)) return acc;
        seen.add(key);
        if (!acc[type]) {
          acc[type] = [];
        }
        acc[type].push(category);
        return acc;
      }, {} as Record<string, Category[]>);

      // Sort the items within each group by name
      for (const type in grouped) {
        grouped[type].sort((a, b) => a.name.localeCompare(b.name));
      }

      setCategoriesByType(grouped);

      if (syncDoc?.exists()) {
        const data = syncDoc.data();
        const successful = toDate(data.lastSuccessfulRunAt);
        const attempted = toDate(data.lastRunAt);
        // A successful run is what actually wrote these rows; `lastRunAt` only says something was
        // attempted, so it is labelled differently rather than passed off as a refresh.
        if (successful) setLastSynced({ at: successful, successful: true });
        else if (attempted) setLastSynced({ at: attempted, successful: false });
        else setLastSynced(null);
      }
    } catch (error: any) {
      console.error('Error fetching categories: ', error);
      // On-page rather than a toast: a toast disappears, and what is left behind is an empty screen
      // that reads as "no categories mirrored" — the opposite of what happened.
      setLoadError(
        error.code === 'failed-precondition'
          ? 'The query requires a Firestore index. Check the Firebase console for instructions on how to create it.'
          : error?.message || 'Failed to fetch categories.',
      );
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (isAuthLoading) return;
    if (canView) {
      void fetchCategories();
    } else {
      setIsLoading(false);
    }
  }, [isAuthLoading, canView, fetchCategories]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const result = await syncGreytHRCategories();
      if (result.success) {
        const countSummary = Object.entries(result.counts)
          .map(([key, value]) => `${value} ${key}s`)
          .join(', ');
        toast({
          title: 'Sync Successful',
          description: `Synced: ${countSummary || 'No new data.'}`,
        });
        void fetchCategories(); // Refresh the list
      } else {
        throw new Error(result.message);
      }
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const types = useMemo(() => Object.keys(categoriesByType), [categoriesByType]);
  const totalValues = useMemo(
    () => Object.values(categoriesByType).reduce((sum, list) => sum + list.length, 0),
    [categoriesByType],
  );

  const rowsByType = useMemo(() => {
    const map: Record<string, CategoryRow[]> = {};
    for (const [type, list] of Object.entries(categoriesByType)) {
      map[type] = list.map(item => ({ id: `${type}-${item.id}`, categoryId: item.id, name: item.name }));
    }
    return map;
  }, [categoriesByType]);

  const term = search.trim().toLowerCase();

  // A term that names a type (e.g. "grade") keeps that type's whole list; otherwise it narrows to
  // the values (or ids) that match.
  const visibleRowsByType = useMemo(() => {
    if (!term) return rowsByType;
    const map: Record<string, CategoryRow[]> = {};
    for (const [type, list] of Object.entries(rowsByType)) {
      map[type] = type.toLowerCase().includes(term)
        ? list
        : list.filter(row => row.name.toLowerCase().includes(term) || String(row.categoryId).includes(term));
    }
    return map;
  }, [rowsByType, term]);

  const matchingTypes = useMemo(
    () => types.filter(type => (visibleRowsByType[type] ?? []).length > 0),
    [types, visibleRowsByType],
  );
  const matchCount = useMemo(
    () => matchingTypes.reduce((sum, type) => sum + (visibleRowsByType[type] ?? []).length, 0),
    [matchingTypes, visibleRowsByType],
  );

  /**
   * The types the rail offers: everything, or only those with a match while searching.
   *
   * Narrowing the rail rather than only the values is what makes the search answer "which category
   * is this value in" — the question somebody searching a master list usually has.
   */
  const railTypes = term ? matchingTypes : types;

  /**
   * Hold the selection somewhere real.
   *
   * A type that has just been filtered out of the rail must not stay selected, or the right pane
   * shows values for a type the reader can no longer see. Falls forward to the first type that does
   * match, which is also what makes a search land on its own first result.
   */
  useEffect(() => {
    if (!railTypes.length) {
      if (selectedType) setSelectedType('');
      return;
    }
    if (!railTypes.includes(selectedType)) setSelectedType(railTypes[0]);
  }, [railTypes, selectedType]);

  const selectedValues = visibleRowsByType[selectedType] ?? [];
  const selectedTotal = categoriesByType[selectedType]?.length ?? 0;

  const syncButton = (
    <Button onClick={() => void handleSync()} disabled={isSyncing || !canSync} size="sm">
      {isSyncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
      Sync from GreytHR
    </Button>
  );

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
          icon={Tags}
          tone="teal"
          eyebrow="Employee management"
          title="Synced Categories"
          backHref="/employee"
          backLabel="Back to Employee Management"
        />
        <HrAccessDenied what="the greytHR category master" />
      </EmployeePageShell>
    );
  }

  return (
    <EmployeePageShell>
      <EmployeeHeader
        icon={Tags}
        tone="teal"
        eyebrow="Employee management"
        title="Synced Categories"
        backHref="/employee"
        backLabel="Back to Employee Management"
        description="Department, Designation, Grade, Location, Project and the other category masters mirrored from greytHR. Read-only here — greytHR owns the values."
        status={
          lastSynced ? (
            <EmployeeStatusPill tone={lastSynced.successful ? 'emerald' : 'amber'} icon={Clock}>
              {lastSynced.successful ? 'Synced' : 'Last attempt'} {formatDistanceToNow(lastSynced.at, { addSuffix: true })}
            </EmployeeStatusPill>
          ) : (
            <EmployeeStatusPill tone="slate" icon={Clock}>
              No sync run recorded
            </EmployeeStatusPill>
          )
        }
        meta={
          /* Was a whole blue callout band. The point it makes — that this list maintains itself —
             belongs next to the timestamp it qualifies, not in a panel of its own. */
          lastSynced
            ? 'The hourly greytHR sync rewrites these values on every run, so that timestamp is the honest age of this list. Sync from GreytHR is a top-up, not the only path.'
            : 'The hourly greytHR sync writes these values on every run.'
        }
        actions={syncButton}
      />

      <EmployeeSubNav current="category" />

      {/*
        No KPI row here, deliberately.

        "Category types: 11" and "Values mirrored: 312" are the two figures this screen would have
        put in cards, and both are visible in the rail below — every type with its own count, which
        is more useful than their total. The freshness stamp moved to the header's status pill, where
        the other screens in the module carry theirs. That is a third of the page's height returned
        to the thing it is for.
      */}

      {isLoading ? (
        <HrLoader label="Loading categories…" />
      ) : loadError ? (
        <Card className={EMP_CARD_CLASS}>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Tags className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" onClick={() => void fetchCategories()}>Try again</Button>
          </CardContent>
        </Card>
      ) : types.length === 0 ? (
        <HrEmptyState
          icon={Tags}
          title="No categories mirrored yet"
          description="The hourly greytHR sync writes these on every run. If it has never run here, sync now to get started."
          action={canSync ? syncButton : undefined}
        />
      ) : (
        <>
          {/* ── Search ──────────────────────────────────────────────────────────────────────────
              A bare input rather than the collapsible filter card the registers use: one control
              does not need a panel with a header and a summary line around it. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search any value, id or type…"
                className="bg-white/80 pl-8 pr-8"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="hr-inline-action absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {term ? (
                <>
                  <span className="font-medium text-slate-700">{matchCount}</span> value
                  {matchCount === 1 ? '' : 's'} in {matchingTypes.length} type
                  {matchingTypes.length === 1 ? '' : 's'}
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-700">{totalValues}</span> values across{' '}
                  {types.length} types
                </>
              )}
            </p>
          </div>

          {term && matchingTypes.length === 0 ? (
            <HrEmptyState
              icon={Tags}
              title="No category values match"
              description="Try a different name, id or category type."
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>Clear search</Button>
              }
            />
          ) : (
            /* ── Master / detail ────────────────────────────────────────────────────────────────
               The types are the master list and stay on screen, because "which types exist" is the
               first question a master screen should answer. On a phone the rail becomes a scrolling
               pill strip above the values — a 14rem sidebar on a 390px screen leaves no room for
               what it is pointing at. */
            <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
              <Card className={cn('overflow-hidden rounded-2xl p-1.5', EMP_CARD_CLASS)}>
                <nav
                  aria-label="Category types"
                  className="flex gap-1 overflow-x-auto pb-0.5 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {railTypes.map(type => {
                    const isActive = type === selectedType;
                    const shown = (visibleRowsByType[type] ?? []).length;
                    const all = categoriesByType[type]?.length ?? 0;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedType(type)}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          'group flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors lg:w-full',
                          isActive
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{type}</span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                            isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600',
                          )}
                        >
                          {/* While searching, how many of the type's values matched — not its size. */}
                          {term ? `${shown}/${all}` : all}
                        </span>
                        <ChevronRight
                          className={cn(
                            'hidden h-3.5 w-3.5 shrink-0 lg:block',
                            isActive ? 'text-white/70' : 'text-slate-300 group-hover:text-slate-400',
                          )}
                        />
                      </button>
                    );
                  })}
                </nav>
              </Card>

              <Card className={cn('min-w-0 rounded-2xl', EMP_CARD_CLASS)}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-teal-600" />
                    <h2 className="text-sm font-semibold text-slate-800">{selectedType || 'Select a type'}</h2>
                    <Badge variant="outline" className="border-teal-200 bg-teal-50 text-[10px] text-teal-700">
                      {term ? `${selectedValues.length} of ${selectedTotal}` : `${selectedTotal} values`}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">Read-only — greytHR owns these values</p>
                </div>

                {selectedValues.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {term ? 'No value in this type matches your search.' : 'This type has no values mirrored.'}
                  </p>
                ) : (
                  /* Wrapped across columns rather than one row per value: a list of sixty
                     designations was sixty table rows to scroll, and the only thing each row carried
                     was a name and an id. */
                  <ul className="grid gap-x-4 gap-y-0.5 p-2 sm:grid-cols-2 xl:grid-cols-3">
                    {selectedValues.map(row => (
                      <li
                        key={row.id}
                        className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                      >
                        <span className="min-w-0 break-words text-sm text-slate-800">{row.name}</span>
                        {/* The id is what greytHR keys on, so it stays available — quietly, because
                            nobody reads a master list to find out that Designation 41 is 41. */}
                        <span className="shrink-0 text-[10px] tabular-nums text-slate-400">#{row.categoryId}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </EmployeePageShell>
  );
}
