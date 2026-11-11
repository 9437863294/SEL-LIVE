'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, getCountFromServer, getDocs, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Clock,
  Fuel,
  Gauge,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS, type VehicleComplianceRequirements } from '@/lib/vehicle-management';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';
import { VM_SEGMENT_TRACK, vmSegmentItem, type VmTone } from '@/components/vehicle-management/vm-ui';
import {
  VM_PANEL,
  VM_STATUS_INK,
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

// The registers whose sizes the fleet cards report. Navigation is the sidebar's job (and the
// phone's bottom bar), so the page no longer repeats it as a row of link chips.
const registers = [
  { label: 'Vehicles', collection: VEHICLE_COLLECTIONS.vehicleMaster, permission: 'Vehicle Master' },
  { label: 'Drivers', collection: VEHICLE_COLLECTIONS.driver, permission: 'Driver Management' },
] as const;

const formatInr = (amount: number, fractionDigits = 0) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: fractionDigits }).format(amount || 0);

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

// Each entry with a requirementKey feeds the "Fleet compliance overview" table (per-vehicle
// requirement-aware); Documents/Driver License aren't covered by getVehicleComplianceRequirements
// so they only feed the expired/due-soon counts, not the per-category table.
const expirySources = [
  { label: 'Insurance', collection: VEHICLE_COLLECTIONS.insurance, key: 'expiryDate', permission: 'Insurance Management', requirementKey: 'insurance' as const, href: '/vehicle-management/insurance' },
  { label: 'PUC', collection: VEHICLE_COLLECTIONS.puc, key: 'expiryDate', permission: 'PUC Management', requirementKey: 'puc' as const, href: '/vehicle-management/puc' },
  { label: 'Fitness', collection: VEHICLE_COLLECTIONS.fitness, key: 'expiryDate', permission: 'Fitness Certificate Management', requirementKey: 'fitness' as const, href: '/vehicle-management/fitness' },
  { label: 'Road Tax', collection: VEHICLE_COLLECTIONS.roadTax, key: 'validTill', permission: 'Road Tax Management', requirementKey: 'roadTax' as const, href: '/vehicle-management/road-tax' },
  { label: 'Permit', collection: VEHICLE_COLLECTIONS.permit, key: 'validTill', permission: 'Permit Management', requirementKey: 'permit' as const, href: '/vehicle-management/permit' },
  { label: 'Documents', collection: VEHICLE_COLLECTIONS.documents, key: 'expiryDate', permission: 'Document Management', requirementKey: null, href: '/vehicle-management/documents' },
  { label: 'Driver License', collection: VEHICLE_COLLECTIONS.driver, key: 'licenseExpiryDate', permission: 'Driver Management', requirementKey: null, href: '/vehicle-management/driver' },
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

// ─── Look ─────────────────────────────────────────────────────────────────────
// Cards, tints, the header and its alert strip come from vm-dashboard, shared with the Renewals Hub.

type Tone = keyof typeof VM_STATUS_INK;
const TONE_HEX: Record<Tone, string> = { emerald: STATUS_COLORS.valid, amber: STATUS_COLORS.dueSoon, rose: STATUS_COLORS.expired };

/** One rule for every compliance percentage on the page — the headline card and each category row. */
const complianceTone = (percent: number): Tone => (percent >= 90 ? 'emerald' : percent >= 70 ? 'amber' : 'rose');

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

// Literal class names, so Tailwind generates them.
const KPI_GRID_XL: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]',
};
const MONTH_GRID_XL: Record<number, string> = { 1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4' };

/**
 * Where a fleet card sits. Phone: two across, an odd first card spanning the row. From `md`: a
 * six-column grid, so five cards sit three over two with no hole. From `xl`: one row.
 */
function kpiSpan(index: number, count: number) {
  const phone = count % 2 === 1 && index === 0 ? 'col-span-2' : '';
  const md =
    count === 5 ? (index < 3 ? 'md:col-span-2' : 'md:col-span-3') : count === 3 ? 'md:col-span-2' : count === 1 ? 'md:col-span-6' : 'md:col-span-3';
  return cn(phone, md, 'xl:col-span-1');
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

type FleetCard = { key: string; label: string; icon: LucideIcon; tint: VmTone; body: ReactNode };

function KpiCard({ card, className }: { card: FleetCard; className?: string }) {
  return (
    <div className={cn(VM_PANEL, 'min-w-0 p-4', className)}>
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <VmIconTile icon={card.icon} tint={card.tint} />
        <span className="truncate">{card.label}</span>
      </div>
      {card.body}
    </div>
  );
}

const KpiValue = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn('mt-2.5 truncate text-[28px] font-extrabold leading-9 tracking-tight tabular-nums', className)}>{children}</div>
);
const KpiHint = ({ children }: { children: ReactNode }) => <div className="mt-0.5 text-xs text-muted-foreground">{children}</div>;

function ComplianceRing({ percent, color }: { percent: number; color: string }) {
  const size = 64;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`${percent}% compliant`}>
      <circle cx={centre} cy={centre} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
      {percent > 0 && (
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(circumference * Math.min(percent, 100)) / 100} ${circumference}`}
          transform={`rotate(-90 ${centre} ${centre})`}
        />
      )}
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-foreground text-sm font-extrabold">
        {percent}%
      </text>
    </svg>
  );
}

/** Valid · due soon · expired · missing as one proportional bar. */
function StatusBar({ bucket, className }: { bucket: CategoryBucket; className?: string }) {
  const total = bucket.valid + bucket.dueSoon + bucket.expired + bucket.missing;
  const parts = [
    { value: bucket.valid, color: STATUS_COLORS.valid },
    { value: bucket.dueSoon, color: STATUS_COLORS.dueSoon },
    { value: bucket.expired, color: STATUS_COLORS.expired },
    { value: bucket.missing, color: STATUS_COLORS.missing },
  ];
  return (
    <div
      className={cn('flex h-3 min-w-[180px] overflow-hidden rounded-full bg-muted', className)}
      title={`Valid ${bucket.valid} · Due soon ${bucket.dueSoon} · Expired ${bucket.expired} · Missing ${bucket.missing}`}
    >
      {parts.map((part, index) =>
        part.value > 0 ? (
          <i key={index} className="block h-full transition-[width] duration-500" style={{ width: `${share(part.value, total)}%`, background: part.color }} />
        ) : null,
      )}
    </div>
  );
}

function CountPill({ value, tint }: { value: number; tint: VmTone }) {
  if (!value) return <span className="font-medium text-muted-foreground">0</span>;
  return (
    <span className={cn('inline-grid h-6 min-w-[30px] place-items-center rounded-full px-2 text-[12.5px] font-bold tabular-nums', VM_TINT[tint])}>{value}</span>
  );
}

type StatusRow = { status: string; count: number };

/** Fleet status as a donut; hovering a row in the list (or a segment) singles it out. */
function StatusDonut({ rows, total, active, onActive }: { rows: StatusRow[]; total: number; active: string | null; onActive: (status: string | null) => void }) {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const gap = rows.length > 1 ? 2 : 0;
  const focused = rows.find((row) => row.status === active);
  // Each segment's arc length and where it starts along the ring, measured from 12 o'clock.
  const segments = rows.map((row, index) => ({
    row,
    length: (row.count / total) * circumference,
    offset: rows.slice(0, index).reduce((sum, before) => sum + (before.count / total) * circumference, 0),
  }));
  return (
    <svg viewBox="0 0 190 190" className="h-[170px] w-[170px] shrink-0 sm:h-[190px] sm:w-[190px]" role="img" aria-label={`${total} vehicles by status`}>
      <circle cx="95" cy="95" r={radius} fill="none" strokeWidth="22" className="stroke-muted" />
      {segments.map(({ row, length, offset }) => (
          <circle
            key={row.status}
            cx="95"
            cy="95"
            r={radius}
            fill="none"
            stroke={VEHICLE_STATUS_COLORS[row.status] || '#64748b'}
            strokeWidth="22"
            strokeDasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 95 95)"
            className="cursor-pointer transition-opacity duration-200"
            style={{ opacity: active && active !== row.status ? 0.25 : 1 }}
            onMouseEnter={() => onActive(row.status)}
            onMouseLeave={() => onActive(null)}
          >
            <title>{`${row.status}: ${row.count}`}</title>
          </circle>
      ))}
      <text x="95" y="90" textAnchor="middle" className="fill-foreground text-[30px] font-extrabold tabular-nums">
        {focused ? focused.count : total}
      </text>
      <text x="95" y="112" textAnchor="middle" className="fill-muted-foreground text-xs">
        {focused ? focused.status : 'vehicles'}
      </text>
    </svg>
  );
}

type SortMode = 'default' | 'risk';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function VehicleManagementOverviewPage() {
  const router = useRouter();
  const { can } = useAuthorization();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncFailures, setSyncFailures] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Expired and due-soon items by the Renewals Hub's own rules, so the page's counts match that page.
  const [urgentItems, setUrgentItems] = useState<RenewalItem[]>([]);
  const [monthFigures, setMonthFigures] = useState<MonthFigures | null>(null);
  const [categoryBreakdown, setCategoryBreakdown] = useState<Record<string, CategoryBucket>>({});
  const [vehicleStatusBreakdown, setVehicleStatusBreakdown] = useState<StatusRow[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [activeStatus, setActiveStatus] = useState<string | null>(null);
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
  const totalVehicles = useMemo(() => vehicleStatusBreakdown.reduce((sum, row) => sum + row.count, 0), [vehicleStatusBreakdown]);
  const activeVehicles = vehicleStatusBreakdown.find((row) => row.status === 'Active')?.count ?? 0;

  const complianceRows = useMemo(
    () =>
      expirySources
        .filter((source) => source.requirementKey && categoryBreakdown[source.label])
        .map((source) => {
          const bucket = categoryBreakdown[source.label];
          const total = bucket.valid + bucket.dueSoon + bucket.expired + bucket.missing;
          return { category: source.label, href: source.href, bucket, total, percent: share(bucket.valid + bucket.dueSoon, total) };
        }),
    [categoryBreakdown]
  );

  const sortedComplianceRows = useMemo(
    () =>
      sortMode === 'risk'
        ? [...complianceRows].sort((a, b) => a.percent - b.percent || b.bucket.expired - a.bucket.expired)
        : complianceRows,
    [complianceRows, sortMode]
  );

  // Compliant = every required category currently covered (valid or due soon — not yet lapsed), out of
  // every requirement the fleet has, missing records included. Same buckets as the compliance table.
  const compliance = useMemo(() => {
    const bucket = complianceRows.reduce<CategoryBucket>(
      (sum, row) => ({
        valid: sum.valid + row.bucket.valid,
        dueSoon: sum.dueSoon + row.bucket.dueSoon,
        expired: sum.expired + row.bucket.expired,
        missing: sum.missing + row.bucket.missing,
      }),
      { valid: 0, dueSoon: 0, expired: 0, missing: 0 }
    );
    const covered = bucket.valid + bucket.dueSoon;
    const required = covered + bucket.expired + bucket.missing;
    return { bucket, covered, required, missing: bucket.missing, percent: required > 0 ? Math.round((covered / required) * 100) : null };
  }, [complianceRows]);

  const pending = (value: ReactNode) => (isLoading ? <Skeleton className="mt-3 h-7 w-20" /> : value);

  // ── Alert strip: what needs doing, each a way into the page that does it — the Renewals Hub
  // opens already filtered to the tile's status.
  const alertTiles: VmAlertTile[] = [
    {
      key: 'expired',
      count: isLoading ? '…' : expiredCount,
      title: 'Documents expired',
      hint: expiredCount > 0 ? 'Vehicles should not run until renewed' : 'Nothing has lapsed',
      tint: !isLoading && expiredCount > 0 ? 'rose' : 'slate',
      href: '/vehicle-management/renewals?status=expired',
    },
    {
      key: 'due',
      count: isLoading ? '…' : dueSoonCount,
      title: 'Due in the next 30 days',
      hint: dueSoonCount > 0 ? 'Plan renewals now' : 'Nothing due this month',
      tint: !isLoading && dueSoonCount > 0 ? 'amber' : 'slate',
      href: '/vehicle-management/renewals?status=dueSoon',
    },
    ...(isLoading || compliance.percent !== null
      ? [
          {
            key: 'missing',
            count: isLoading ? '…' : compliance.missing,
            title: 'Records missing',
            hint: compliance.missing > 0 ? 'Add the missing documents per vehicle' : 'Every required document is on file',
            tint: 'slate',
            href: canViewSection('Vehicle Master') ? '/vehicle-management/vehicle-health' : undefined,
          } satisfies VmAlertTile,
        ]
      : []),
  ];

  // ── Fleet cards: only the registers this user can open; the renewal figures cover whatever they can see.
  const vehicleCount = counts[VEHICLE_COLLECTIONS.vehicleMaster] ?? 0;
  const driverCount = counts[VEHICLE_COLLECTIONS.driver] ?? 0;
  const notActive = Math.max(totalVehicles - activeVehicles, 0);
  const complianceToneNow = compliance.percent === null ? 'emerald' : complianceTone(compliance.percent);
  const perDriver = driverCount > 0 ? Math.round((activeVehicles / driverCount) * 10) / 10 : null;

  const fleetCards: FleetCard[] = [
    ...(canViewSection('Vehicle Master')
      ? [
          {
            key: 'vehicles',
            label: 'Vehicles',
            icon: Truck,
            tint: 'violet',
            body: (
              <>
                {pending(<KpiValue>{vehicleCount}</KpiValue>)}
                {!isLoading && (
                  <>
                    <KpiHint>
                      {activeVehicles} active · {notActive} not active
                    </KpiHint>
                    <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <i className="block h-full bg-emerald-500" style={{ width: `${share(activeVehicles, totalVehicles)}%` }} />
                      <i className="block h-full bg-slate-400" style={{ width: `${share(notActive, totalVehicles)}%` }} />
                    </div>
                  </>
                )}
              </>
            ),
          } satisfies FleetCard,
        ]
      : []),
    ...(canViewSection('Driver Management')
      ? [
          {
            key: 'drivers',
            label: 'Drivers',
            icon: User,
            tint: 'blue',
            body: (
              <>
                {pending(<KpiValue>{driverCount}</KpiValue>)}
                {!isLoading && (
                  <KpiHint>
                    {driverCount === 0
                      ? 'No drivers registered yet'
                      : canViewSection('Vehicle Master') && perDriver !== null
                        ? `${perDriver.toLocaleString('en-IN')} active vehicles per driver`
                        : 'In the Driver Master'}
                  </KpiHint>
                )}
              </>
            ),
          } satisfies FleetCard,
        ]
      : []),
    ...(isLoading || compliance.percent !== null
      ? [
          {
            key: 'compliance',
            label: 'Compliance',
            icon: ShieldCheck,
            tint: isLoading ? 'slate' : complianceToneNow,
            body: isLoading ? (
              <Skeleton className="mt-2 h-16 w-full" />
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
                <ComplianceRing percent={compliance.percent ?? 0} color={TONE_HEX[complianceToneNow]} />
                <div className="min-w-0 text-xs text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground tabular-nums">{compliance.covered}</span> of{' '}
                    <span className="tabular-nums">{compliance.required}</span> covered
                  </div>
                  <div>{compliance.missing > 0 ? `${compliance.missing} records missing` : 'Nothing missing'}</div>
                </div>
              </div>
            ),
          } satisfies FleetCard,
        ]
      : []),
    {
      key: 'expired',
      label: 'Expired',
      icon: AlertTriangle,
      tint: 'rose',
      body: (
        <>
          {pending(<KpiValue className={expiredCount > 0 ? VM_STATUS_INK.rose : undefined}>{expiredCount}</KpiValue>)}
          {!isLoading && <KpiHint>{expiredCount > 0 ? 'Renew immediately' : 'All current'}</KpiHint>}
        </>
      ),
    },
    {
      key: 'due',
      label: 'Due in 30 days',
      icon: Clock,
      tint: 'amber',
      body: (
        <>
          {pending(<KpiValue className={dueSoonCount > 0 ? VM_STATUS_INK.amber : undefined}>{dueSoonCount}</KpiValue>)}
          {!isLoading && <KpiHint>{dueSoonCount > 0 ? 'Upcoming renewals' : 'Nothing due soon'}</KpiHint>}
        </>
      ),
    },
  ];

  // ── This month's running figures; each is left out when the user can't see its register.
  const month = monthFigures;
  const runningCost = (month?.fuelSpend ?? 0) + (month?.maintenanceSpend ?? 0);
  const bothCostsKnown = month?.fuelSpend != null && month?.maintenanceSpend != null;
  const costShare = (value: number) => `${Math.round(share(value, runningCost))}% of running cost`;

  type MonthCard = { key: string; label: string; icon: LucideIcon; tint: VmTone; value: ReactNode; zero: boolean; hint?: string };
  const monthCards: MonthCard[] = [
    ...(isLoading || month?.fuelSpend != null
      ? [{
          key: 'fuel',
          label: 'Fuel spend',
          icon: Fuel,
          tint: 'orange' as const,
          value: formatInr(month?.fuelSpend ?? 0),
          zero: !month?.fuelSpend,
          hint: !month?.fuelSpend ? 'No fuel logged yet this month' : bothCostsKnown && runningCost > 0 ? costShare(month.fuelSpend) : undefined,
        }]
      : []),
    ...(isLoading || month?.maintenanceSpend != null
      ? [{
          key: 'maintenance',
          label: 'Maintenance spend',
          icon: Wrench,
          tint: 'blue' as const,
          value: formatInr(month?.maintenanceSpend ?? 0),
          zero: !month?.maintenanceSpend,
          hint: !month?.maintenanceSpend ? 'No services logged yet this month' : bothCostsKnown && runningCost > 0 ? costShare(month.maintenanceSpend) : undefined,
        }]
      : []),
    ...(isLoading || month?.trips != null
      ? [{
          key: 'trips',
          label: 'Trips',
          icon: Route,
          tint: 'emerald' as const,
          value: (month?.trips ?? 0).toLocaleString('en-IN'),
          zero: !month?.trips,
          hint: month?.onTripNow
            ? `${month.onTripNow} on the road now`
            : month?.trips
              ? `${Math.round((month.distanceKm ?? 0) / month.trips).toLocaleString('en-IN')} km per trip on average`
              : 'No trips logged yet this month',
        }]
      : []),
    ...(isLoading || month?.distanceKm != null
      ? [{
          key: 'distance',
          label: 'Distance',
          icon: Gauge,
          tint: 'violet' as const,
          value: `${Math.round(month?.distanceKm ?? 0).toLocaleString('en-IN')} km`,
          zero: !month?.distanceKm,
          hint: !month?.distanceKm
            ? 'Cost per km appears once trips are logged'
            : runningCost > 0
              ? `${formatInr(runningCost / month.distanceKm, 2)} running cost per km`
              : undefined,
        }]
      : []),
  ];
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden">
      {/* Header, with what needs doing right under it. */}
      <VmPageHero
        icon={Truck}
        title="Vehicle Management"
        description="Fleet operations, compliance, driver activity, cost intelligence and reports."
        status={<VmSyncStatus isLoading={isLoading} partial={syncFailures > 0} updatedAt={lastUpdated} />}
        actions={
          <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={isRefreshing} className="shrink-0 gap-1.5 font-semibold" aria-label="Refresh vehicle overview">
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        }
      >
        {hasAnySection && <VmAlertStrip tiles={alertTiles} />}
      </VmPageHero>

      {!hasAnySection && (
        <section className={cn(VM_PANEL, 'px-5 py-6')}>
          <h2 className="text-[15px] font-bold">No section access</h2>
          <p className="mt-1 text-sm text-muted-foreground">You currently do not have permission to view vehicle sub-modules.</p>
        </section>
      )}

      {/* Essentials, before any chart: the fleet and its compliance, then this month's running figures. */}
      {hasAnySection && (
        <section aria-labelledby="vm-fleet-heading" className="space-y-2">
          <VmSectionLabel id="vm-fleet-heading">Fleet</VmSectionLabel>
          <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-6', KPI_GRID_XL[fleetCards.length])}>
            {fleetCards.map((card, index) => (
              <KpiCard key={card.key} card={card} className={kpiSpan(index, fleetCards.length)} />
            ))}
          </div>
        </section>
      )}

      {monthCards.length > 0 && (
        <section aria-labelledby="vm-month-heading" className="space-y-2">
          <VmSectionLabel id="vm-month-heading">This month · {monthName}</VmSectionLabel>
          <div
            className={cn(
              'grid grid-cols-2 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2 xl:[&>*:last-child:nth-child(odd)]:col-span-1',
              MONTH_GRID_XL[monthCards.length],
            )}
          >
            {monthCards.map((card) => (
              <div key={card.key} className={cn(VM_PANEL, 'flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-3.5')}>
                <VmIconTile icon={card.icon} tint={card.tint} size="lg" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-muted-foreground">{card.label}</div>
                  {isLoading ? (
                    <Skeleton className="mt-1.5 h-6 w-24" />
                  ) : (
                    <>
                      <div className={cn('mt-0.5 truncate text-[22px] font-extrabold leading-7 tabular-nums', card.zero && 'text-muted-foreground')}>{card.value}</div>
                      {card.hint && <div className="text-[11.5px] text-muted-foreground">{card.hint}</div>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasAnySection && (
        <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[1.7fr_1fr]">
          {/* Compliance per category: a table, so each number can be read, with the proportions as a bar. */}
          <section aria-labelledby="vm-compliance-heading" className={cn(VM_PANEL, 'min-w-0 overflow-hidden')}>
            <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3.5 sm:px-[18px]">
              <div className="min-w-0 flex-1 basis-64">
                <h2 id="vm-compliance-heading" className="text-[15px] font-bold">Fleet compliance overview</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Valid, due-soon, expired and missing per category. Vehicles that don&apos;t need a category (Sold, Scrapped, etc.) are excluded.
                </p>
              </div>
              {complianceRows.length > 1 && (
                <div role="group" aria-label="Sort categories" className={VM_SEGMENT_TRACK}>
                  {(
                    [
                      ['default', 'Default'],
                      ['risk', 'Most at risk'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button key={mode} type="button" aria-pressed={sortMode === mode} className={vmSegmentItem(sortMode === mode)} onClick={() => setSortMode(mode)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-2.5 p-4">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : complianceRows.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">No compliance data to show yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="bg-muted/50 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                        <th className="border-b border-border px-3.5 py-2.5 font-bold">Category</th>
                        <th className="border-b border-border px-3.5 py-2.5 font-bold">Status</th>
                        <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Valid</th>
                        <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Due soon</th>
                        <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Expired</th>
                        <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Missing</th>
                        <th className="border-b border-border px-3.5 py-2.5 text-right font-bold">Compliant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedComplianceRows.map((row) => (
                        <tr
                          key={row.category}
                          className="cursor-pointer transition-colors hover:bg-muted/40"
                          onClick={(event) => {
                            // The name is a real link (keyboard, middle-click); the rest of the row follows it.
                            if ((event.target as HTMLElement).closest('a')) return;
                            router.push(row.href);
                          }}
                        >
                          <td className="border-b border-border/60 px-3.5 py-3">
                            <Link href={row.href} className="font-bold text-foreground no-underline hover:underline">
                              {row.category}
                            </Link>
                            <span className="block text-[11.5px] font-medium text-muted-foreground">{row.total} required</span>
                          </td>
                          <td className="border-b border-border/60 px-3.5 py-3">
                            <StatusBar bucket={row.bucket} />
                          </td>
                          <td className="border-b border-border/60 px-3.5 py-3 text-right"><CountPill value={row.bucket.valid} tint="emerald" /></td>
                          <td className="border-b border-border/60 px-3.5 py-3 text-right"><CountPill value={row.bucket.dueSoon} tint="amber" /></td>
                          <td className="border-b border-border/60 px-3.5 py-3 text-right"><CountPill value={row.bucket.expired} tint="rose" /></td>
                          <td className="border-b border-border/60 px-3.5 py-3 text-right"><CountPill value={row.bucket.missing} tint="slate" /></td>
                          <td className={cn('border-b border-border/60 px-3.5 py-3 text-right font-extrabold tabular-nums', VM_STATUS_INK[complianceTone(row.percent)])}>
                            {Math.round(row.percent)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {complianceRows.length > 1 && (
                      <tfoot>
                        <tr className="bg-muted/50 font-extrabold tabular-nums">
                          <td className="border-t border-border px-3.5 py-3">
                            All categories
                            <span className="block text-[11.5px] font-medium text-muted-foreground">{compliance.required} required</span>
                          </td>
                          <td className="border-t border-border px-3.5 py-3">
                            <StatusBar bucket={compliance.bucket} />
                          </td>
                          <td className="border-t border-border px-3.5 py-3 text-right">{compliance.bucket.valid}</td>
                          <td className="border-t border-border px-3.5 py-3 text-right">{compliance.bucket.dueSoon}</td>
                          <td className={cn('border-t border-border px-3.5 py-3 text-right', compliance.bucket.expired > 0 && VM_STATUS_INK.rose)}>{compliance.bucket.expired}</td>
                          <td className="border-t border-border px-3.5 py-3 text-right">{compliance.bucket.missing}</td>
                          <td className={cn('border-t border-border px-3.5 py-3 text-right', VM_STATUS_INK[complianceToneNow])}>{compliance.percent ?? 0}%</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-xs text-muted-foreground sm:px-[18px]">
                  {(
                    [
                      ['Valid', STATUS_COLORS.valid],
                      ['Due soon (30 days)', STATUS_COLORS.dueSoon],
                      ['Expired', STATUS_COLORS.expired],
                      ['Missing', STATUS_COLORS.missing],
                    ] as const
                  ).map(([label, color]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                  <span className="sm:ml-auto">Compliant = valid + due soon</span>
                </div>
              </>
            )}
          </section>

          {/* Fleet status: the Vehicle Master's status split. */}
          <section aria-labelledby="vm-status-heading" className={cn(VM_PANEL, 'min-w-0 overflow-hidden')}>
            <div className="border-b border-border px-4 py-3.5 sm:px-[18px]">
              <h2 id="vm-status-heading" className="text-[15px] font-bold">Fleet status</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Vehicle Master status distribution</p>
            </div>
            {isLoading ? (
              <div className="flex flex-col items-center gap-4 p-[18px]">
                <Skeleton className="h-[170px] w-[170px] rounded-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : totalVehicles === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">No vehicles yet.</p>
            ) : (
              <div className="flex flex-col items-center gap-4 p-[18px] md:flex-row xl:flex-col">
                <StatusDonut rows={vehicleStatusBreakdown} total={totalVehicles} active={activeStatus} onActive={setActiveStatus} />
                <ul className="grid w-full gap-2">
                  {vehicleStatusBreakdown.map((row) => (
                    <li
                      key={row.status}
                      onMouseEnter={() => setActiveStatus(row.status)}
                      onMouseLeave={() => setActiveStatus(null)}
                      className={cn(
                        'grid grid-cols-[auto_1fr_auto_auto] items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-[13px] transition-colors',
                        activeStatus === row.status ? 'border-border bg-muted/60' : 'border-border/60',
                      )}
                    >
                      <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: VEHICLE_STATUS_COLORS[row.status] || '#64748b' }} />
                      <span className="truncate">{row.status}</span>
                      <b className="tabular-nums">{row.count}</b>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{share(row.count, totalVehicles).toFixed(1)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
