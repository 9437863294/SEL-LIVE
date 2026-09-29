'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgeCheck,
  Landmark,
  Leaf,
  RefreshCw,
  ScrollText,
  Shield,
} from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { getVehicleComplianceRequirements, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { VM_SEGMENT_TRACK, VM_TONES, VmStatStrip, vmSegmentItem, type VmTone } from '@/components/vehicle-management/vm-ui';
import { formatExpiry as formatDay, getDaysLeft, kindFromDays, parseExpiry } from '@/components/vehicle-management/renewal-items';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

type CategoryLabel = 'Insurance' | 'PUC' | 'Fitness' | 'Road Tax' | 'Permit';

type DocCategory = {
  label: CategoryLabel;
  icon: React.ElementType;
  tone: VmTone;
  collectionName: string;
  /** Where the validity period starts, first match wins. */
  startFields: string[];
  expiryFields: string[];
  vehicleIdField: string;
  mandatoryField?: string;
  /** Module page to jump to for adding a first-time record (the "Missing" cell's Add link). */
  addHref: string;
};

type CellState = 'valid' | 'dueSoon' | 'expired' | 'missing' | 'notApplicable';

type ComplianceCell = {
  state: CellState;
  /**
   * The share of the document's validity period still left, 0–100: 100 on the day it starts, 50
   * halfway through, 0 once it expires. Missing counts as 0. `null` when no start date is recorded,
   * so the period — and the share — can't be known.
   */
  score: number | null;
  startDate: string;
  expiryDate: string;
  daysLeft: number | null;
};

type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

type VehicleHealth = {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  fuelType: string;
  cells: Record<CategoryLabel, ComplianceCell>;
  /** The average of the applicable categories' scores; `null` when none of them has one. */
  overall: number | null;
  grade: Grade | null;
  expired: number;
  missing: number;
  lastMaintenanceDate: string;
  /** Latest recorded km/l; 0 when there is none. */
  mileage: number;
};

type SortKey = 'vehicle' | 'overall' | CategoryLabel | 'lastService' | 'mileage';

// ─── Config ────────────────────────────────────────────────────────────────

const DOC_CATEGORIES: DocCategory[] = [
  { label: 'Insurance', icon: Shield, tone: 'violet', collectionName: VEHICLE_COLLECTIONS.insurance, startFields: ['startDate', 'issueDate', 'validFrom'], expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/insurance' },
  { label: 'PUC', icon: Leaf, tone: 'green', collectionName: VEHICLE_COLLECTIONS.puc, startFields: ['issueDate', 'validFrom'], expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/puc' },
  { label: 'Fitness', icon: BadgeCheck, tone: 'indigo', collectionName: VEHICLE_COLLECTIONS.fitness, startFields: ['issueDate', 'validFrom'], expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory', addHref: '/vehicle-management/fitness' },
  // Road tax records carry no "valid from"; the payment date is when the paid period starts.
  { label: 'Road Tax', icon: Landmark, tone: 'amber', collectionName: VEHICLE_COLLECTIONS.roadTax, startFields: ['validFrom', 'paymentDate'], expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/road-tax' },
  { label: 'Permit', icon: ScrollText, tone: 'orange', collectionName: VEHICLE_COLLECTIONS.permit, startFields: ['validFrom', 'issueDate'], expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory', addHref: '/vehicle-management/permit' },
];

// ─── Score Helpers ─────────────────────────────────────────────────────────

function computeGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function gradeColor(grade: string) {
  return (
    {
      A: 'text-emerald-600',
      B: 'text-cyan-600',
      C: 'text-yellow-600',
      D: 'text-orange-600',
      F: 'text-red-600',
    }[grade] ?? 'text-gray-500'
  );
}

function progressColor(score: number) {
  if (score >= 90) return 'bg-emerald-500';
  if (score >= 75) return 'bg-cyan-500';
  if (score >= 55) return 'bg-yellow-500';
  if (score >= 35) return 'bg-orange-500';
  return 'bg-red-500';
}

function gradeBg(grade: string) {
  return (
    {
      A: 'bg-emerald-100',
      B: 'bg-cyan-100',
      C: 'bg-yellow-100',
      D: 'bg-orange-100',
      F: 'bg-red-100',
    }[grade] ?? 'bg-gray-100'
  );
}

/** A cell's colour follows what the document needs — renew now, renew soon, nothing — not the score band. */
const STATE_STYLE: Record<'valid' | 'dueSoon' | 'expired', { text: string; bar: string }> = {
  valid: { text: 'text-emerald-600', bar: 'bg-emerald-500' },
  dueSoon: { text: 'text-amber-600', bar: 'bg-amber-500' },
  expired: { text: 'text-rose-600', bar: 'bg-rose-500' },
};

/** Share of the period from `start` to `expiry` still ahead of today, 0–100. */
function remainingShare(start: Date | null, expiry: Date): number | null {
  if (!start) return null;
  const period = expiry.getTime() - start.getTime();
  if (period <= 0) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.min(100, Math.round(((expiry.getTime() - today.getTime()) / period) * 100)));
}

const firstValue = (data: Record<string, any>, keys: string[]) =>
  keys.map((key) => String(data[key] || '').trim()).find((value) => value.length > 0) || '';

const isTruthy = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['yes', 'y', 'true', '1', 'required', 'mandatory'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0', 'not required', 'optional'].includes(normalized)) return false;
  return null;
};

const isCategoryApplicable = (vehicle: Record<string, any>, category: CategoryLabel) => {
  const required = getVehicleComplianceRequirements(vehicle);
  if (category === 'Insurance') return required.insurance;
  if (category === 'PUC') return required.puc;
  if (category === 'Fitness') return required.fitness;
  if (category === 'Road Tax') return required.roadTax;
  if (category === 'Permit') return required.permit;
  return true;
};

const NOT_APPLICABLE: ComplianceCell = { state: 'notApplicable', score: null, startDate: '', expiryDate: '', daysLeft: null };
const MISSING: ComplianceCell = { state: 'missing', score: 0, startDate: '', expiryDate: '', daysLeft: null };

/** Sort value for a column; not-applicable and unknown sort after every real value, either direction. */
function sortValue(row: VehicleHealth, key: SortKey): number | string | null {
  if (key === 'vehicle') return row.vehicleNumber;
  if (key === 'overall') return row.overall;
  if (key === 'lastService') return parseExpiry(row.lastMaintenanceDate)?.getTime() ?? null;
  if (key === 'mileage') return row.mileage || null;
  const cell = row.cells[key];
  if (cell.state === 'notApplicable') return null;
  if (cell.state === 'missing') return -1;
  return cell.score ?? (cell.state === 'expired' ? 0 : null);
}

// ─── Cells ─────────────────────────────────────────────────────────────────

function ComplianceCellView({ cell, category, vehicle }: { cell: ComplianceCell; category: DocCategory; vehicle: VehicleHealth }) {
  if (cell.state === 'notApplicable') {
    return <span className="text-xs text-slate-400" title={`${category.label} is not required for this vehicle`}>N/A</span>;
  }
  if (cell.state === 'missing') {
    return (
      <div className="leading-tight">
        <span className="text-xs font-semibold text-rose-600">Missing</span>
        <Link
          href={`${category.addHref}?add=1&vid=${encodeURIComponent(vehicle.id)}&vnum=${encodeURIComponent(vehicle.vehicleNumber)}`}
          className="block text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
        >
          Add record
        </Link>
      </div>
    );
  }

  const style = STATE_STYLE[cell.state];
  const days = cell.daysLeft ?? 0;
  const when = cell.state === 'expired' ? `Expired ${Math.abs(days)}d ago` : days === 0 ? 'Due today' : `${days}d left`;
  const period = cell.startDate ? `${formatDay(cell.startDate)} → ${formatDay(cell.expiryDate)}` : `No start date recorded · expires ${formatDay(cell.expiryDate)}`;
  return (
    <div className="leading-tight" title={`${category.label}: ${period} · ${when}`}>
      <div className="flex items-center gap-1.5">
        <span className={cn('w-7 text-sm font-semibold tabular-nums', style.text)}>{cell.score ?? '—'}</span>
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full', style.bar)} style={{ width: `${cell.score ?? 0}%` }} />
        </div>
      </div>
      <span className={cn('text-[11px]', cell.state === 'valid' ? 'text-muted-foreground' : style.text)}>{when}</span>
    </div>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
  children,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {/* `!min-h-0`: the module's phone rule gives every button a 44px floor, which would triple the header row. */}
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn('inline-flex items-center gap-1 max-sm:!min-h-0 hover:text-slate-900', active && 'text-slate-900')}
      >
        {children}
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function VehicleHealthPage() {
  const { can } = useAuthorization();
  const canView =
    can('View', 'Vehicle Management.Vehicle Master') ||
    can('Add', 'Vehicle Management.Vehicle Master') ||
    can('Edit', 'Vehicle Management.Vehicle Master') ||
    can('View', 'Vehicle Management.Overview');

  const [isLoading, setIsLoading] = useState(true);
  const [vehicleHealthList, setVehicleHealthList] = useState<VehicleHealth[]>([]);
  const [search, setSearch] = useState('');
  // Worst first: the vehicles that need attention lead the table.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'overall', dir: 'asc' });
  const [gradeFilter, setGradeFilter] = useState<'All' | Grade>('All');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load all vehicles
      const vehiclesSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
      const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, any>));

      // The latest record per vehicle per category — the one expiring last.
      type Picked = { startDate: string; expiryDate: string; notApplicable: boolean; stamp: number };
      const categoryData: Partial<Record<CategoryLabel, Record<string, Picked>>> = {};
      await Promise.all(
        DOC_CATEGORIES.map(async (cat) => {
          const snap = await getDocs(collection(db, cat.collectionName));
          const byVehicle: Record<string, Picked> = {};
          snap.docs.forEach((d) => {
            const data = d.data();
            if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
            const vid = String(data[cat.vehicleIdField] || '');
            if (!vid) return;

            const createdAtStamp = typeof data.createdAt?.seconds === 'number' ? Number(data.createdAt.seconds) * 1000 : 0;
            const mandatoryFlag = cat.mandatoryField ? isTruthy(data[cat.mandatoryField]) : null;
            const expiryDate = mandatoryFlag === false ? '' : firstValue(data, cat.expiryFields);
            const stamp = parseExpiry(expiryDate)?.getTime() ?? createdAtStamp;

            const prev = byVehicle[vid];
            if (!prev || stamp >= prev.stamp) {
              byVehicle[vid] = {
                startDate: mandatoryFlag === false ? '' : firstValue(data, cat.startFields),
                expiryDate,
                notApplicable: mandatoryFlag === false,
                stamp,
              };
            }
          });
          categoryData[cat.label] = byVehicle;
        })
      );

      // Load latest maintenance per vehicle
      const maintSnap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.maintenance), orderBy('serviceDate', 'desc'))
      );
      const lastMaint: Record<string, string> = {};
      maintSnap.docs.forEach((d) => {
        const data = d.data();
        const vid = String(data.vehicleId || '');
        if (!lastMaint[vid]) lastMaint[vid] = String(data.serviceDate || '');
      });

      // Load latest fuel per vehicle
      const fuelSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.fuel));
      const latestFuel: Record<string, { mileage: number; stamp: number }> = {};
      fuelSnap.docs.forEach((d) => {
        const data = d.data();
        const vid = String(data.vehicleId || '');
        const mileage = Number(data.mileageKmPerLiter || 0);
        const fuelDateStamp = new Date(String(data.fuelDate || '')).getTime();
        const createdStamp = typeof data.createdAt?.seconds === 'number' ? Number(data.createdAt.seconds) * 1000 : 0;
        const stamp = Number.isNaN(fuelDateStamp) ? createdStamp : fuelDateStamp;
        if (mileage > 0 && (!latestFuel[vid] || stamp >= latestFuel[vid].stamp)) {
          latestFuel[vid] = { mileage, stamp };
        }
      });

      // One row per vehicle, one cell per category.
      const list: VehicleHealth[] = vehicles.map((v) => {
        const cells = {} as Record<CategoryLabel, ComplianceCell>;
        let expired = 0;
        let missing = 0;

        DOC_CATEGORIES.forEach((cat) => {
          const picked = categoryData[cat.label]?.[v.id];
          if (!isCategoryApplicable(v, cat.label) || picked?.notApplicable) {
            cells[cat.label] = NOT_APPLICABLE;
            return;
          }
          const expiry = picked ? parseExpiry(picked.expiryDate) : null;
          if (!picked || !expiry) {
            // No record, or one without a usable expiry date: nothing proves the vehicle is covered.
            cells[cat.label] = MISSING;
            missing += 1;
            return;
          }
          const daysLeft = getDaysLeft(picked.expiryDate);
          const state = kindFromDays(daysLeft);
          if (state === 'expired') expired += 1;
          cells[cat.label] = {
            state,
            score: state === 'expired' ? 0 : remainingShare(parseExpiry(picked.startDate), expiry),
            startDate: picked.startDate,
            expiryDate: picked.expiryDate,
            daysLeft,
          };
        });

        const scored = DOC_CATEGORIES.map((cat) => cells[cat.label]).filter(
          (cell) => cell.state !== 'notApplicable' && cell.score !== null
        );
        const applicable = DOC_CATEGORIES.some((cat) => cells[cat.label].state !== 'notApplicable');
        // Nothing required at all (a sold or scrapped vehicle) is fully compliant, as before.
        const overall = !applicable
          ? 100
          : scored.length === 0
            ? null
            : Math.round(scored.reduce((sum, cell) => sum + (cell.score ?? 0), 0) / scored.length);

        return {
          id: v.id,
          vehicleNumber: String(v.vehicleNumber || v.registrationNo || ''),
          vehicleType: String(v.vehicleType || ''),
          fuelType: String(v.fuelType || ''),
          cells,
          overall,
          grade: overall === null ? null : computeGrade(overall),
          expired,
          missing,
          lastMaintenanceDate: lastMaint[v.id] || '',
          mileage: latestFuel[v.id]?.mileage || 0,
        };
      });

      setVehicleHealthList(list);
    } catch (err) {
      console.error('Failed to load vehicle health', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A new column sorts ascending (worst score, earliest date or A first); clicking it again flips it.
  const onSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const filteredList = useMemo(() => {
    let rows = vehicleHealthList;
    if (gradeFilter !== 'All') rows = rows.filter((v) => v.grade === gradeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (v) =>
          v.vehicleNumber.toLowerCase().includes(q) ||
          v.vehicleType.toLowerCase().includes(q) ||
          v.fuelType.toLowerCase().includes(q) ||
          (v.grade ?? '').toLowerCase() === q
      );
    }
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av === null && bv === null) return a.vehicleNumber.localeCompare(b.vehicleNumber);
      if (av === null) return 1;
      if (bv === null) return -1;
      const diff = typeof av === 'string' ? av.localeCompare(String(bv)) : av - (bv as number);
      return diff !== 0 ? diff * direction : a.vehicleNumber.localeCompare(b.vehicleNumber);
    });
  }, [vehicleHealthList, search, sort, gradeFilter]);

  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    vehicleHealthList.forEach((v) => { if (v.grade) counts[v.grade] = (counts[v.grade] ?? 0) + 1; });
    return counts;
  }, [vehicleHealthList]);

  const summary = useMemo(() => {
    const scored = vehicleHealthList.filter((v) => v.overall !== null);
    const total = vehicleHealthList.length;
    const healthy = scored.filter((v) => (v.overall ?? 0) >= 75).length;
    const critical = scored.filter((v) => (v.overall ?? 0) < 35).length;
    const avgScore = scored.length > 0 ? Math.round(scored.reduce((s, v) => s + (v.overall ?? 0), 0) / scored.length) : 0;
    const expired = vehicleHealthList.reduce((s, v) => s + v.expired, 0);
    const missing = vehicleHealthList.reduce((s, v) => s + v.missing, 0);
    return { total, healthy, critical, avgScore, expired, missing };
  }, [vehicleHealthList]);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const pending = (value: number | string) => (isLoading ? '—' : value);

  return (
    <div className="space-y-3 vm-reveal sm:space-y-5">
      {/* Header */}
      <PageHeader
        title="Vehicle Health"
        description="How much of each document's validity is left, per vehicle — only the documents its type, category and fuel require."
        icon={Activity}
        actions={
          <button
            onClick={load}
            className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      />

      <VmStatStrip
        stats={[
          { label: 'Vehicles', value: pending(summary.total) },
          { label: 'Fleet Score', value: pending(`${summary.avgScore}%`), hint: 'average validity left' },
          { label: 'Healthy', value: pending(summary.healthy), tone: 'success', hint: 'overall 75 or more' },
          { label: 'Critical', value: pending(summary.critical), tone: summary.critical > 0 ? 'danger' : 'default', hint: 'overall under 35' },
          { label: 'Expired', value: pending(summary.expired), tone: summary.expired > 0 ? 'danger' : 'default', hint: 'documents' },
          { label: 'Missing', value: pending(summary.missing), tone: summary.missing > 0 ? 'danger' : 'default', hint: 'documents' },
        ]}
      />

      <TableCard
        title="Vehicle Compliance"
        description="Each score is the share of that document's validity period still left: 100 the day it starts, 50 halfway through, 0 once it expires. Missing counts as 0; N/A is not required for the vehicle. Hover a score for its dates."
        count={filteredList.length}
        total={vehicleHealthList.length}
        noun="vehicle"
        toolbar={
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: 'Search vehicle, type, fuel…' }}
            activeCount={gradeFilter !== 'All' ? 1 : 0}
            onClear={() => { setSearch(''); setGradeFilter('All'); }}
            actions={
              <Link
                href="/vehicle-management/renewals"
                className="flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <AlertTriangle className="h-3 w-3 text-slate-500" />
                Renewals Hub
              </Link>
            }
          >
            {/* Grade filter on the overall score; the grade colours stay on the rows themselves. */}
            <div className={cn(VM_SEGMENT_TRACK, 'shrink-0')}>
              {(['All', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGradeFilter(g)}
                  className={vmSegmentItem(gradeFilter === g)}
                  title={g === 'All' ? 'All grades' : `Grade ${g}${gradeCounts[g] ? ` (${gradeCounts[g]})` : ''}`}
                >
                  {g === 'All' ? 'All' : `${g}${!isLoading && gradeCounts[g] ? ` ·${gradeCounts[g]}` : ''}`}
                </button>
              ))}
            </div>
          </FilterBar>
        }
      >
        {isLoading ? (
          <div className="space-y-1.5 p-3">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : filteredList.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {vehicleHealthList.length === 0 ? 'No vehicles found. Add vehicles in Vehicle Master.' : 'No vehicles match the filters.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {/* The vehicle column stays in view while the table scrolls sideways. TableCard pins
                    every header cell at z-10 through a descendant selector that outranks a plain
                    utility, so this corner cell needs `!z-20` to stay above the ones sliding under it. */}
                <SortHead label="Vehicle" sortKey="vehicle" sort={sort} onSort={onSort} className="left-0 !z-20 min-w-[10rem]" />
                <SortHead label="Overall" sortKey="overall" sort={sort} onSort={onSort} className="min-w-[8rem]" />
                {DOC_CATEGORIES.map((cat) => (
                  <SortHead key={cat.label} label={cat.label} sortKey={cat.label} sort={sort} onSort={onSort} className="min-w-[7.5rem]">
                    <cat.icon className={cn('h-3.5 w-3.5', VM_TONES[cat.tone].text)} aria-hidden="true" />
                  </SortHead>
                ))}
                <SortHead label="Last Service" sortKey="lastService" sort={sort} onSort={onSort} />
                <SortHead label="Mileage" sortKey="mileage" sort={sort} onSort={onSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredList.map((v) => (
                <TableRow key={v.id} className="group">
                  <TableCell className="sticky left-0 z-[1] bg-white group-hover:bg-slate-50">
                    <p className="font-medium leading-tight">{v.vehicleNumber || '—'}</p>
                    <p className="text-[11px] leading-tight text-muted-foreground">
                      {[v.vehicleType, v.fuelType].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </TableCell>
                  <TableCell>
                    {v.overall === null || !v.grade ? (
                      <span className="text-xs text-slate-400" title="No start dates recorded, so no validity share can be worked out">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold', gradeBg(v.grade), gradeColor(v.grade))}>
                          {v.grade}
                        </span>
                        <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', progressColor(v.overall))} style={{ width: `${v.overall}%` }} />
                        </div>
                        <span className={cn('text-xs font-semibold tabular-nums', gradeColor(v.grade))}>{v.overall}</span>
                      </div>
                    )}
                  </TableCell>
                  {DOC_CATEGORIES.map((cat) => (
                    <TableCell key={cat.label}>
                      <ComplianceCellView cell={v.cells[cat.label]} category={cat} vehicle={v} />
                    </TableCell>
                  ))}
                  <TableCell className="text-xs tabular-nums text-slate-600">
                    {v.lastMaintenanceDate ? formatDay(v.lastMaintenanceDate) : <span className="text-slate-400">Not recorded</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {v.mileage ? (
                      <>
                        <span className="font-medium tabular-nums text-slate-700">{v.mileage.toFixed(1)} km/l</span>
                        <span className={cn('ml-1.5', v.mileage >= 15 ? 'text-emerald-600' : v.mileage >= 10 ? 'text-amber-600' : 'text-rose-600')}>
                          {v.mileage >= 15 ? 'Efficient' : v.mileage >= 10 ? 'Average' : 'Poor'}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
