'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
// Category color map
// ─────────────────────────────────────────────────────────────────────────────
const categoryColors: Record<string, string> = {
  Insurance: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PUC: 'bg-lime-50 text-lime-700 border-lime-200',
  Fitness: 'bg-violet-50 text-violet-700 border-violet-200',
  'Road Tax': 'bg-amber-50 text-amber-700 border-amber-200',
  Permit: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  'Driver License': 'bg-blue-50 text-blue-700 border-blue-200',
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

    await Promise.all(
      SOURCES.map(async (source) => {
        if (!canViewSource(source.permission)) return;
        try {
          const snap = await getDocs(collection(db, source.collection));
          snap.docs.forEach((entry) => {
            const data = entry.data() as Record<string, any>;
            const rawDate = String(data[source.dateKey] || '');
            if (!rawDate) return;
            const meta = computeRenewalMeta(rawDate);
            // Only include expired records in history
            if (meta.complianceStatus !== 'Expired') return;
            const daysExpired = getDaysExpired(rawDate);
            const rawCreated = data['createdAt'];
            let createdAt = '';
            if (rawCreated?.seconds) {
              createdAt = new Date(rawCreated.seconds * 1000).toLocaleDateString('en-IN');
            }
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
            });
          });
        } catch (err) {
          console.error(`History: failed to fetch ${source.collection}`, err);
        }
      })
    );

    // Sort by most recently expired (highest daysExpired first for oldest, or by expiryDate desc)
    collected.sort((a, b) => {
      const da = new Date(a.expiryDate).getTime();
      const db2 = new Date(b.expiryDate).getTime();
      return db2 - da; // Most recently expired at top
    });

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

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-slate-500/10 via-zinc-400/5 to-gray-500/10 animate-bb-gradient" />
        <div className="electric-scan-line top-8" />
        <CardHeader className="relative">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-2xl tracking-tight flex items-center gap-2">
                <History className="h-6 w-6 text-slate-600" />
                Renewal History
              </CardTitle>
              <CardDescription>
                Archive of all expired compliance records across PUC, Insurance, DL, Fitness, Road Tax, and Permit.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={load}
              disabled={isLoading}
              className="w-fit gap-2 bg-white/80 hover:bg-white"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="relative grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100/80 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Total Expired Records</p>
            <p className="mt-1 text-2xl font-semibold text-rose-600">
              {isLoading ? '...' : records.length}
            </p>
          </div>
          {categories.slice(1).slice(0, 2).map((cat) => (
            <div key={cat} className="rounded-xl border border-slate-100/80 bg-white/80 p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{cat}</p>
              <p className="mt-1 text-2xl font-semibold">
                {isLoading ? '...' : records.filter((r) => r.category === cat).length}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Filters ── */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-slate-400 via-zinc-400 to-gray-400" />
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200',
                  categoryFilter === cat
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'bg-white/80 text-muted-foreground hover:bg-white border border-white/70'
                )}
              >
                {cat}
                {cat !== 'All' && (
                  <span className="ml-1 text-[10px] opacity-70">
                    ({records.filter((r) => r.category === cat).length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <Input
            placeholder="Search by vehicle, driver, detail or date..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ml-auto max-w-xs bg-white/80 border-white/70 focus-visible:ring-slate-400/40"
          />
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card className="vm-panel-strong overflow-hidden">
        <CardContent className="p-0">
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
                {filteredRecords.map((rec) => (
                  <div
                    key={rec.id}
                    className="rounded-xl border border-rose-100/80 bg-white/85 p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Badge
                          className={cn(
                            'mb-1 border text-[10px]',
                            categoryColors[rec.category] ?? 'bg-slate-50 text-slate-700'
                          )}
                          variant="outline"
                        >
                          {rec.category}
                        </Badge>
                        <p className="font-semibold text-slate-800">{rec.vehicleOrDriver}</p>
                        <p className="text-xs text-muted-foreground">{rec.detail}</p>
                      </div>
                      <Badge variant="destructive" className="shrink-0 text-[10px]">
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
              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>Category</TableHead>
                      <TableHead>Vehicle / Driver</TableHead>
                      <TableHead>Detail / Reference</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Days Expired</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added On</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRecords.map((rec) => (
                      <TableRow
                        key={rec.id}
                        className="hover:bg-rose-50/50 transition-colors"
                      >
                        <TableCell>
                          <Badge
                            className={cn(
                              'border text-[10px] font-semibold',
                              categoryColors[rec.category] ?? 'bg-slate-50 text-slate-700'
                            )}
                            variant="outline"
                          >
                            {rec.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">{rec.vehicleOrDriver}</TableCell>
                        <TableCell className="text-muted-foreground">{rec.detail}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">{rec.expiryDate || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="text-xs">
                            {rec.daysExpired > 0 ? `${rec.daysExpired}d ago` : 'Today'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-rose-600 font-medium">
                            {toDisplay(rec.status)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {rec.createdAt || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Footer count */}
              <div className="border-t border-white/70 px-4 py-2.5 text-right text-xs text-muted-foreground">
                Showing{' '}
                <span className="font-semibold text-slate-700">{filteredRecords.length}</span> of{' '}
                <span className="font-semibold text-slate-700">{records.length}</span> expired records
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
