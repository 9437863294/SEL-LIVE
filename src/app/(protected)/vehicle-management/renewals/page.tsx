'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { DataList } from '@/components/shared/data-list';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, CheckCircle2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';
import { VM_SEGMENT_TRACK, vmSegmentItem } from '@/components/vehicle-management/vm-ui';
import {
  RENEWAL_SOURCES,
  renewalColumns,
  sortRenewalItems,
  toRenewalItem,
  type RenewalItem,
} from '@/components/vehicle-management/renewal-items';

// ─────────────────────────────────────────────────────────────────────────────
// Filter tabs
// ─────────────────────────────────────────────────────────────────────────────
type FilterTab = 'all' | 'expired' | 'dueSoon';

// The full register: reference and History link included.
const columns = renewalColumns();

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function RenewalsHubPage() {
  const { can } = useAuthorization();
  const [items, setItems] = useState<RenewalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  const canViewSource = (permission: string) => {
    return (
      can('View', `Vehicle Management.${permission}`) ||
      can('Add', `Vehicle Management.${permission}`) ||
      can('Edit', `Vehicle Management.${permission}`)
    );
  };

  const load = async () => {
    setIsLoading(true);
    const collected: RenewalItem[] = [];

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
        }
      })
    );

    sortRenewalItems(collected);

    setItems(collected);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expired = useMemo(() => items.filter((i) => i.kind === 'expired'), [items]);
  const dueSoon = useMemo(() => items.filter((i) => i.kind === 'dueSoon'), [items]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(items.map((i) => i.category)));
    return ['All', ...cats.sort()];
  }, [items]);

  const filteredItems = useMemo(() => {
    let base = items;
    if (filter === 'expired') base = expired;
    if (filter === 'dueSoon') base = dueSoon;
    if (categoryFilter !== 'All') base = base.filter((i) => i.category === categoryFilter);
    const term = query.trim().toLowerCase();
    if (!term) return base;
    return base.filter(
      (i) =>
        i.vehicleOrDriver.toLowerCase().includes(term) ||
        i.category.toLowerCase().includes(term) ||
        i.details.toLowerCase().includes(term)
    );
  }, [items, filter, dueSoon, expired, categoryFilter, query]);
  const renewalPagination = useVehicleTablePagination(filteredItems);

  const filterTabs: Array<{ key: FilterTab; label: string; count: number }> = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'expired', label: 'Expired', count: expired.length },
    { key: 'dueSoon', label: 'Due Soon', count: dueSoon.length },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ── Header: the counts ride in the header's meta line, not a row of cards ── */}
      <PageHeader
        title="Renewals Hub"
        description="Every expired and due-soon compliance item across the fleet, most urgent first."
        className="mb-0 sm:mb-0"
        meta={[
          { label: 'Expired', value: <span className="text-rose-600">{isLoading ? '…' : expired.length}</span> },
          { label: 'Due in 30 days', value: <span className="text-amber-600">{isLoading ? '…' : dueSoon.length}</span> },
          { label: 'Total', value: isLoading ? '…' : items.length },
        ]}
        actions={
          <>
            <Button asChild variant="outline" className="gap-1.5">
              <Link href="/vehicle-management/vehicle-health">
                <Activity className="h-4 w-4" />
                Health Dashboard
              </Link>
            </Button>
            <Button variant="outline" onClick={load} disabled={isLoading} className="gap-2">
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </>
        }
      />

      {/* ── Register ── */}
      <TableCard
        title="Renewal Queue"
        description="Expired items first, then by days left. Due soon means it expires within 30 days."
        count={filteredItems.length}
        total={items.length}
        noun="item"
        scroll="natural"
        actions={
          <div className={VM_SEGMENT_TRACK} role="group" aria-label="Filter by status">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                aria-pressed={filter === tab.key}
                className={cn(vmSegmentItem(filter === tab.key), 'min-h-8')}
              >
                {tab.label}
                {/* The chosen tab sits on the accent, so its count takes the tab's own ink; the
                    others hint at their status colour. */}
                <span
                  className={cn(
                    'tabular-nums',
                    filter === tab.key ? 'opacity-90' : tab.key === 'expired' ? 'text-rose-600' : tab.key === 'dueSoon' ? 'text-amber-600' : 'opacity-70'
                  )}
                >
                  {isLoading ? '…' : tab.count}
                </span>
              </button>
            ))}
          </div>
        }
        toolbar={
          <FilterBar
            search={{ value: query, onChange: setQuery, placeholder: 'Search vehicle, driver, reference...' }}
            activeCount={(filter !== 'all' ? 1 : 0) + (categoryFilter !== 'All' ? 1 : 0)}
            onClear={() => { setQuery(''); setFilter('all'); setCategoryFilter('All'); }}
          >
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="sm:w-44" aria-label="Filter by category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat === 'All' ? 'All categories' : cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>
        }
        footer={
          !isLoading && filteredItems.length > 0 ? (
            <VehicleTablePagination
              currentPage={renewalPagination.currentPage}
              totalPages={renewalPagination.totalPages}
              totalRows={filteredItems.length}
              pageSize={renewalPagination.pageSize}
              onPageChange={renewalPagination.setCurrentPage}
            />
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="space-y-2 p-3 sm:p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : (
          // Phone cards need an inset from the card's edge; the desktop table runs edge to edge.
          <div className="p-3 sm:p-0">
            <DataList
              rows={renewalPagination.paginatedRows}
              columns={columns}
              dense
              frameless
              maxHeightClassName="sm:max-h-[min(70vh,42rem)]"
              empty={
                <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                  <CheckCircle2 className="h-10 w-10 text-slate-300" />
                  <p className="text-base font-semibold text-slate-700">All clear</p>
                  <p className="text-sm text-muted-foreground">
                    {items.length === 0
                      ? 'No compliance data found, or you may not have access to view modules.'
                      : 'No items match your current filters.'}
                  </p>
                </div>
              }
            />
          </div>
        )}
      </TableCard>
    </div>
  );
}
