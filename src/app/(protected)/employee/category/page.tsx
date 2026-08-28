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
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Clock, Layers, Loader2, RefreshCw, Search, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AuroraBackdrop } from '@/components/effects/AuroraBackdrop';
import {
  HrAlertNotice,
  HrDataList,
  HrEmptyState,
  HrFilterCard,
  HrKpiCard,
  HrLoader,
  HrPageHeader,
  HrAccessDenied,
  type HrListColumn,
} from '@/components/hr/hr-ui';
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

/** One row of a type's table. `id` is the composite key `HrDataList` needs. */
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

const COLUMNS: Array<HrListColumn<CategoryRow>> = [
  {
    header: 'ID',
    cell: row => <span className="tabular-nums text-muted-foreground">{row.categoryId}</span>,
    className: 'w-24',
    mobile: 'aside',
  },
  {
    header: 'Name',
    cell: row => <span className="font-medium text-slate-800">{row.name}</span>,
    mobile: 'title',
  },
];

export default function ManageCategoryPage() {
  const { toast } = useToast();
  const { can, isLoading: isAuthLoading } = useAuthorization();
  const [categoriesByType, setCategoriesByType] = useState<Record<string, Category[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /**
   * Which accordions are open. Controlled rather than `defaultValue` so an active search can force
   * matching sections open — a match hidden inside a section the reader collapsed earlier looks
   * like no match at all.
   */
  const [openTypes, setOpenTypes] = useState<string[]>([]);
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

      const grouped = categoriesData.reduce((acc, category) => {
        const { type } = category;
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
      setOpenTypes(Object.keys(grouped));

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

  const syncButton = (
    <Button onClick={() => void handleSync()} disabled={isSyncing || !canSync} size="sm">
      {isSyncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
      Sync from GreytHR
    </Button>
  );

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
          <h1 className="text-xl font-semibold text-slate-800">Synced Categories</h1>
        </div>
        <HrAccessDenied what="the greytHR category master" />
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
        title="Synced Categories"
        description="Department, Designation, Grade, Location, Project and the other category masters mirrored from greytHR. Read-only here — greytHR owns the values."
        actions={syncButton}
      />

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <HrKpiCard label="Category types" value={isLoading ? '—' : types.length} icon={Layers} tone="indigo" />
        <HrKpiCard label="Values mirrored" value={isLoading ? '—' : totalValues} icon={Tags} tone="blue" />
        <HrKpiCard
          label="Last synced"
          value={lastSynced ? formatDistanceToNow(lastSynced.at, { addSuffix: true }) : 'Unknown'}
          hint={
            lastSynced
              ? lastSynced.successful
                ? 'Last successful greytHR sync run'
                : 'Last attempted run — it did not succeed'
              : 'No greytHR sync run recorded yet'
          }
          icon={Clock}
          tone={lastSynced?.successful ? 'emerald' : 'amber'}
        />
      </div>

      {/*
        Stated plainly because the old screen's single "Sync from GreytHR" button implied this data
        only moves when somebody presses it — which sent people hunting for a stale-data problem that
        the hourly sync had already fixed.
      */}
      <div className="mb-3">
        <HrAlertNotice tone="blue" title="Refreshed automatically">
          The hourly greytHR sync writes these categories itself, so the timestamp above is the honest
          age of this list. <strong>Sync from GreytHR</strong> is a top-up for when you cannot wait for
          the next run — not the only path.
        </HrAlertNotice>
      </div>

      {isLoading ? (
        <HrLoader label="Loading categories…" />
      ) : loadError ? (
        <Card className="border-white/60 bg-white/80 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Tags className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" onClick={() => void fetchCategories()}>Try again</Button>
          </CardContent>
        </Card>
      ) : types.length > 0 ? (
        <>
          <HrFilterCard
            summary={
              term
                ? `${matchCount} of ${totalValues} values match`
                : `${totalValues} values across ${types.length} types`
            }
            actions={
              term ? (
                <Button variant="ghost" size="sm" onClick={() => setSearch('')}>Clear</Button>
              ) : undefined
            }
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search category values…"
                className="pl-8"
                value={search}
                onChange={event => setSearch(event.target.value)}
              />
            </div>
          </HrFilterCard>

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
            <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
              <CardContent className="p-2 sm:p-3">
                <Accordion
                  type="multiple"
                  value={term ? matchingTypes : openTypes}
                  onValueChange={value => {
                    if (!term) setOpenTypes(value);
                  }}
                >
                  {(term ? matchingTypes : types).map(type => (
                    <AccordionItem value={type} key={type} className="border-slate-100 last:border-0">
                      <AccordionTrigger className="px-1.5 py-3 text-sm font-semibold text-slate-800 hover:no-underline">
                        <span className="flex items-center gap-2">
                          {type}
                          <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-[10px] text-indigo-700">
                            {term
                              ? `${(visibleRowsByType[type] ?? []).length} of ${categoriesByType[type].length}`
                              : categoriesByType[type].length}
                          </Badge>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="px-1.5 pb-3">
                        <HrDataList
                          rows={visibleRowsByType[type] ?? []}
                          columns={COLUMNS}
                          tableClassName="w-auto"
                          fitContent
                          empty={<HrEmptyState icon={Tags} title="No values in this category" />}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <HrEmptyState
          icon={Tags}
          title="No categories mirrored yet"
          description="The hourly greytHR sync writes these on every run. If it has never run here, sync now to get started."
          action={canSync ? syncButton : undefined}
        />
      )}
    </div>
  );
}
