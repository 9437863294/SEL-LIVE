'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, formatVehicleTimestamp, getVehicleComplianceRequirements, getVehicleTimestampMillis, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BadgeCheck,
  Clock,
  History,
  Landmark,
  Leaf,
  RefreshCw,
  ScrollText,
  Shield,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VehicleTablePagination, useVehicleTablePagination } from '@/components/vehicle-management/table-pagination';
import { VM_SEGMENT_TRACK, vmSegmentItem } from '@/components/vehicle-management/vm-ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface HistoryRecord {
  id: string;
  category: string;
  vehicleOrDriver: string;
  detail: string;
  expiryDate: string;
  daysExpired: number;
  status: string;
  complianceStatus: string;
  createdAt: string;
  createdAtMillis: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source definitions (expired records only)
// ─────────────────────────────────────────────────────────────────────────────
const SOURCES = [
  {
    category: 'Insurance',
    icon: Shield,
    collection: VEHICLE_COLLECTIONS.insurance,
    dateKey: 'expiryDate',
    nameKey: 'vehicleNumber',
    detailKey: 'policyNumber',
    statusKey: 'renewalStatus',
    permission: 'Insurance Management',
    requirementKey: 'insurance' as const,
  },
  {
    category: 'PUC',
    icon: Leaf,
    collection: VEHICLE_COLLECTIONS.puc,
    dateKey: 'expiryDate',
    nameKey: 'vehicleNumber',
    detailKey: 'pucCertificateNumber',
    statusKey: 'pucStatus',
    permission: 'PUC Management',
    requirementKey: 'puc' as const,
  },
  {
    category: 'Fitness',
    icon: BadgeCheck,
    collection: VEHICLE_COLLECTIONS.fitness,
    dateKey: 'expiryDate',
    nameKey: 'vehicleNumber',
    detailKey: 'fitnessNumber',
    statusKey: 'fitnessStatus',
    permission: 'Fitness Certificate Management',
    requirementKey: 'fitness' as const,
  },
  {
    category: 'Road Tax',
    icon: Landmark,
    collection: VEHICLE_COLLECTIONS.roadTax,
    dateKey: 'validTill',
    nameKey: 'vehicleNumber',
    detailKey: 'taxAmount',
    statusKey: 'roadTaxStatus',
    permission: 'Road Tax Management',
    requirementKey: 'roadTax' as const,
  },
  {
    category: 'Permit',
    icon: ScrollText,
    collection: VEHICLE_COLLECTIONS.permit,
    dateKey: 'validTill',
    nameKey: 'vehicleNumber',
    detailKey: 'permitNumber',
    statusKey: 'permitStatus',
    permission: 'Permit Management',
    requirementKey: 'permit' as const,
  },
  {
    category: 'Driver License',
    icon: User,
    collection: VEHICLE_COLLECTIONS.driver,
    dateKey: 'licenseExpiryDate',
    nameKey: 'driverName',
    detailKey: 'licenseNumber',
    statusKey: 'licenseComplianceStatus',
    permission: 'Driver Management',
    requirementKey: null,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const getDaysExpired = (expiryDate: string): number => {
  if (!expiryDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(expiryDate);
  target.setHours(0, 0, 0, 0);
  const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return days < 0 ? Math.abs(days) : 0;
};

const toDisplay = (value: any) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object' && 'seconds' in value) {
    return new Date(value.seconds * 1000).toLocaleDateString('en-IN');
  }
  return String(value);
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function RenewalHistoryPage() {
  const { can } = useAuthorization();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const canViewSource = (permission: string) =>
    can('View', `Vehicle Management.${permission}`) ||
    can('Add', `Vehicle Management.${permission}`) ||
    can('Edit', `Vehicle Management.${permission}`);

  const load = async () => {
    setIsLoading(true);
    const collected: HistoryRecord[] = [];

    // Needed to skip categories that don't even apply to a vehicle anymore (Sold/Scrapped,
    // or manually turned off) so their old expired record doesn't linger in this archive.
    let vehicleMap: Record<string, Record<string, any>> = {};
    try {
      const vehicleSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
      vehicleMap = Object.fromEntries(vehicleSnap.docs.map((entry) => [entry.id, entry.data()]));
    } catch (err) {
      console.error('Renewal History: failed to load vehicles for requirement filtering', err);
    }

    await Promise.all(
      SOURCES.map(async (source) => {
        if (!canViewSource(source.permission)) return;
        try {
          const snap = await getDocs(collection(db, source.collection));
          snap.docs.forEach((entry) => {
            const data = entry.data() as Record<string, any>;
            if (source.requirementKey) {
              const vehicle = vehicleMap[String(data.vehicleId || data.assignedVehicleId || '')];
              if (vehicle) {
                const required: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
                if (!required[source.requirementKey]) return;
              }
            }
            const rawDate = String(data[source.dateKey] || '');
            if (!rawDate) return;
            const meta = computeRenewalMeta(rawDate);
            // Only include expired records in history
            if (meta.complianceStatus !== 'Expired') return;
            const daysExpired = getDaysExpired(rawDate);
            const createdAt = formatVehicleTimestamp(data['createdAt']);
            collected.push({
              id: `${source.collection}-${entry.id}`,
              category: source.category,
              vehicleOrDriver: String(data[source.nameKey] || '—'),
              detail: String(data[source.detailKey] || '—'),
              expiryDate: rawDate,
              daysExpired,
              status: String(data[source.statusKey] || '—'),
              complianceStatus: meta.complianceStatus,
              createdAt,
              createdAtMillis: getVehicleTimestampMillis(data['createdAt']),
            });
          });
        } catch (err) {
          console.error(`History: failed to fetch ${source.collection}`, err);
        }
      })
    );

    collected.sort((a, b) => b.createdAtMillis - a.createdAtMillis);

    setRecords(collected);
    setIsLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(records.map((r) => r.category)));
    return ['All', ...cats.sort()];
  }, [records]);

  const filteredRecords = useMemo(() => {
    let base = records;
    if (categoryFilter !== 'All') base = base.filter((r) => r.category === categoryFilter);
    const term = query.trim().toLowerCase();
    if (!term) return base;
    return base.filter(
      (r) =>
        r.vehicleOrDriver.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term) ||
        r.detail.toLowerCase().includes(term) ||
        r.expiryDate.includes(term)
    );
  }, [records, categoryFilter, query]);
  const historyPagination = useVehicleTablePagination(filteredRecords);

  return (
    <div className="space-y-3 sm:space-y-5">
      {/* ── Header ── */}
      <PageHeader
        title="Renewal History"
        description="Archive of all expired compliance records across PUC, Insurance, DL, Fitness, Road Tax, and Permit."
        icon={History}
        // The total that used to be a tile of its own; the per-category counts are on the
        // category filter below.
        meta={[{ label: 'Expired records', value: <span className="text-rose-600">{isLoading ? '…' : records.length}</span> }]}
        actions={
          <Button
            variant="outline"
            onClick={load}
            disabled={isLoading}
            className="w-full gap-2 sm:w-fit"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {/* ── Register ── */}
      <TableCard
        title="Expired Records"
        icon={History}
        count={filteredRecords.length}
        total={records.length}
        noun="record"
        toolbar={
          <div className="space-y-2">
            <div className={VM_SEGMENT_TRACK}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={vmSegmentItem(categoryFilter === cat)}
                >
                  {cat}
                  {cat !== 'All' && (
                    <span className="text-[10px] tabular-nums opacity-70">
                      ({records.filter((r) => r.category === cat).length})
                    </span>
                  )}
                </button>
              ))}
            </div>
            <FilterBar
              search={{ value: query, onChange: setQuery, placeholder: 'Search by vehicle, driver, detail or date...' }}
              activeCount={categoryFilter !== 'All' ? 1 : 0}
              onClear={() => { setQuery(''); setCategoryFilter('All'); }}
            />
          </div>
        }
        footer={
          !isLoading && filteredRecords.length > 0 ? (
            <VehicleTablePagination
              currentPage={historyPagination.currentPage}
              totalPages={historyPagination.totalPages}
              totalRows={filteredRecords.length}
              pageSize={historyPagination.pageSize}
              onPageChange={historyPagination.setCurrentPage}
            />
          ) : undefined
        }
      >
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <History className="h-12 w-12 text-slate-300" />
              <p className="text-sm text-muted-foreground">
                {records.length === 0
                  ? 'No expired records found. Great compliance status!'
                  : 'No records match your current filters.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-3 p-4 sm:hidden">
                {historyPagination.paginatedRows.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Badge variant="outline" className="mb-1">
                          {rec.category}
                        </Badge>
                        <p className="font-semibold text-slate-800">{rec.vehicleOrDriver}</p>
                        <p className="text-xs text-muted-foreground">{rec.detail}</p>
                      </div>
                      <Badge variant="danger" className="shrink-0">
                        {rec.daysExpired}d ago
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3 shrink-0" />
                      Expired: <span className="font-medium text-slate-700">{rec.expiryDate}</span>
                    </div>
                    {rec.createdAt && (
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Added: {rec.createdAt}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block">
                <Table containerClassName="overflow-visible">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead>Vehicle / Driver</TableHead>
                      <TableHead>Detail / Reference</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Expired</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyPagination.paginatedRows.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <Badge variant="outline">{rec.category}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{rec.vehicleOrDriver}</TableCell>
                        <TableCell>{rec.detail}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono">{rec.expiryDate || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="danger">
                            {rec.daysExpired > 0 ? `${rec.daysExpired}d ago` : 'Today'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={toDisplay(rec.status)} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {rec.createdAt || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
      </TableCard>
    </div>
  );
}
