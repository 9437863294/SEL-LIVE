'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getCountFromServer, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  BadgeCheck,
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
import { Badge } from '@/components/ui/badge';
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
  { collection: VEHICLE_COLLECTIONS.insurance, key: 'expiryDate', permission: 'Insurance Management' },
  { collection: VEHICLE_COLLECTIONS.puc, key: 'expiryDate', permission: 'PUC Management' },
  { collection: VEHICLE_COLLECTIONS.fitness, key: 'expiryDate', permission: 'Fitness Certificate Management' },
  { collection: VEHICLE_COLLECTIONS.roadTax, key: 'validTill', permission: 'Road Tax Management' },
  { collection: VEHICLE_COLLECTIONS.permit, key: 'validTill', permission: 'Permit Management' },
  { collection: VEHICLE_COLLECTIONS.documents, key: 'expiryDate', permission: 'Document Management' },
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
      if (!firstLoadDoneRef.current) setIsLoading(true);
      try {
      const nextCounts: Record<string, number> = {};
      const nextAlerts = { expired: 0, dueSoon: 0, valid: 0 };
      await Promise.all(
        cards.map(async (item) => {
          if (!canViewSection(item.permission)) return;
          try {
            const snapshot = await getCountFromServer(collection(db, item.collection));
            nextCounts[item.collection] = snapshot.data().count;
          } catch (error) {
            console.error(`Failed count for ${item.collection}`, error);
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
              const kind = classifyExpiry(entry.data()?.[source.key]);
              if (kind === 'expired') nextAlerts.expired += 1;
              if (kind === 'dueSoon') nextAlerts.dueSoon += 1;
              if (kind === 'valid') nextAlerts.valid += 1;
            });
          } catch (error) {
            console.error(`Failed to evaluate expiry alerts for ${source.collection}`, error);
          }
        })
      );
      if (!isMountedRef.current) return;
      setCounts(nextCounts);
      setAlertSummary(nextAlerts);
      firstLoadDoneRef.current = true;
      setIsLoading(false);
      } finally {
        isSyncingRef.current = false;
      }
  }, [canViewSection]);

  useEffect(() => {
    isMountedRef.current = true;
    load();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }, 1000);

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
  const totalVisibleRecords = useMemo(
    () => visibleCards.reduce((sum, item) => sum + (counts[item.collection] ?? 0), 0),
    [visibleCards, counts]
  );
  const totalAlerts = alertSummary.expired + alertSummary.dueSoon;

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden vm-panel-strong vm-reveal">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-blue-500/10 animate-bb-gradient" />
        <div className="electric-scan-line top-8" />
        <CardHeader className="relative">
          <CardTitle className="text-2xl tracking-tight">Vehicle Management</CardTitle>
          <CardDescription>
            Separate pages with sidebar navigation, expiry intelligence, and a modern command-center view.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Visible Modules</p>
            <p className="mt-1 text-2xl font-semibold">{visibleCards.length}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Total Records</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : totalVisibleRecords}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/80 p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Compliance Alerts</p>
            <p className="mt-1 text-2xl font-semibold">{isLoading ? '...' : totalAlerts}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
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
                className="mt-2 flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                View Renewals Hub
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleCards.map((item, idx) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block h-full" aria-label={`Open ${item.label}`}>
              <Card
                className={cn(
                  'group relative h-full overflow-hidden vm-panel transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)]',
                  'vm-reveal cursor-pointer'
                )}
                style={{ animationDelay: `${Math.min(idx * 45, 240)}ms` }}
              >
                <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80', item.gradient)} />
                <CardHeader className="relative">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-cyan-100">
                    <Icon className="h-5 w-5 text-cyan-700 transition-transform duration-300 group-hover:scale-110" />
                  </div>
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="relative">
                  {isLoading ? (
                    <Skeleton className="h-6 w-20" />
                  ) : (
                    <span className="text-sm text-muted-foreground">
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
            <CardHeader>
              <CardTitle className="text-lg">Reports</CardTitle>
              <CardDescription>Fuel cost, mileage, monthly trends, and project-wise cost analysis.</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      )}

      {/* Renewals Hub quick-access banner */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/vehicle-management/renewals" className="block" aria-label="Open Renewals Hub">
          <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(239,68,68,0.45)]">
            <div className="h-1 w-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-500" />
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 shadow-sm ring-1 ring-rose-100">
                <RefreshCw className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Renewals Hub</CardTitle>
                <CardDescription>All expired &amp; due-soon compliance items in one place. Take renewal action instantly.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/vehicle-management/renewals/history" className="block" aria-label="Open Renewal History">
          <Card className="vm-panel-strong overflow-hidden vm-reveal cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(100,116,139,0.45)]">
            <div className="h-1 w-full bg-gradient-to-r from-slate-400 via-zinc-400 to-gray-400" />
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 shadow-sm ring-1 ring-slate-100">
                <History className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Renewal History</CardTitle>
                <CardDescription>Archive of all expired PUC, Insurance, DL, Fitness, Road Tax &amp; Permit records.</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
