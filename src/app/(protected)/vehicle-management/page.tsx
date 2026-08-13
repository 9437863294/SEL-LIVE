'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  Activity,
  BadgeCheck,
  CarFront,
  FileArchive,
  Fuel,
  Gauge,
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CountCard = {
  label: string;
  description: string;
  href: string;
  collection: string;
  permission: string;
  icon: LucideIcon;
  gradient: string;
};

const cards: CountCard[] = [
  {
    label: 'Vehicle Master',
    description: 'Core profile and assignment details for every vehicle.',
    href: '/vehicle-management/vehicle-master',
    collection: VEHICLE_COLLECTIONS.vehicleMaster,
    permission: 'Vehicle Master',
    icon: CarFront,
    gradient: 'from-cyan-500/15 via-sky-500/10 to-blue-600/15',
  },
  {
    label: 'Insurance',
    description: 'Policy details, expiry and renewal tracking.',
    href: '/vehicle-management/insurance',
    collection: VEHICLE_COLLECTIONS.insurance,
    permission: 'Insurance Management',
    icon: Shield,
    gradient: 'from-emerald-500/15 via-teal-500/10 to-cyan-500/15',
  },
  {
    label: 'PUC',
    description: 'Pollution certificate validity and renewal.',
    href: '/vehicle-management/puc',
    collection: VEHICLE_COLLECTIONS.puc,
    permission: 'PUC Management',
    icon: Leaf,
    gradient: 'from-lime-500/15 via-emerald-500/10 to-green-500/15',
  },
  {
    label: 'Fitness',
    description: 'Fitness compliance, mainly for transport vehicles.',
    href: '/vehicle-management/fitness',
    collection: VEHICLE_COLLECTIONS.fitness,
    permission: 'Fitness Certificate Management',
    icon: BadgeCheck,
    gradient: 'from-violet-500/15 via-indigo-500/10 to-sky-500/15',
  },
  {
    label: 'Road Tax',
    description: 'Tax dues, validity and receipts.',
    href: '/vehicle-management/road-tax',
    collection: VEHICLE_COLLECTIONS.roadTax,
    permission: 'Road Tax Management',
    icon: Landmark,
    gradient: 'from-amber-500/15 via-orange-500/10 to-red-500/15',
  },
  {
    label: 'Permit',
    description: 'Transport permit validity and renewal.',
    href: '/vehicle-management/permit',
    collection: VEHICLE_COLLECTIONS.permit,
    permission: 'Permit Management',
    icon: ScrollText,
    gradient: 'from-indigo-500/15 via-blue-500/10 to-cyan-500/15',
  },
  {
    label: 'Maintenance',
    description: 'Service/repair history and cost tracking.',
    href: '/vehicle-management/maintenance',
    collection: VEHICLE_COLLECTIONS.maintenance,
    permission: 'Maintenance Management',
    icon: Wrench,
    gradient: 'from-rose-500/15 via-orange-500/10 to-amber-500/15',
  },
  {
    label: 'Fuel',
    description: 'Fuel cost, mileage and station-level entries.',
    href: '/vehicle-management/fuel',
    collection: VEHICLE_COLLECTIONS.fuel,
    permission: 'Fuel Management',
    icon: Fuel,
    gradient: 'from-sky-500/15 via-cyan-500/10 to-teal-500/15',
  },
  {
    label: 'Driver Master',
    description: 'Driver records, license validity and vehicle assignment.',
    href: '/vehicle-management/driver',
    collection: VEHICLE_COLLECTIONS.driver,
    permission: 'Driver Management',
    icon: User,
    gradient: 'from-blue-500/15 via-indigo-500/10 to-cyan-500/15',
  },
  {
    label: 'Trips',
    description: 'Live trip tracking, route logs, and trip lifecycle monitoring.',
    href: '/vehicle-management/trips',
    collection: VEHICLE_COLLECTIONS.trips,
    permission: 'Trip Management',
    icon: LocateFixed,
    gradient: 'from-blue-500/15 via-cyan-500/10 to-emerald-500/15',
  },
  {
    label: 'Settings',
    description: 'Configure trip tracking interval and driver location update behavior.',
    href: '/vehicle-management/settings',
    collection: VEHICLE_COLLECTIONS.settings,
    permission: 'Settings',
    icon: Settings,
    gradient: 'from-indigo-500/15 via-blue-500/10 to-cyan-500/15',
  },
  {
    label: 'Documents',
    description: 'Vehicle-wise folder and legal document records.',
    href: '/vehicle-management/documents',
    collection: VEHICLE_COLLECTIONS.documents,
    permission: 'Document Management',
    icon: FileArchive,
    gradient: 'from-slate-500/15 via-zinc-400/10 to-gray-500/15',
  },
];

const expirySources = [
  { collection: VEHICLE_COLLECTIONS.insurance, key: 'expiryDate', permission: 'Insurance Management', requirementKey: 'insurance' as const },
  { collection: VEHICLE_COLLECTIONS.puc, key: 'expiryDate', permission: 'PUC Management', requirementKey: 'puc' as const },
  { collection: VEHICLE_COLLECTIONS.fitness, key: 'expiryDate', permission: 'Fitness Certificate Management', requirementKey: 'fitness' as const },
  { collection: VEHICLE_COLLECTIONS.roadTax, key: 'validTill', permission: 'Road Tax Management', requirementKey: 'roadTax' as const },
  { collection: VEHICLE_COLLECTIONS.permit, key: 'validTill', permission: 'Permit Management', requirementKey: 'permit' as const },
  // Documents and driver licenses aren't covered by getVehicleComplianceRequirements (they
  // aren't tied to a vehicle-status rule the same way), so they're always evaluated as-is.
  { collection: VEHICLE_COLLECTIONS.documents, key: 'expiryDate', permission: 'Document Management', requirementKey: null },
  { collection: VEHICLE_COLLECTIONS.driver, key: 'licenseExpiryDate', permission: 'Driver Management', requirementKey: null },
] as const;

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
      let failureCount = 0;
      // Needed to know whether a compliance category even applies to a given vehicle
      // (e.g. Sold/Scrapped vehicles need no insurance/PUC/fitness/road tax/permit at all).
      let vehicleMap: Record<string, Record<string, any>> = {};
      try {
        const vehicleSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        vehicleMap = Object.fromEntries(vehicleSnap.docs.map((entry) => [entry.id, entry.data()]));
      } catch (error) {
        console.error('Failed to load vehicles for expiry alert filtering', error);
      }
      await Promise.all(
        cards.map(async (item) => {
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
            snapshot.docs.forEach((entry) => {
              const data = entry.data();
              if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
              if (source.requirementKey) {
                const vehicle = vehicleMap[String(data.vehicleId || '')];
                if (vehicle) {
                  const required: VehicleComplianceRequirements = getVehicleComplianceRequirements(vehicle);
                  if (!required[source.requirementKey]) return;
                }
              }
              const kind = classifyExpiry(data?.[source.key]);
              if (kind === 'expired') nextAlerts.expired += 1;
              if (kind === 'dueSoon') nextAlerts.dueSoon += 1;
              if (kind === 'valid') nextAlerts.valid += 1;
            });
          } catch (error) {
            console.error(`Failed to evaluate expiry alerts for ${source.collection}`, error);
            failureCount += 1;
          }
        })
      );
      if (!isMountedRef.current) return;
      setCounts(nextCounts);
      setAlertSummary(nextAlerts);
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

  const visibleCards = useMemo(
    () => cards.filter((item) => canViewSection(item.permission)),
    [canViewSection]
  );
  const canViewReports = can('View', 'Vehicle Management.Reports');
  const canViewHealth =
    can('View', 'Vehicle Management.Vehicle Master') ||
    can('Add', 'Vehicle Management.Vehicle Master') ||
    can('Edit', 'Vehicle Management.Vehicle Master') ||
    can('View', 'Vehicle Management.Overview');
  const totalVisibleRecords = useMemo(
    () => visibleCards.reduce((sum, item) => sum + (counts[item.collection] ?? 0), 0),
    [visibleCards, counts]
  );
  const totalAlerts = alertSummary.expired + alertSummary.dueSoon;

  return (
    <div className="min-w-0 space-y-3 overflow-x-hidden sm:space-y-4">
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-blue-500/10 animate-bb-gradient" />
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
          <div className="rounded-lg border border-cyan-100/70 bg-white/80 p-2 shadow-sm">
            <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">Modules</p>
            <p className="mt-0.5 text-base font-semibold sm:text-xl">{visibleCards.length}</p>
          </div>
          <div className="rounded-lg border border-cyan-100/70 bg-white/80 p-2 shadow-sm">
            <p className="text-[10px] leading-tight text-muted-foreground sm:text-xs">Records</p>
            <p className="mt-0.5 text-base font-semibold sm:text-xl">{isLoading ? '...' : totalVisibleRecords}</p>
          </div>
          <div className="rounded-lg border border-cyan-100/70 bg-white/80 p-2 shadow-sm">
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

      <div className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {visibleCards.map((item, idx) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block h-full min-w-0" aria-label={`Open ${item.label}`}>
              <Card
                className={cn(
                  'group relative h-full min-h-[4.75rem] min-w-0 overflow-hidden vm-panel transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)]',
                  'vm-reveal cursor-pointer active:scale-[0.98]'
                )}
                style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
              >
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80', item.gradient)} />

                {/* Mobile layout — its own isolated row, never shares flex sizing with the
                    desktop block below (that cross-contamination was the actual cause of the
                    title/count getting squeezed to nothing while the description overflowed). */}
                <div className="relative flex items-center gap-2.5 p-3 lg:hidden">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/80 shadow-sm ring-1 ring-cyan-100">
                    <Icon className="h-4 w-4 text-cyan-700 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate pr-0.5 text-[13px] font-semibold leading-tight text-card-foreground" title={item.label}>{item.label}</p>
                    <p className="mt-1 truncate text-[11px] leading-none text-muted-foreground">
                      {isLoading ? '…' : `${counts[item.collection] ?? 0} records`}
                    </p>
                  </div>
                </div>

                {/* Desktop layout — icon, label, description, and record count. */}
                <CardHeader className="relative hidden p-3 lg:block">
                  <div className="mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/80 shadow-sm ring-1 ring-cyan-100">
                    <Icon className="h-4 w-4 text-cyan-700 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <CardTitle className="truncate pr-0.5 text-sm" title={item.label}>{item.label}</CardTitle>
                  <CardDescription className="mt-1 line-clamp-1 text-[11px]">{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="relative hidden px-3 pb-3 lg:block">
                  {isLoading ? (
                    <Skeleton className="h-4 w-14" />
                  ) : (
                    <span className="text-xs sm:text-sm text-muted-foreground">
                      {counts[item.collection] ?? 0} records
                    </span>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {visibleCards.length === 0 && (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle>No Section Access</CardTitle>
            <CardDescription>You currently do not have permission to view vehicle sub-modules.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {canViewReports && (
        <Link href="/vehicle-management/reports" className="block" aria-label="Open reports">
          <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)]">
            <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
            <CardHeader className="p-2.5 sm:p-3">
              <CardTitle className="text-sm">Reports</CardTitle>
              <CardDescription className="hidden sm:block">Fuel cost, mileage, monthly trends, and project-wise cost analysis.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      )}

      {/* Quick-access banner row */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        <Link href="/vehicle-management/renewals" className="block" aria-label="Open Renewals Hub">
          <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(239,68,68,0.45)] active:scale-[0.98]">
            <div className="h-1 w-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-500" />
            <CardHeader className="flex flex-row items-center gap-2 p-2 sm:p-3">
              <div className="flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 shadow-sm ring-1 ring-rose-100">
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-rose-600" />
              </div>
              <div>
                <CardTitle className="text-xs sm:text-sm">Renewals Hub</CardTitle>
                <CardDescription className="hidden text-xs sm:block sm:text-sm">Expired &amp; due-soon compliance items. Take action instantly.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/vehicle-management/renewals/history" className="block" aria-label="Open Renewal History">
          <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(100,116,139,0.45)] active:scale-[0.98]">
            <div className="h-1 w-full bg-gradient-to-r from-slate-400 via-zinc-400 to-gray-400" />
            <CardHeader className="flex flex-row items-center gap-2 p-2 sm:p-3">
              <div className="flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 shadow-sm ring-1 ring-slate-100">
                <History className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-600" />
              </div>
              <div>
                <CardTitle className="text-xs sm:text-sm">Renewal History</CardTitle>
                <CardDescription className="hidden text-xs sm:block sm:text-sm">Archive of expired PUC, Insurance, DL, Fitness, Road Tax &amp; Permit.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
        {canViewHealth && (
          <Link href="/vehicle-management/vehicle-health" className="block" aria-label="Open Vehicle Health Dashboard">
            <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(6,182,212,0.45)] active:scale-[0.98]">
              <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-600" />
              <CardHeader className="flex flex-row items-center gap-2 p-2 sm:p-3">
                <div className="flex h-7 w-7 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 shadow-sm ring-1 ring-cyan-100">
                  <Activity className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-cyan-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xs sm:text-sm">Vehicle Health</CardTitle>
                    {!isLoading && alertSummary.expired > 0 && (
                      <Badge variant="destructive" className="text-[10px] shadow-sm">
                        {alertSummary.expired} expired
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="hidden items-center gap-1 sm:flex">
                    <Gauge className="h-3 w-3 shrink-0" />
                    Compliance scores &amp; grade per vehicle.
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
