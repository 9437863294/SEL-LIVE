'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db } from '@/lib/firebase';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CarFront,
  FileArchive,
  Fuel,
  History,
  Landmark,
  Leaf,
  LocateFixed,
  RefreshCw,
  ScrollText,
  Settings,
  Shield,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

type QuickLink = {
  label: string;
  href: string;
  collection?: string;
  permission: string;
  icon: LucideIcon;
  color: string;
};

const quickLinks: QuickLink[] = [
  { label: 'Vehicle Master', href: '/vehicle-management/vehicle-master', collection: VEHICLE_COLLECTIONS.vehicleMaster, permission: 'Vehicle Master', icon: CarFront, color: 'text-cyan-700 bg-cyan-50 ring-cyan-100' },
  { label: 'Insurance', href: '/vehicle-management/insurance', collection: VEHICLE_COLLECTIONS.insurance, permission: 'Insurance Management', icon: Shield, color: 'text-emerald-700 bg-emerald-50 ring-emerald-100' },
  { label: 'PUC', href: '/vehicle-management/puc', collection: VEHICLE_COLLECTIONS.puc, permission: 'PUC Management', icon: Leaf, color: 'text-green-700 bg-green-50 ring-green-100' },
  { label: 'Fitness', href: '/vehicle-management/fitness', collection: VEHICLE_COLLECTIONS.fitness, permission: 'Fitness Certificate Management', icon: BadgeCheck, color: 'text-indigo-700 bg-indigo-50 ring-indigo-100' },
  { label: 'Road Tax', href: '/vehicle-management/road-tax', collection: VEHICLE_COLLECTIONS.roadTax, permission: 'Road Tax Management', icon: Landmark, color: 'text-amber-700 bg-amber-50 ring-amber-100' },
  { label: 'Permit', href: '/vehicle-management/permit', collection: VEHICLE_COLLECTIONS.permit, permission: 'Permit Management', icon: ScrollText, color: 'text-orange-700 bg-orange-50 ring-orange-100' },
  { label: 'Maintenance', href: '/vehicle-management/maintenance', collection: VEHICLE_COLLECTIONS.maintenance, permission: 'Maintenance Management', icon: Wrench, color: 'text-rose-700 bg-rose-50 ring-rose-100' },
  { label: 'Fuel', href: '/vehicle-management/fuel', collection: VEHICLE_COLLECTIONS.fuel, permission: 'Fuel Management', icon: Fuel, color: 'text-sky-700 bg-sky-50 ring-sky-100' },
  { label: 'Driver Master', href: '/vehicle-management/driver', collection: VEHICLE_COLLECTIONS.driver, permission: 'Driver Management', icon: User, color: 'text-blue-700 bg-blue-50 ring-blue-100' },
  { label: 'Trips', href: '/vehicle-management/trips', collection: VEHICLE_COLLECTIONS.trips, permission: 'Trip Management', icon: LocateFixed, color: 'text-teal-700 bg-teal-50 ring-teal-100' },
  { label: 'Documents', href: '/vehicle-management/documents', collection: VEHICLE_COLLECTIONS.documents, permission: 'Document Management', icon: FileArchive, color: 'text-slate-700 bg-slate-50 ring-slate-100' },
  { label: 'Settings', href: '/vehicle-management/settings', collection: VEHICLE_COLLECTIONS.settings, permission: 'Settings', icon: Settings, color: 'text-violet-700 bg-violet-50 ring-violet-100' },
];

const workflowLinks: QuickLink[] = [
  { label: 'Renewals Hub', href: '/vehicle-management/renewals', permission: '', icon: RefreshCw, color: 'text-rose-700 bg-rose-50 ring-rose-100' },
  { label: 'Renewal History', href: '/vehicle-management/renewals/history', permission: '', icon: History, color: 'text-slate-700 bg-slate-50 ring-slate-100' },
  { label: 'Vehicle Health', href: '/vehicle-management/vehicle-health', permission: 'Vehicle Master', icon: Activity, color: 'text-emerald-700 bg-emerald-50 ring-emerald-100' },
  { label: 'Reports', href: '/vehicle-management/reports', permission: 'Reports', icon: BarChart3, color: 'text-indigo-700 bg-indigo-50 ring-indigo-100' },
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
  const [alertSummary, setAlertSummary] = useState({ expired: 0, dueSoon: 0, valid: 0 });
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
      const nextAlerts = { expired: 0, dueSoon: 0, valid: 0 };
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
      await Promise.all(
        quickLinks.map(async (item) => {
          if (!item.collection || !canViewSection(item.permission)) return;
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
            snapshot.docs.forEach((entry) => {
              const data = entry.data();
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
              if (kind === 'expired') nextAlerts.expired += 1;
              if (kind === 'dueSoon') nextAlerts.dueSoon += 1;
              if (kind === 'valid') nextAlerts.valid += 1;

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
      if (!isMountedRef.current) return;
      setCounts(nextCounts);
      setAlertSummary(nextAlerts);
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

  const visibleQuickLinks = useMemo(
    () => quickLinks.filter((item) => canViewSection(item.permission)),
    [canViewSection]
  );
  const canViewReports = can('View', 'Vehicle Management.Reports');
  const canViewHealth =
    can('View', 'Vehicle Management.Vehicle Master') ||
    can('Add', 'Vehicle Management.Vehicle Master') ||
    can('Edit', 'Vehicle Management.Vehicle Master') ||
    can('View', 'Vehicle Management.Overview');
  const visibleWorkflowLinks = useMemo(
    () => workflowLinks.filter((item) => {
      if (item.label === 'Vehicle Health') return canViewHealth;
      if (item.label === 'Reports') return canViewReports;
      return true;
    }),
    [canViewHealth, canViewReports]
  );
  const totalVisibleRecords = useMemo(
    () => visibleQuickLinks.reduce((sum, item) => sum + (item.collection ? counts[item.collection] ?? 0 : 0), 0),
    [visibleQuickLinks, counts]
  );
  const totalAlerts = alertSummary.expired + alertSummary.dueSoon;

  const complianceChartData = useMemo(
    () =>
      expirySources
        .filter((source) => source.requirementKey && categoryBreakdown[source.label])
        .map((source) => ({ category: source.label, ...categoryBreakdown[source.label] })),
    [categoryBreakdown]
  );
  const totalMissing = useMemo(
    () => complianceChartData.reduce((sum, row) => sum + row.missing, 0),
    [complianceChartData]
  );

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden sm:space-y-4">
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-white/5 to-teal-500/10 animate-bb-gradient" />
        <div className="electric-scan-line top-8" />
        <CardHeader className="relative flex flex-row items-start justify-between gap-3 px-3 pb-1.5 pt-2.5 sm:p-3">
          <div className="min-w-0">
            <CardTitle className="text-base tracking-tight sm:text-xl">Vehicle Management</CardTitle>
            <CardDescription className="hidden text-xs sm:block">
              Fleet operations, compliance, driver activity, cost intelligence, and reports.
              {lastUpdated && <span className="ml-1">Updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
            </CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={isRefreshing} className="h-8 shrink-0 bg-white/80 px-2.5" aria-label="Refresh vehicle overview">
            <RefreshCw className={cn('h-3.5 w-3.5 sm:mr-1.5', isRefreshing && 'animate-spin')} /><span className="hidden sm:inline">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="relative grid grid-cols-3 gap-1.5 px-2.5 pb-2.5 sm:px-3 sm:pb-3">
          <div className="rounded-lg border border-emerald-100/70 bg-white/80 p-2 shadow-sm">
            <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">Modules</p>
            <p className="mt-0.5 text-base font-semibold sm:text-xl">{visibleQuickLinks.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-100/70 bg-white/80 p-2 shadow-sm">
            <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">Records</p>
            <p className="mt-0.5 text-base font-semibold sm:text-xl">{isLoading ? '...' : totalVisibleRecords}</p>
          </div>
          <div className="rounded-lg border border-emerald-100/70 bg-white/80 p-2 shadow-sm">
            <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">Alerts</p>
            <p className="mt-0.5 text-base font-semibold sm:text-xl">{isLoading ? '...' : totalAlerts}</p>
            {syncFailures > 0 && <p className="mt-0.5 text-[9px] font-medium text-amber-700 sm:text-[10px]">Partial data · retry refresh</p>}
            <div className="mt-1.5 hidden flex-wrap gap-1 text-[10px] lg:flex">
              <Badge variant="destructive" className="shadow-sm">
                Expired: {alertSummary.expired}
              </Badge>
              <Badge className="bg-amber-500 text-white shadow-sm hover:bg-amber-600">
                Due Soon: {alertSummary.dueSoon}
              </Badge>
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
                Valid: {alertSummary.valid}
              </Badge>
            </div>
            {totalAlerts > 0 && (
              <Link
                href="/vehicle-management/renewals"
                className="mt-1 hidden items-center gap-1 text-xs font-semibold text-rose-600 transition-colors hover:text-rose-700 sm:mt-2 sm:flex"
              >
                <RefreshCw className="h-3 w-3" />
                View Renewals Hub
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reports & data — the dashboard leads with fleet compliance/status data, not navigation. */}
      <div className="grid min-w-0 gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Card className="vm-panel-strong overflow-hidden vm-reveal">
          <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
            <CardTitle className="text-sm">Fleet Compliance Overview</CardTitle>
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
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e1e0d9" />
                  <XAxis type="number" allowDecimals={false} fontSize={11} stroke="#898781" />
                  <YAxis type="category" dataKey="category" width={72} fontSize={12} stroke="#898781" tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
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
            <CardTitle className="text-sm">Fleet Status</CardTitle>
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
                  <Pie isAnimationActive={false} data={vehicleStatusBreakdown} dataKey="count" nameKey="status" innerRadius={48} outerRadius={82} paddingAngle={2}>
                    {vehicleStatusBreakdown.map((entry) => (
                      <Cell key={entry.status} fill={VEHICLE_STATUS_COLORS[entry.status] || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {(totalMissing > 0 || totalAlerts > 0) && !isLoading && (
        <Link
          href="/vehicle-management/renewals"
          className="flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3.5 py-2.5 text-sm shadow-sm transition-colors hover:bg-rose-50 sm:px-4"
        >
          <span className="flex items-center gap-2 font-medium text-rose-700">
            <RefreshCw className="h-4 w-4 shrink-0" />
            {alertSummary.expired} expired · {alertSummary.dueSoon} due soon · {totalMissing} missing across the fleet
          </span>
          <span className="shrink-0 text-xs font-semibold text-rose-600 underline underline-offset-2">Open Renewals Hub →</span>
        </Link>
      )}

      {/* Quick access — compact links, not the focal point of this page. */}
      <Card className="vm-panel-strong">
        <CardHeader className="px-3 py-2.5 sm:px-4 sm:py-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Access</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 px-3 pb-3 sm:px-4 sm:pb-4">
          {visibleWorkflowLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium shadow-sm ring-1 transition-transform hover:-translate-y-0.5', item.color)}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
              {item.label === 'Vehicle Health' && !isLoading && alertSummary.expired > 0 && (
                <Badge variant="destructive" className="h-4 px-1 text-[9px] leading-none">{alertSummary.expired}</Badge>
              )}
            </Link>
          ))}
          <span className="mx-1 my-1 w-px self-stretch bg-border" aria-hidden />
          {visibleQuickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium shadow-sm ring-1 transition-transform hover:-translate-y-0.5', item.color)}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {item.label}
              <span className="text-[10px] opacity-70 tabular-nums">{isLoading ? '…' : counts[item.collection ?? ''] ?? 0}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {visibleQuickLinks.length === 0 && (
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
