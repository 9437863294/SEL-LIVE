'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs, query, where } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/lib/firebase';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { chartChrome } from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VmStatStrip, type VmStat } from '@/components/vehicle-management/vm-ui';
import {
  RENEWAL_SOURCES,
  toRenewalItem,
  type RenewalItem,
} from '@/components/vehicle-management/renewal-items';

// Reuses the status semantics already established across Insurance/PUC/Vehicle Health:
// emerald = valid/good, amber = due soon/warning, rose = expired/critical, slate = missing/neutral.
const STATUS_COLORS = {
  valid: '#10b981',
  dueSoon: '#f59e0b',
  expired: '#e11d48',
  missing: '#94a3b8',
} as const;

const VEHICLE_STATUS_COLORS: Record<string, string> = {
  Active: '#10b981',
  'Under Maintenance': '#f59e0b',
  Rented: '#0ea5e9',
  Inactive: '#94a3b8',
  Sold: '#64748b',
  Scrapped: '#334155',
  'Expired Documents': '#e11d48',
};

// The registers whose sizes the fleet strip reports. Navigation is the sidebar's job (and the
// phone's bottom bar), so the page no longer repeats it as a row of link chips.
const registers = [
  { label: 'Vehicles', collection: VEHICLE_COLLECTIONS.vehicleMaster, permission: 'Vehicle Master' },
  { label: 'Drivers', collection: VEHICLE_COLLECTIONS.driver, permission: 'Driver Management' },
] as const;

const formatInr = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

/** A local calendar day as `YYYY-MM-DD` — never via toISOString, which is the UTC day. */
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** `null` where the user can't see that register, so its figure is left out rather than shown as 0. */
type MonthFigures = {
  fuelSpend: number | null;
  maintenanceSpend: number | null;
  trips: number | null;
  distanceKm: number | null;
  onTripNow: number | null;
};

/**
 * This month's running figures. Fuel and service dates are stored as `YYYY-MM-DD` and trip starts as
 * ISO date-times, so a string range bounded by local month starts is the month — the records the
 * reports pick with `startsWith(month)` — and only the month's documents are read, not the registers.
 */
async function loadMonthFigures(canView: (permission: string) => boolean) {
  const now = new Date();
  const from = localDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const inMonth = (field: string) => [where(field, '>=', from), where(field, '<', to)];
  const figures: MonthFigures = { fuelSpend: null, maintenanceSpend: null, trips: null, distanceKm: null, onTripNow: null };
  let failures = 0;
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.error(`Failed to load this month's ${what}`, error);
      failures += 1;
    }
  };

  await Promise.all([
    canView('Fuel Management') &&
      attempt('fuel spend', async () => {
        const snap = await getDocs(query(collection(db, VEHICLE_COLLECTIONS.fuel), ...inMonth('fuelDate')));
        figures.fuelSpend = snap.docs.reduce((sum, entry) => sum + Number(entry.data().totalAmount || 0), 0);
      }),
    canView('Maintenance Management') &&
      attempt('maintenance spend', async () => {
        const snap = await getDocs(query(collection(db, VEHICLE_COLLECTIONS.maintenance), ...inMonth('serviceDate')));
        figures.maintenanceSpend = snap.docs.reduce((sum, entry) => sum + Number(entry.data().totalCost || 0), 0);
      }),
    canView('Trip Management') &&
      attempt('trips', async () => {
        const [monthSnap, live] = await Promise.all([
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.trips), ...inMonth('startTimeIso'))),
          getCountFromServer(query(collection(db, VEHICLE_COLLECTIONS.trips), where('tripStatus', '==', 'In Progress'))),
        ]);
        figures.trips = monthSnap.size;
        figures.distanceKm = monthSnap.docs.reduce((sum, entry) => sum + Number(entry.data().totalDistanceKm || 0), 0);
        figures.onTripNow = live.data().count;
      }),
  ]);
  return { figures, failures };
}

// Every section a user may be granted; with none of them the page says so instead of standing empty.
const SECTION_PERMISSIONS = [
  'Vehicle Master', 'Insurance Management', 'PUC Management', 'Fitness Certificate Management', 'Road Tax Management',
  'Permit Management', 'Maintenance Management', 'Fuel Management', 'Driver Management', 'Trip Management',
  'Document Management', 'Settings',
];

// Each entry with a requirementKey feeds the "Fleet Compliance Overview" chart (per-vehicle
// requirement-aware); Documents/Driver License aren't covered by getVehicleComplianceRequirements
// so they only feed the combined alert tile, not the per-category chart.
const expirySources = [
  { label: 'Insurance', collection: VEHICLE_COLLECTIONS.insurance, key: 'expiryDate', permission: 'Insurance Management', requirementKey: 'insurance' as const },
  { label: 'PUC', collection: VEHICLE_COLLECTIONS.puc, key: 'expiryDate', permission: 'PUC Management', requirementKey: 'puc' as const },
  { label: 'Fitness', collection: VEHICLE_COLLECTIONS.fitness, key: 'expiryDate', permission: 'Fitness Certificate Management', requirementKey: 'fitness' as const },
  { label: 'Road Tax', collection: VEHICLE_COLLECTIONS.roadTax, key: 'validTill', permission: 'Road Tax Management', requirementKey: 'roadTax' as const },
  { label: 'Permit', collection: VEHICLE_COLLECTIONS.permit, key: 'validTill', permission: 'Permit Management', requirementKey: 'permit' as const },
  { label: 'Documents', collection: VEHICLE_COLLECTIONS.documents, key: 'expiryDate', permission: 'Document Management', requirementKey: null },
  { label: 'Driver License', collection: VEHICLE_COLLECTIONS.driver, key: 'licenseExpiryDate', permission: 'Driver Management', requirementKey: null },
] as const;

type CategoryBucket = { valid: number; dueSoon: number; expired: number; missing: number };

const classifyExpiry = (value: unknown) => {
  if (!value) return 'missing' as const;
  const target = new Date(String(value));
  if (Number.isNaN(target.getTime())) return 'missing' as const;
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired' as const;
  if (days <= 30) return 'dueSoon' as const;
  return 'valid' as const;
};

export default function VehicleManagementOverviewPage() {
  const { can } = useAuthorization();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncFailures, setSyncFailures] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Expired and due-soon items by the Renewals Hub's own rules, so the strip's counts match that page.
  const [urgentItems, setUrgentItems] = useState<RenewalItem[]>([]);
  const [monthFigures, setMonthFigures] = useState<MonthFigures | null>(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState<Record<string, CategoryBucket>>({});
  const [vehicleStatusBreakdown, setVehicleStatusBreakdown] = useState<Array<{ status: string; count: number }>>([]);
  const isMountedRef = useRef(true);
  const isSyncingRef = useRef(false);
  const firstLoadDoneRef = useRef(false);

  const canViewSection = useCallback((permission: string) => {
    if (can('View', `Vehicle Management.${permission}`)) return true;
    if (can('Add', `Vehicle Management.${permission}`)) return true;
    if (can('Edit', `Vehicle Management.${permission}`)) return true;
    return false;
  }, [can]);

  const load = useCallback(async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setIsRefreshing(true);
      if (!firstLoadDoneRef.current) setIsLoading(true);
      try {
      const nextCounts: Record<string, number> = {};
      const nextUrgent: RenewalItem[] = [];
      const nextCategoryBreakdown: Record<string, CategoryBucket> = {};
      const categoryVehicleIdsWithDoc: Partial<Record<keyof VehicleComplianceRequirements, Set<string>>> = {};
      const nextVehicleStatus: Record<string, number> = {};
      let failureCount = 0;
      // Needed to know whether a compliance category even applies to a given vehicle
      // (e.g. Sold/Scrapped vehicles need no insurance/PUC/fitness/road tax/permit at all).
      let vehicleMap: Record<string, Record<string, any>> = {};
      try {
        const vehicleSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        vehicleMap = Object.fromEntries(vehicleSnap.docs.map((entry) => [entry.id, entry.data()]));
        Object.values(vehicleMap).forEach((vehicle) => {
          const status = String(vehicle.vehicleStatus || 'Active');
          nextVehicleStatus[status] = (nextVehicleStatus[status] || 0) + 1;
        });
      } catch (error) {
        console.error('Failed to load vehicles for expiry alert filtering', error);
      }
      // Started now, awaited below: independent of everything else this load reads.
      const monthPromise = loadMonthFigures(canViewSection);
      await Promise.all(
        registers.map(async (item) => {
          if (!canViewSection(item.permission)) return;
          try {
            const snapshot = await getCountFromServer(collection(db, item.collection));
            nextCounts[item.collection] = snapshot.data().count;
          } catch (error) {
            console.error(`Failed count for ${item.collection}`, error);
            failureCount += 1;
            nextCounts[item.collection] = 0;
          }
        })
      );
      await Promise.all(
        expirySources.map(async (source) => {
          if (!canViewSection(source.permission)) return;
          try {
            const snapshot = await getDocs(collection(db, source.collection));
            const seenVehicleIds = new Set<string>();
            // The Renewals Hub's rules for the same collection, run on the documents already here.
            const renewalSource = RENEWAL_SOURCES.find((entry) => entry.collection === source.collection);
            snapshot.docs.forEach((entry) => {
              const data = entry.data();
              if (renewalSource) {
                const item = toRenewalItem(renewalSource, entry.id, data, vehicleMap);
                if (item) nextUrgent.push(item);
              }
              if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
              if (source.requirementKey) {
                const vehicle = vehicleMap[String(data.vehicleId || '')];
                if (vehicle) {
                  const required: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
                  if (!required[source.requirementKey]) return;
                }
                const vid = String(data.vehicleId || '');
                if (vid) seenVehicleIds.add(vid);
              }
              const kind = classifyExpiry(data?.[source.key]);

              if (source.requirementKey) {
                const bucket = (nextCategoryBreakdown[source.label] ||= { valid: 0, dueSoon: 0, expired: 0, missing: 0 });
                if (kind === 'expired') bucket.expired += 1;
                else if (kind === 'dueSoon') bucket.dueSoon += 1;
                else if (kind === 'valid') bucket.valid += 1;
                else bucket.missing += 1; // record exists but has no usable expiry date
              }
            });
            if (source.requirementKey) categoryVehicleIdsWithDoc[source.requirementKey] = seenVehicleIds;
          } catch (error) {
            console.error(`Failed to evaluate expiry alerts for ${source.collection}`, error);
            failureCount += 1;
          }
        })
      );
      // A vehicle that requires a category but has zero current records for it never shows
      // up in the loop above at all — count those as "missing" too, per category.
      expirySources.forEach((source) => {
        if (!source.requirementKey || !canViewSection(source.permission)) return;
        const seen = categoryVehicleIdsWithDoc[source.requirementKey] || new Set<string>();
        Object.entries(vehicleMap).forEach(([vehicleId, vehicle]) => {
          const required: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
          if (!required[source.requirementKey]) return;
          if (seen.has(vehicleId)) return;
          const bucket = (nextCategoryBreakdown[source.label] ||= { valid: 0, dueSoon: 0, expired: 0, missing: 0 });
          bucket.missing += 1;
        });
      });
      const month = await monthPromise;
      failureCount += month.failures;
      if (!isMountedRef.current) return;
      setCounts(nextCounts);
      setMonthFigures(month.figures);
      setUrgentItems(nextUrgent);
      setCategoryBreakdown(nextCategoryBreakdown);
      setVehicleStatusBreakdown(
        Object.entries(nextVehicleStatus)
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count)
      );
      setSyncFailures(failureCount);
      setLastUpdated(new Date());
      firstLoadDoneRef.current = true;
      setIsLoading(false);
      } finally {
        isSyncingRef.current = false;
        if (isMountedRef.current) setIsRefreshing(false);
      }
  }, [canViewSection]);

  useEffect(() => {
    isMountedRef.current = true;
    load();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }, 120_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [load]);

  const hasAnySection = useMemo(() => SECTION_PERMISSIONS.some((permission) => canViewSection(permission)), [canViewSection]);
  const expiredCount = useMemo(() => urgentItems.filter((item) => item.kind === 'expired').length, [urgentItems]);
  const dueSoonCount = urgentItems.length - expiredCount;
  const activeVehicles = vehicleStatusBreakdown.find((row) => row.status === 'Active')?.count ?? 0;

  const complianceChartData = useMemo(
    () =>
      expirySources
        .filter((source) => source.requirementKey && categoryBreakdown[source.label])
        .map((source) => ({ category: source.label, ...categoryBreakdown[source.label] })),
    [categoryBreakdown]
  );

  // Compliant = every required category currently covered (valid or due soon — not yet lapsed), out of
  // every requirement the fleet has, missing records included. Same buckets as the compliance chart.
  const compliance = useMemo(() => {
    const totals = complianceChartData.reduce(
      (sum, row) => ({
        covered: sum.covered + row.valid + row.dueSoon,
        required: sum.required + row.valid + row.dueSoon + row.expired + row.missing,
        missing: sum.missing + row.missing,
      }),
      { covered: 0, required: 0, missing: 0 }
    );
    return { ...totals, percent: totals.required > 0 ? Math.round((totals.covered / totals.required) * 100) : null };
  }, [complianceChartData]);

  // Only the registers this user can open; the renewal figures cover whatever they can see.
  const pending = (value: number) => (isLoading ? '…' : value);
  const fleetStats: VmStat[] = [
    ...registers
      .filter((register) => canViewSection(register.permission))
      .map((register): VmStat => ({
        label: register.label,
        value: pending(counts[register.collection] ?? 0),
        hint: register.collection === VEHICLE_COLLECTIONS.vehicleMaster && !isLoading ? `${activeVehicles} active` : undefined,
      })),
    ...(isLoading || compliance.percent !== null
      ? [
          {
            label: 'Compliance',
            value: isLoading ? '…' : `${compliance.percent}%`,
            tone: isLoading || compliance.percent === null ? 'default' : compliance.percent >= 90 ? 'success' : compliance.percent >= 70 ? 'warning' : 'danger',
            hint: isLoading ? undefined : compliance.missing > 0 ? `${compliance.missing} records missing` : 'nothing missing',
          } satisfies VmStat,
        ]
      : []),
    { label: 'Expired', value: pending(expiredCount), tone: expiredCount > 0 ? 'danger' : 'default' },
    { label: 'Due in 30 days', value: pending(dueSoonCount), tone: dueSoonCount > 0 ? 'warning' : 'default' },
  ];

  // This month's running figures; each is left out when the user can't see its register.
  const month = monthFigures;
  const monthStats: VmStat[] = [
    ...(isLoading || month?.fuelSpend != null ? [{ label: 'Fuel spend', value: isLoading ? '…' : formatInr(month?.fuelSpend ?? 0) }] : []),
    ...(isLoading || month?.maintenanceSpend != null ? [{ label: 'Maintenance spend', value: isLoading ? '…' : formatInr(month?.maintenanceSpend ?? 0) }] : []),
    ...(isLoading || month?.trips != null
      ? [{ label: 'Trips', value: pending(month?.trips ?? 0), hint: !isLoading && month?.onTripNow ? `${month.onTripNow} on the road now` : undefined }]
      : []),
    ...(isLoading || month?.distanceKm != null
      ? [{ label: 'Distance', value: isLoading ? '…' : `${Math.round(month?.distanceKm ?? 0).toLocaleString('en-IN')} km` }]
      : []),
  ];
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden sm:space-y-4">
      <PageHeader
        title="Vehicle Management"
        description={
          <>
            Fleet operations, compliance, driver activity, cost intelligence, and reports.
            {lastUpdated && <span className="ml-1">Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
          </>
        }
        meta={syncFailures > 0 ? [{ label: 'Sync', value: <span className="text-amber-700">Partial data · retry refresh</span> }] : undefined}
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={isRefreshing} className="h-8 shrink-0 px-2.5" aria-label="Refresh vehicle overview">
            <RefreshCw className={cn('h-3.5 w-3.5 sm:mr-1.5', isRefreshing && 'animate-spin')} /><span className="hidden sm:inline">Refresh</span>
          </Button>
        }
      />

      {/* Essentials, before any chart: the fleet and its compliance, then this month's running figures. */}
      <section aria-labelledby="vm-fleet-heading" className="space-y-1.5">
        <h2 id="vm-fleet-heading" className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fleet</h2>
        <VmStatStrip stats={fleetStats} />
      </section>
      {monthStats.length > 0 && (
        <section aria-labelledby="vm-month-heading" className="space-y-1.5">
          <h2 id="vm-month-heading" className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            This month · {monthName}
          </h2>
          <VmStatStrip stats={monthStats} />
        </section>
      )}

      {/* Reports & data — the dashboard leads with fleet compliance/status data, not navigation. */}
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Card className="vm-panel-strong overflow-hidden vm-reveal">
          <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
            <CardTitle>Fleet Compliance Overview</CardTitle>
            <CardDescription className="text-xs">
              Valid, due-soon, expired, and missing counts per compliance category — vehicles
              that don&apos;t require a category (Sold/Scrapped, etc.) are excluded.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3 sm:pb-3">
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : complianceChartData.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">No compliance data to show yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={complianceChartData} layout="vertical" barCategoryGap={14} margin={{ left: 4, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={chartChrome.grid} />
                  <XAxis type="number" allowDecimals={false} fontSize={11} stroke={chartChrome.axis} />
                  <YAxis type="category" dataKey="category" width={72} fontSize={12} stroke={chartChrome.axis} tickLine={false} axisLine={false} />
                  <Tooltip cursor={chartChrome.cursor} {...chartChrome.tooltip} />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                    formatter={(value: string) =>
                      ({ valid: 'Valid', dueSoon: 'Due Soon', expired: 'Expired', missing: 'Missing' } as Record<string, string>)[value] || value
                    }
                  />
                  <Bar isAnimationActive={false} dataKey="valid" name="valid" stackId="status" fill={STATUS_COLORS.valid} radius={[0, 0, 0, 0]} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="dueSoon" name="dueSoon" stackId="status" fill={STATUS_COLORS.dueSoon} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="expired" name="expired" stackId="status" fill={STATUS_COLORS.expired} maxBarSize={22} />
                  <Bar isAnimationActive={false} dataKey="missing" name="missing" stackId="status" fill={STATUS_COLORS.missing} radius={[0, 4, 4, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="vm-panel-strong overflow-hidden vm-reveal">
          <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
            <CardTitle>Fleet Status</CardTitle>
            <CardDescription className="text-xs">Vehicle Master status distribution.</CardDescription>
          </CardHeader>
          <CardContent className="px-1 pb-2 sm:px-3 sm:pb-3">
            {isLoading ? (
              <Skeleton className="h-[220px] w-full" />
            ) : vehicleStatusBreakdown.length === 0 ? (
              <p className="px-3 py-10 text-center text-sm text-muted-foreground">No vehicles yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie isAnimationActive={false} data={vehicleStatusBreakdown} dataKey="count" nameKey="status" innerRadius={48} outerRadius={82} paddingAngle={2} stroke={chartChrome.surface}>
                    {vehicleStatusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={VEHICLE_STATUS_COLORS[entry.status] || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip {...chartChrome.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {!hasAnySection && (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle>No Section Access</CardTitle>
            <CardDescription>You currently do not have permission to view vehicle sub-modules.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
