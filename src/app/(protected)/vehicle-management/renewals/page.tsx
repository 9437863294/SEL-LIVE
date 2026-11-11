'use client';

import Link from 'next/link';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, AlertTriangle, CheckCircle2, History, RefreshCw, Search, Timer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';
import { VM_PRIMARY_BUTTON, VM_SEGMENT_TRACK, VM_TONES, vmSegmentItem } from '@/components/vehicle-management/vm-ui';
import {
  VM_PANEL,
  VM_SELECTED_RING,
  VM_TINT,
  VmAlertStrip,
  VmIconTile,
  VmPageHero,
  VmSectionLabel,
  VmSyncStatus,
  type VmAlertTile,
} from '@/components/vehicle-management/vm-dashboard';
import {
  RENEWAL_SOURCES,
  formatExpiry,
  sortRenewalItems,
  toRenewalItem,
  type RenewalItem,
  type RenewalSource,
} from '@/components/vehicle-management/renewal-items';

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

/** `week` is the due-soon items with seven days or fewer left — the ones to renew first. */
type StatusFilter = 'all' | 'expired' | 'dueSoon' | 'week';
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'expired', 'dueSoon', 'week'];

/** `?status=` as a filter; anything unknown is All. The overview's alert tiles link here with it. */
const parseStatus = (value: string | null): StatusFilter =>
  STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : 'all';

const matchesStatus = (item: RenewalItem, status: StatusFilter) =>
  status === 'all' || (status === 'week' ? item.kind === 'dueSoon' && item.daysLeft <= 7 : item.kind === status);

const STATUS_STRIPE: Record<RenewalItem['kind'], string> = {
  expired: 'bg-rose-500',
  dueSoon: 'bg-amber-500',
  valid: 'bg-emerald-500',
};

const GROUP_LABEL: Record<RenewalItem['kind'], { label: string; ink: string }> = {
  expired: { label: 'Expired', ink: 'text-rose-600 dark:text-rose-400' },
  dueSoon: { label: 'Due in the next 30 days', ink: 'text-amber-600 dark:text-amber-400' },
  valid: { label: 'Valid', ink: 'text-emerald-600 dark:text-emerald-400' },
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

/** How urgent one item is, in words: "Expired 12d ago", "Due today", "5d left". */
function UrgencyPill({ item }: { item: RenewalItem }) {
  const expired = item.kind === 'expired';
  const Icon = expired ? AlertTriangle : Timer;
  const label = expired
    ? `Expired ${Math.abs(item.daysLeft)}d ago`
    : item.daysLeft === 0
      ? 'Due today'
      : item.daysLeft === 1
        ? 'Due tomorrow'
        : `${item.daysLeft}d left`;
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-bold tabular-nums',
        VM_TINT[expired ? 'rose' : 'amber'],
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

function CategoryLabel({ item }: { item: RenewalItem }) {
  const Icon = item.categoryIcon;
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', VM_TONES[item.tone].text)} aria-hidden />
      {item.category}
    </span>
  );
}

function RowActions({ item, className }: { item: RenewalItem; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-1.5', className)}>
      <Button asChild size="sm" className={cn('h-8 gap-1.5 px-3 text-xs', VM_PRIMARY_BUTTON)}>
        <Link href={item.href}>
          <RefreshCw className="h-3 w-3" aria-hidden />
          Renew
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 px-3 text-xs">
        <Link href={item.historyHref} title={`${item.category} history`}>
          <History className="h-3 w-3" aria-hidden />
          History
        </Link>
      </Button>
    </div>
  );
}

type CategoryStat = { source: RenewalSource; expired: number; dueSoon: number; total: number };

/** One category's open renewals; choosing it filters the queue. A category with none is just "All clear". */
function CategoryCard({ stat, selected, onSelect }: { stat: CategoryStat; selected: boolean; onSelect: () => void }) {
  const { source, expired, dueSoon, total } = stat;
  const clear = total === 0;
  const content = (
    <>
      <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <VmIconTile icon={source.icon} tint={source.tone} />
        <span className="truncate">{source.category}</span>
      </span>
      {clear ? (
        <span className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          All clear
        </span>
      ) : (
        <>
          <span className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold leading-8 tracking-tight tabular-nums">{total}</span>
            <span className="truncate text-xs text-muted-foreground">to renew</span>
          </span>
          <span className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] font-semibold">
            {expired > 0 && <span className={cn('rounded-full px-2 py-0.5 tabular-nums', VM_TINT.rose)}>{expired} expired</span>}
            {dueSoon > 0 && <span className={cn('rounded-full px-2 py-0.5 tabular-nums', VM_TINT.amber)}>{dueSoon} due</span>}
          </span>
          <span className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <i className="block h-full bg-rose-500" style={{ width: `${(expired / total) * 100}%` }} />
            <i className="block h-full bg-amber-500" style={{ width: `${(dueSoon / total) * 100}%` }} />
          </span>
        </>
      )}
    </>
  );
  const frame = cn(VM_PANEL, 'flex min-w-0 flex-col p-4 text-left', selected && VM_SELECTED_RING);
  if (clear && !selected) return <div className={cn(frame, 'opacity-80')}>{content}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(frame, 'transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
    >
      {content}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function RenewalsHub() {
  const searchParams = useSearchParams();
  const { can } = useAuthorization();
  const [items, setItems] = useState<RenewalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [query, setQuery] = useState('');
  // The overview's alert tiles open this page already filtered (`?status=expired`).
  const [status, setStatus] = useState<StatusFilter>(() => parseStatus(searchParams.get('status')));
  const [category, setCategory] = useState<string>(() => searchParams.get('category') || 'All');
  const isMountedRef = useRef(true);
  const isSyncingRef = useRef(false);

  const canViewSource = useCallback(
    (permission: string) =>
      can('View', `Vehicle Management.${permission}`) ||
      can('Add', `Vehicle Management.${permission}`) ||
      can('Edit', `Vehicle Management.${permission}`),
    [can],
  );

  const load = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsRefreshing(true);
    try {
      const collected: RenewalItem[] = [];
      let failureCount = 0;

      // Needed to skip categories that don't even apply to a vehicle (e.g. insurance/PUC/
      // fitness/road tax/permit for a Sold/Scrapped vehicle, or a manual "not required" flag).
      let vehicleMap: Record<string, Record<string, any>> = {};
      try {
        const vehicleSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        vehicleMap = Object.fromEntries(vehicleSnap.docs.map((entry) => [entry.id, entry.data()]));
      } catch (err) {
        console.error('Renewals: failed to load vehicles for requirement filtering', err);
      }

      await Promise.all(
        RENEWAL_SOURCES.map(async (source) => {
          if (!canViewSource(source.permission)) return;
          try {
            const snap = await getDocs(collection(db, source.collection));
            snap.docs.forEach((entry) => {
              const item = toRenewalItem(source, entry.id, entry.data() as Record<string, any>, vehicleMap);
              if (item) collected.push(item);
            });
          } catch (err) {
            console.error(`Renewals: failed to fetch ${source.collection}`, err);
            failureCount += 1;
          }
        }),
      );

      sortRenewalItems(collected);
      if (!isMountedRef.current) return;
      setItems(collected);
      setFailures(failureCount);
      setLastUpdated(new Date());
      setIsLoading(false);
    } finally {
      isSyncingRef.current = false;
      if (isMountedRef.current) setIsRefreshing(false);
    }
  }, [canViewSource]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();
    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  // ── Whole-fleet figures, for the alert strip and the category cards.
  const expired = useMemo(() => items.filter((item) => item.kind === 'expired'), [items]);
  const dueSoon = useMemo(() => items.filter((item) => item.kind === 'dueSoon'), [items]);
  const dueThisWeek = useMemo(() => dueSoon.filter((item) => item.daysLeft <= 7), [dueSoon]);
  const oldestLapse = expired.reduce((max, item) => Math.max(max, Math.abs(item.daysLeft)), 0);
  const nextDue = dueSoon.length > 0 ? Math.min(...dueSoon.map((item) => item.daysLeft)) : null;

  const categoryStats = useMemo<CategoryStat[]>(
    () =>
      RENEWAL_SOURCES.filter((source) => canViewSource(source.permission)).map((source) => {
        const mine = items.filter((item) => item.category === source.category);
        const expiredHere = mine.filter((item) => item.kind === 'expired').length;
        return { source, expired: expiredHere, dueSoon: mine.length - expiredHere, total: mine.length };
      }),
    [items, canViewSource],
  );

  // ── The queue: category and search narrow it first, so the status tabs count what is left.
  const scoped = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(
      (item) =>
        (category === 'All' || item.category === category) &&
        (!term ||
          item.vehicleOrDriver.toLowerCase().includes(term) ||
          item.category.toLowerCase().includes(term) ||
          item.details.toLowerCase().includes(term)),
    );
  }, [items, category, query]);
  const filteredItems = useMemo(() => scoped.filter((item) => matchesStatus(item, status)), [scoped, status]);
  const pagination = useVehicleTablePagination(filteredItems);
  const groupCounts = useMemo(
    () => ({
      expired: filteredItems.filter((item) => item.kind === 'expired').length,
      dueSoon: filteredItems.filter((item) => item.kind === 'dueSoon').length,
      valid: 0,
    }),
    [filteredItems],
  );

  const statusTabs: Array<{ key: StatusFilter; label: string; count: number; ink?: string }> = [
    { key: 'all', label: 'All', count: scoped.length },
    { key: 'expired', label: 'Expired', count: scoped.filter((item) => matchesStatus(item, 'expired')).length, ink: 'text-rose-600 dark:text-rose-400' },
    { key: 'dueSoon', label: 'Due soon', count: scoped.filter((item) => matchesStatus(item, 'dueSoon')).length, ink: 'text-amber-600 dark:text-amber-400' },
    { key: 'week', label: 'This week', count: scoped.filter((item) => matchesStatus(item, 'week')).length, ink: 'text-orange-600 dark:text-orange-400' },
  ];

  const toggleStatus = (next: StatusFilter) => setStatus((current) => (current === next ? 'all' : next));
  const filtersActive = status !== 'all' || category !== 'All' || query.trim() !== '';
  const clearFilters = () => {
    setQuery('');
    setStatus('all');
    setCategory('All');
  };

  const count = (value: number) => (isLoading ? '…' : value);
  const alertTiles: VmAlertTile[] = [
    {
      key: 'expired',
      count: count(expired.length),
      title: 'Expired',
      hint: expired.length > 0 ? `Oldest lapsed ${plural(oldestLapse, 'day')} ago` : 'Nothing has lapsed',
      tint: !isLoading && expired.length > 0 ? 'rose' : 'slate',
      onSelect: () => toggleStatus('expired'),
      selected: status === 'expired',
    },
    {
      key: 'dueSoon',
      count: count(dueSoon.length),
      title: 'Due in 30 days',
      hint: nextDue === null ? 'Nothing due this month' : nextDue === 0 ? 'Next one is due today' : `Next one in ${plural(nextDue, 'day')}`,
      tint: !isLoading && dueSoon.length > 0 ? 'amber' : 'slate',
      onSelect: () => toggleStatus('dueSoon'),
      selected: status === 'dueSoon',
    },
    {
      key: 'week',
      count: count(dueThisWeek.length),
      title: 'Due this week',
      hint: dueThisWeek.length > 0 ? 'Renew these first' : 'Nothing due in the next 7 days',
      tint: !isLoading && dueThisWeek.length > 0 ? 'orange' : 'slate',
      onSelect: () => toggleStatus('week'),
      selected: status === 'week',
    },
  ];

  const emptyMessage =
    items.length === 0
      ? categoryStats.length === 0
        ? 'You do not have access to any compliance registers.'
        : 'Nothing has expired and nothing is due in the next 30 days.'
      : 'No items match your current filters.';

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      <VmPageHero
        icon={RefreshCw}
        title="Renewals Hub"
        description="Every expired and due-soon compliance item across the fleet, most urgent first."
        status={<VmSyncStatus isLoading={isLoading} partial={failures > 0} updatedAt={lastUpdated} />}
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5 font-semibold">
              <Link href="/vehicle-management/vehicle-health">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Vehicle health
              </Link>
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={isRefreshing} className="shrink-0 gap-1.5 font-semibold" aria-label="Refresh renewals">
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} aria-hidden />
              Refresh
            </Button>
          </>
        }
      >
        <VmAlertStrip tiles={alertTiles} />
      </VmPageHero>

      {/* Where the work is: one card per register, each a filter for the queue below. */}
      {categoryStats.length > 0 && (
        <section aria-labelledby="rh-category-heading" className="space-y-2">
          <VmSectionLabel id="rh-category-heading">By category</VmSectionLabel>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {categoryStats.map((stat) => (
                <Skeleton key={stat.source.category} className="h-[120px] rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {categoryStats.map((stat) => (
                <CategoryCard
                  key={stat.source.category}
                  stat={stat}
                  selected={category === stat.source.category}
                  onSelect={() => setCategory((current) => (current === stat.source.category ? 'All' : stat.source.category))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* The queue. */}
      <section aria-labelledby="rh-queue-heading" className={cn(VM_PANEL, 'min-w-0 overflow-hidden')}>
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3.5 sm:px-[18px]">
          <div className="min-w-0 flex-1 basis-64">
            <h2 id="rh-queue-heading" className="text-[15px] font-bold">Renewal queue</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">Expired first, then by days left. Due soon means it expires within 30 days.</p>
          </div>
          <div role="group" aria-label="Filter by status" className={cn(VM_SEGMENT_TRACK, 'w-full sm:w-auto')}>
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={status === tab.key}
                onClick={() => setStatus(tab.key)}
                className={cn(vmSegmentItem(status === tab.key), 'flex-1 sm:flex-none')}
              >
                {tab.label}
                {/* The chosen tab sits on the accent, so its count takes the tab's own ink. */}
                <span className={cn('tabular-nums', status === tab.key ? 'opacity-90' : tab.ink ?? 'opacity-70')}>{count(tab.count)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Search, the chosen category, and a way back to everything. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5 sm:px-[18px]">
          <label className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
            <span className="sr-only">Search renewals</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vehicle, driver, reference…"
              className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {category !== 'All' && (
            <button
              type="button"
              onClick={() => setCategory('All')}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold"
              aria-label={`Remove the ${category} filter`}
            >
              {category}
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
          {filtersActive && (
            <button type="button" onClick={clearFilters} className="h-8 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {isLoading ? '' : filteredItems.length === items.length ? plural(items.length, 'item') : `${filteredItems.length} of ${plural(items.length, 'item')}`}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2.5 p-4">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
            <span className={cn('grid h-12 w-12 place-items-center rounded-2xl', VM_TINT.emerald)}>
              <CheckCircle2 className="h-6 w-6" aria-hidden />
            </span>
            <p className="text-base font-bold">All clear</p>
            <p className="max-w-sm text-sm text-muted-foreground">{emptyMessage}</p>
            {filtersActive && items.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={clearFilters} className="mt-1">
                Show everything
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop: a table, grouped into Expired and Due under a header row each. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-muted/50 text-left text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    <th className="border-b border-border py-2.5 pl-5 pr-3.5 font-bold">Vehicle / driver</th>
                    <th className="border-b border-border px-3.5 py-2.5 font-bold">Category</th>
                    <th className="border-b border-border px-3.5 py-2.5 font-bold">Reference</th>
                    <th className="border-b border-border px-3.5 py-2.5 font-bold">Expiry date</th>
                    <th className="border-b border-border px-3.5 py-2.5 font-bold">Status</th>
                    <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagination.paginatedRows.map((item, index, rows) => (
                    <Fragment key={item.id}>
                      {(index === 0 || rows[index - 1].kind !== item.kind) && (
                        <tr>
                          <td colSpan={6} className={cn('border-b border-border/60 bg-muted/25 py-1.5 pl-5 pr-3.5 text-[11px] font-extrabold uppercase tracking-[0.08em]', GROUP_LABEL[item.kind].ink)}>
                            {GROUP_LABEL[item.kind].label} · {groupCounts[item.kind]}
                          </td>
                        </tr>
                      )}
                      <tr className="transition-colors hover:bg-muted/40">
                        <td className="relative border-b border-border/60 py-3 pl-5 pr-3.5">
                          <span className={cn('absolute inset-y-0 left-0 w-[3px]', STATUS_STRIPE[item.kind])} aria-hidden />
                          <span className="font-bold text-foreground">{item.vehicleOrDriver}</span>
                        </td>
                        <td className="border-b border-border/60 px-3.5 py-3">
                          <CategoryLabel item={item} />
                        </td>
                        <td className="border-b border-border/60 px-3.5 py-3 text-muted-foreground">{item.details}</td>
                        <td className="border-b border-border/60 px-3.5 py-3 tabular-nums">{formatExpiry(item.expiryDate)}</td>
                        <td className="border-b border-border/60 px-3.5 py-3">
                          <UrgencyPill item={item} />
                        </td>
                        <td className="border-b border-border/60 px-3.5 py-2">
                          <RowActions item={item} />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone: one card per item, the same groups, the actions a full-width row. */}
            <ul className="space-y-2.5 p-3 sm:hidden">
              {pagination.paginatedRows.map((item, index, rows) => (
                <Fragment key={item.id}>
                  {(index === 0 || rows[index - 1].kind !== item.kind) && (
                    <li className={cn('px-1 pt-1 text-[11px] font-extrabold uppercase tracking-[0.08em]', GROUP_LABEL[item.kind].ink)}>
                      {GROUP_LABEL[item.kind].label} · {groupCounts[item.kind]}
                    </li>
                  )}
                  <li className="relative overflow-hidden rounded-xl border border-border bg-card p-3 pl-4">
                    <span className={cn('absolute inset-y-0 left-0 w-[3px]', STATUS_STRIPE[item.kind])} aria-hidden />
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-bold">{item.vehicleOrDriver}</span>
                      <UrgencyPill item={item} />
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
                      <CategoryLabel item={item} />
                      {item.details !== '—' && <span className="min-w-0 truncate text-muted-foreground">· {item.details}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {item.kind === 'expired' ? 'Expired' : 'Expires'} <span className="tabular-nums">{formatExpiry(item.expiryDate)}</span>
                    </div>
                    <RowActions item={item} className="mt-3 [&>a]:h-11 [&>a]:flex-1" />
                  </li>
                </Fragment>
              ))}
            </ul>

            <div className="border-t border-border px-4 py-3 sm:px-[18px]">
              <VehicleTablePagination
                currentPage={pagination.currentPage}
                totalPages={pagination.totalPages}
                totalRows={filteredItems.length}
                pageSize={pagination.pageSize}
                onPageChange={pagination.setCurrentPage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// `useSearchParams` reads the URL, so the page renders inside a Suspense boundary — without one a
// prerendered route fails the production build (Next's missing-suspense-with-csr-bailout).
export default function RenewalsHubPage() {
  return (
    <Suspense fallback={<Skeleton className="h-40 w-full rounded-2xl" />}>
      <RenewalsHub />
    </Suspense>
  );
}
