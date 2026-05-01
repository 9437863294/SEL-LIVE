'use client';

import Link from 'next/link';
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
  Activity,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileArchive,
  Landmark,
  Leaf,
  RefreshCw,
  ScrollText,
  Shield,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ExpiryKind = 'expired' | 'dueSoon' | 'valid';

interface RenewalItem {
  id: string;
  category: string;
  categoryIcon: React.ElementType;
  vehicleOrDriver: string;
  expiryDate: string;
  daysLeft: number;
  kind: ExpiryKind;
  alertStage: string;
  href: string;
  details: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source definitions
// ─────────────────────────────────────────────────────────────────────────────
const SOURCES = [
  {
    category: 'Insurance',
    icon: Shield,
    collection: VEHICLE_COLLECTIONS.insurance,
    dateKeys: ['expiryDate', 'validTill', 'endDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['policyNumber', 'insuranceCompany'],
    href: '/vehicle-management/insurance',
    permission: 'Insurance Management',
  },
  {
    category: 'PUC',
    icon: Leaf,
    collection: VEHICLE_COLLECTIONS.puc,
    dateKeys: ['expiryDate', 'validTill'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['pucCertificateNumber', 'testingCenterName'],
    href: '/vehicle-management/puc',
    permission: 'PUC Management',
  },
  {
    category: 'Fitness',
    icon: BadgeCheck,
    collection: VEHICLE_COLLECTIONS.fitness,
    dateKeys: ['expiryDate', 'validTill'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['fitnessCertificateNumber', 'rtoName'],
    href: '/vehicle-management/fitness',
    permission: 'Fitness Certificate Management',
  },
  {
    category: 'Road Tax',
    icon: Landmark,
    collection: VEHICLE_COLLECTIONS.roadTax,
    dateKeys: ['validTill', 'expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['receiptNumber', 'taxType', 'totalAmountPaid', 'amountPaid'],
    href: '/vehicle-management/road-tax',
    permission: 'Road Tax Management',
  },
  {
    category: 'Permits',
    icon: ScrollText,
    collection: VEHICLE_COLLECTIONS.permit,
    dateKeys: ['validTill', 'expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo', 'vehicleRegNo'],
    detailKeys: ['permitNumber', 'permitType'],
    href: '/vehicle-management/permit',
    permission: 'Permit Management',
  },
  {
    category: 'Documents',
    icon: FileArchive,
    collection: VEHICLE_COLLECTIONS.documents,
    dateKeys: ['expiryDate'],
    nameKeys: ['vehicleNumber', 'registrationNo'],
    detailKeys: ['documentType', 'documentNumber'],
    href: '/vehicle-management/documents',
    permission: 'Document Management',
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const getDaysLeft = (expiryDate: string): number => {
  if (!expiryDate) return Infinity;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(expiryDate);
  if (Number.isNaN(target.getTime())) {
    const normalized = expiryDate.replace(/\//g, '-');
    const parts = normalized.split('-');
    if (parts.length === 3) {
      const [a, b, c] = parts;
      const maybeDdMmYyyy = new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`);
      if (!Number.isNaN(maybeDdMmYyyy.getTime())) {
        maybeDdMmYyyy.setHours(0, 0, 0, 0);
        return Math.ceil((maybeDdMmYyyy.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
    }
    return Infinity;
  }
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const kindFromDays = (days: number): ExpiryKind => {
  if (days < 0) return 'expired';
  if (days <= 30) return 'dueSoon';
  return 'valid';
};

// ─────────────────────────────────────────────────────────────────────────────
// Badge helpers
// ─────────────────────────────────────────────────────────────────────────────
function KindBadge({ kind, daysLeft }: { kind: ExpiryKind; daysLeft: number }) {
  if (kind === 'expired') {
    return (
      <Badge variant="destructive" className="gap-1 shadow-sm">
        <AlertTriangle className="h-3 w-3" />
        Expired {Math.abs(daysLeft)}d ago
      </Badge>
    );
  }
  if (kind === 'dueSoon') {
    return (
      <Badge className="gap-1 bg-amber-500 text-white shadow-sm hover:bg-amber-600">
        <Timer className="h-3 w-3" />
        {daysLeft === 0 ? 'Due Today' : `${daysLeft}d left`}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-emerald-100 text-emerald-700 shadow-sm hover:bg-emerald-200">
      <CheckCircle2 className="h-3 w-3" />
      Valid ({daysLeft}d)
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Icon row chip
// ─────────────────────────────────────────────────────────────────────────────
const categoryGradients: Record<string, string> = {
  Insurance: 'from-emerald-500/20 to-teal-500/20',
  PUC: 'from-lime-500/20 to-green-500/20',
  Fitness: 'from-violet-500/20 to-indigo-500/20',
  'Road Tax': 'from-amber-500/20 to-orange-500/20',
  Permits: 'from-indigo-500/20 to-blue-500/20',
  Documents: 'from-slate-500/20 to-zinc-400/20',
};

// ─────────────────────────────────────────────────────────────────────────────
// Filter tabs
// ─────────────────────────────────────────────────────────────────────────────
type FilterTab = 'all' | 'expired' | 'dueSoon';

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

    await Promise.all(
      SOURCES.map(async (source) => {
        if (!canViewSource(source.permission)) return;
        try {
          const snap = await getDocs(collection(db, source.collection));
          snap.docs.forEach((entry) => {
            const data = entry.data() as Record<string, any>;
            
            // Skip archived or already renewed items
            if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
            
            const rawDate =
              source.dateKeys
                .map((key) => String(data[key] || '').trim())
                .find((value) => value.length > 0) || '';
            if (!rawDate) return;
            const meta = computeRenewalMeta(rawDate);
            const daysLeft = getDaysLeft(rawDate);
            const kind = kindFromDays(daysLeft);
            
            // Only collect non-valid (expired or due soon within 30 days)
            if (kind === 'valid') return;
            
            // Generate Renewal URL parameters
            const params = new URLSearchParams();
            params.set('renew', entry.id);
            const resolvedName =
              source.nameKeys
                .map((key) => String(data[key] || '').trim())
                .find((value) => value.length > 0) || '—';
            const resolvedDetail =
              source.detailKeys
                .map((key) => String(data[key] || '').trim())
                .find((value) => value.length > 0) || '—';

            if (data.vehicleId) params.set('vid', String(data.vehicleId));
            if (resolvedName && resolvedName !== '—') params.set('vnum', resolvedName);
            if (data.driverName) params.set('dname', String(data.driverName));
            
            const renewalHref = `${source.href}?${params.toString()}`;

            collected.push({
              id: `${source.collection}-${entry.id}`,
              category: source.category,
              categoryIcon: source.icon,
              vehicleOrDriver: resolvedName,
              expiryDate: rawDate,
              daysLeft,
              kind,
              alertStage: meta.alertStage,
              href: renewalHref,
              details: resolvedDetail,
            });
          });
        } catch (err) {
          console.error(`Renewals: failed to fetch ${source.collection}`, err);
        }
      })
    );

    // Sort: expired first, then by days ascending
    collected.sort((a, b) => {
      if (a.kind === 'expired' && b.kind !== 'expired') return -1;
      if (b.kind === 'expired' && a.kind !== 'expired') return 1;
      return a.daysLeft - b.daysLeft;
    });

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

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-rose-500/10 via-orange-500/5 to-amber-500/10 animate-bb-gradient" />
        <div className="electric-scan-line top-8" />
        <CardHeader className="relative">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-2xl tracking-tight flex items-center gap-2">
                <RefreshCw className="h-6 w-6 text-rose-500" />
                Renewals Hub
              </CardTitle>
              <CardDescription>
                Consolidated view of all expired and due-soon compliance items across the fleet.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/vehicle-management/vehicle-health"
                className="flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-100 transition-colors"
              >
                <Activity className="h-3.5 w-3.5" />
                Health Dashboard
              </Link>
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
          </div>
        </CardHeader>
        <CardContent className="relative grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-rose-100/80 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Total Alerts</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : items.length}</p>
          </div>
          <div className="rounded-xl border border-rose-100/80 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Expired</p>
            <p className="mt-1 text-2xl font-semibold text-rose-600">
              {isLoading ? '...' : expired.length}
            </p>
          </div>
          <div className="rounded-xl border border-amber-100/80 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Due Within 30 Days</p>
            <p className="mt-1 text-2xl font-semibold text-amber-600">
              {isLoading ? '...' : dueSoon.length}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Filters ── */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-0.5 w-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-500" />
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:flex-wrap">
          {/* Kind filter */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'expired', 'dueSoon'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                  filter === tab
                    ? tab === 'expired'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : tab === 'dueSoon'
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm'
                    : 'bg-white/80 text-muted-foreground hover:bg-white border border-white/70'
                )}
              >
                {tab === 'all' ? `All (${items.length})` : tab === 'expired' ? `Expired (${expired.length})` : `Due Soon (${dueSoon.length})`}
              </button>
            ))}
          </div>

          {/* Category filter */}
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
              </button>
            ))}
          </div>

          {/* Search */}
          <Input
            placeholder="Search vehicle, driver, details..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ml-auto max-w-xs bg-white/80 border-white/70 focus-visible:ring-rose-400/40"
          />
        </CardContent>
      </Card>

      {/* ── Items Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="vm-panel-strong">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="text-lg font-semibold text-slate-700">All Clear!</p>
            <p className="text-sm text-muted-foreground">
              {items.length === 0
                ? 'No compliance data found, or you may not have access to view modules.'
                : 'No items match your current filters.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => {
            const Icon = item.categoryIcon;
            const gradient = categoryGradients[item.category] ?? 'from-slate-500/20 to-gray-500/20';
            return (
              <div
                key={item.id}
                className={cn(
                  'group relative overflow-hidden rounded-2xl border bg-white/90 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lg vm-reveal',
                  item.kind === 'expired'
                    ? 'border-rose-200/80 hover:shadow-rose-200/50'
                    : 'border-amber-200/80 hover:shadow-amber-200/50'
                )}
              >
                {/* Gradient bg */}
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60', gradient)} />

                {/* Expired top accent */}
                {item.kind === 'expired' && (
                  <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
                )}
                {item.kind === 'dueSoon' && (
                  <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-orange-500" />
                )}

                <div className="relative p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-slate-100">
                        <Icon className="h-4.5 w-4.5 text-slate-600" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {item.category}
                        </p>
                        <p className="font-semibold text-slate-800 leading-tight">
                          {item.vehicleOrDriver}
                        </p>
                      </div>
                    </div>
                    <KindBadge kind={item.kind} daysLeft={item.daysLeft} />
                  </div>

                  {/* Details */}
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Expires:{' '}
                        <span className="font-medium text-slate-700">
                          {item.expiryDate || '—'}
                        </span>
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-slate-600">{item.details}</span>
                    </div>
                  </div>

                  {/* Action */}
                  <div className="mt-4 flex items-center gap-2">
                    <Link href={item.href} className="flex-1">
                      <Button
                        size="sm"
                        className={cn(
                          'w-full gap-1.5 text-xs shadow-sm',
                          item.kind === 'expired'
                            ? 'bg-rose-500 text-white hover:bg-rose-600'
                            : 'bg-amber-500 text-white hover:bg-amber-600'
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Renew Now
                      </Button>
                    </Link>
                    <Link href={`${item.href}?tab=history`} className="shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 bg-white/80 text-xs hover:bg-white"
                        title="View history"
                      >
                        <ExternalLink className="h-3 w-3" />
                        History
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Legend ── */}
      {!isLoading && items.length > 0 && (
        <Card className="vm-panel-strong">
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
                Expired — Immediate renewal required
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                Due Soon — Expires within 30 days
              </div>
              <div className="ml-auto text-right">
                Showing{' '}
                <span className="font-semibold text-slate-700">{filteredItems.length}</span> of{' '}
                <span className="font-semibold text-slate-700">{items.length}</span> alerts
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
