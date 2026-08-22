'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Car,
  ChevronDown,
  ChevronRight,
  Gauge,
  Landmark,
  Leaf,
  RefreshCw,
  ScrollText,
  Shield,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import {
  computeRenewalMeta,
  getVehicleComplianceRequirements,
  VEHICLE_COLLECTIONS,
} from '@/lib/vehicle-management';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ─── Types ─────────────────────────────────────────────────────────────────

type DocCategory = {
  label: string;
  icon: React.ElementType;
  color: string;
  collectionName: string;
  expiryFields: string[];
  vehicleIdField: string;
  mandatoryField?: string;
  /** Module page to jump to for adding a first-time record (used by the "Missing" Add Now link). */
  addHref: string;
};

type VehicleHealth = {
  id: string;
  vehicleNumber: string;
  vehicleType: string;
  fuelType: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  expired: number;
  dueSoon: number;
  good: number;
  missing: number;
  notApplicable: number;
  alerts: { category: string; status: string; expiryDate: string }[];
  totalDocs: number; // applicable docs count
  lastMaintenanceDate: string;
  fuelHealthLabel: string;
};

// ─── Config ────────────────────────────────────────────────────────────────

const DOC_CATEGORIES: DocCategory[] = [
  { label: 'Insurance', icon: Shield, color: 'blue', collectionName: VEHICLE_COLLECTIONS.insurance, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/insurance' },
  { label: 'PUC', icon: Leaf, color: 'green', collectionName: VEHICLE_COLLECTIONS.puc, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/puc' },
  { label: 'Fitness', icon: BadgeCheck, color: 'purple', collectionName: VEHICLE_COLLECTIONS.fitness, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory', addHref: '/vehicle-management/fitness' },
  { label: 'Road Tax', icon: Landmark, color: 'yellow', collectionName: VEHICLE_COLLECTIONS.roadTax, expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId', addHref: '/vehicle-management/road-tax' },
  { label: 'Permit', icon: ScrollText, color: 'orange', collectionName: VEHICLE_COLLECTIONS.permit, expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory', addHref: '/vehicle-management/permit' },
];

// ─── Score Helpers ─────────────────────────────────────────────────────────

function computeGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
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

function statusBadge(status: string) {
  if (status === 'Expired') return <Badge className="h-4.5 border-red-200 bg-red-100 px-1.5 text-[10px] text-red-700">{status}</Badge>;
  if (status === 'Due Soon') return <Badge className="h-4.5 border-yellow-200 bg-yellow-100 px-1.5 text-[10px] text-yellow-700">{status}</Badge>;
  if (status === 'Valid') return <Badge className="h-4.5 border-emerald-200 bg-emerald-100 px-1.5 text-[10px] text-emerald-700">{status}</Badge>;
  if (status === 'Not Applicable') return <Badge className="h-4.5 border-slate-200 bg-slate-100 px-1.5 text-[10px] text-slate-600">{status}</Badge>;
  return <Badge variant="outline" className="h-4.5 px-1.5 text-[10px]">{status}</Badge>;
}

const isTruthy = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['yes', 'y', 'true', '1', 'required', 'mandatory'].includes(normalized)) return true;
  if (['no', 'n', 'false', '0', 'not required', 'optional'].includes(normalized)) return false;
  return null;
};

const isCategoryApplicable = (vehicle: Record<string, any>, category: string) => {
  const required = getVehicleComplianceRequirements(vehicle);
  if (category === 'Insurance') return required.insurance;
  if (category === 'PUC') return required.puc;
  if (category === 'Fitness') return required.fitness;
  if (category === 'Road Tax') return required.roadTax;
  if (category === 'Permit') return required.permit;
  return true;
};

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'score' | 'vehicleNumber' | 'expired'>('score');
  const [gradeFilter, setGradeFilter] = useState<'All' | 'A' | 'B' | 'C' | 'D' | 'F'>('All');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load all vehicles
      const vehiclesSnap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
      const vehicles = vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Record<string, any>));

      // Load all compliance docs per category
      const categoryData: Record<string, Record<string, { expiryDate: string; status: string }>> = {};
      await Promise.all(
        DOC_CATEGORIES.map(async (cat) => {
          const snap = await getDocs(collection(db, cat.collectionName));
          const byVehicle: Record<string, { expiryDate: string; status: string; _sortStamp: number }> = {};
          snap.docs.forEach((d) => {
            const data = d.data();
            if (data.isArchived === true || data.renewalStatus === 'Renewed') return;
            const vid = String(data[cat.vehicleIdField] || '');
            if (!vid) return;

            const mandatoryFlag = cat.mandatoryField ? isTruthy(data[cat.mandatoryField]) : null;

            const createdAtStamp =
              typeof data.createdAt?.seconds === 'number' ? Number(data.createdAt.seconds) * 1000 : 0;

            if (mandatoryFlag === false) {
              const prev = byVehicle[vid];
              if (!prev || createdAtStamp >= prev._sortStamp) {
                byVehicle[vid] = { expiryDate: '', status: 'Not Applicable', _sortStamp: createdAtStamp };
              }
              return;
            }

            const expiry =
              cat.expiryFields
                .map((key) => String(data[key] || '').trim())
                .find((value) => value.length > 0) || '';
            const meta = computeRenewalMeta(expiry);

            const expiryStamp = Number.isNaN(new Date(expiry).getTime())
              ? createdAtStamp
              : new Date(expiry).getTime();

            // Use latest entry per vehicle per category.
            const prev = byVehicle[vid];
            if (!prev || expiryStamp >= prev._sortStamp) {
              byVehicle[vid] = { expiryDate: expiry, status: meta.complianceStatus, _sortStamp: expiryStamp };
            }
          });
          const cleaned: Record<string, { expiryDate: string; status: string }> = {};
          Object.keys(byVehicle).forEach((vid) => {
            cleaned[vid] = { expiryDate: byVehicle[vid].expiryDate, status: byVehicle[vid].status };
          });
          categoryData[cat.label] = cleaned;
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
      const lastFuel = Object.fromEntries(Object.entries(latestFuel).map(([vehicleId, value]) => [vehicleId, value.mileage]));

      // Compute per-vehicle health score
      const list: VehicleHealth[] = vehicles.map((v) => {
        const alerts: VehicleHealth['alerts'] = [];
        let expired = 0;
        let dueSoon = 0;
        let good = 0;
        let missing = 0;
        let notApplicable = 0;
        let applicableDocs = 0;

        DOC_CATEGORIES.forEach((cat) => {
          const doc = categoryData[cat.label]?.[v.id];
          const applicableByVehicleRule = isCategoryApplicable(v, cat.label);
          const applicable = applicableByVehicleRule && doc?.status !== 'Not Applicable';

          if (!applicable) {
            alerts.push({ category: cat.label, status: 'Not Applicable', expiryDate: '' });
            notApplicable += 1;
            return;
          }

          applicableDocs += 1;
          if (!doc) {
            alerts.push({ category: cat.label, status: 'Missing', expiryDate: '' });
            missing += 1;
          } else {
            alerts.push({ category: cat.label, status: doc.status, expiryDate: doc.expiryDate });
            if (doc.status === 'Expired') expired++;
            else if (doc.status === 'Due Soon') dueSoon++;
            else good++;
          }
        });

        const weightedPoints = good * 1 + dueSoon * 0.65 + expired * 0.15;
        const score =
          applicableDocs === 0
            ? 100
            : Math.max(0, Math.min(100, Math.round((weightedPoints / applicableDocs) * 100)));
        const grade = computeGrade(score);
        const mileage = lastFuel[v.id] || 0;
        const fuelHealthLabel = !mileage ? '—' : mileage >= 15 ? 'Efficient' : mileage >= 10 ? 'Average' : 'Poor';

        return {
          id: v.id,
          vehicleNumber: String(v.vehicleNumber || v.registrationNo || ''),
          vehicleType: String(v.vehicleType || ''),
          fuelType: String(v.fuelType || ''),
          score,
          grade,
          expired,
          dueSoon,
          good,
          missing,
          notApplicable,
          alerts,
          totalDocs: applicableDocs,
          lastMaintenanceDate: lastMaint[v.id] || '',
          fuelHealthLabel,
        };
      });

      list.sort((a, b) => a.score - b.score);
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
          v.grade.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      if (sortKey === 'score') return a.score - b.score;
      if (sortKey === 'expired') return b.expired - a.expired;
      return a.vehicleNumber.localeCompare(b.vehicleNumber);
    });
  }, [vehicleHealthList, search, sortKey, gradeFilter]);

  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    vehicleHealthList.forEach((v) => { counts[v.grade] = (counts[v.grade] ?? 0) + 1; });
    return counts;
  }, [vehicleHealthList]);

  const summary = useMemo(() => {
    const total = vehicleHealthList.length;
    const healthy = vehicleHealthList.filter((v) => v.score >= 75).length;
    const critical = vehicleHealthList.filter((v) => v.score < 35).length;
    const avgScore = total > 0 ? Math.round(vehicleHealthList.reduce((s, v) => s + v.score, 0) / total) : 0;
    return { total, healthy, critical, avgScore };
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

  return (
    <div className="space-y-3 vm-reveal sm:space-y-5">
      {/* Header */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader className="flex flex-row items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm tracking-tight sm:text-base">
              <Activity className="h-4 w-4 shrink-0 text-emerald-500" />
              Vehicle Health
            </CardTitle>
            <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
              Compliance score is calculated only on applicable documents by vehicle type/category/fuel.
            </p>
          </div>
          <button
            onClick={load}
            className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-black/10 bg-white/80 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </CardHeader>
      </Card>

      {/* Summary Stats — small, refined tiles. 2 columns below ~480px so labels never
          truncate mid-word (4 equal columns left no room for "Fleet Score"/"Critical" on
          a true phone-width screen). */}
      <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
        {[
          { label: 'Vehicles', value: summary.total, icon: Car, color: 'from-blue-500 to-indigo-600' },
          { label: 'Fleet Score', value: `${summary.avgScore}%`, icon: Gauge, color: 'from-cyan-500 to-teal-600' },
          { label: 'Healthy', value: summary.healthy, icon: TrendingUp, color: 'from-emerald-500 to-green-600' },
          { label: 'Critical', value: summary.critical, icon: TrendingDown, color: 'from-red-500 to-rose-600' },
        ].map((stat) => (
          <Card key={stat.label} className="vm-panel-strong overflow-hidden">
            <CardContent className="flex min-w-0 items-center gap-1.5 p-2 sm:gap-2 sm:p-2.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br sm:h-8 sm:w-8 ${stat.color}`}>
                <stat.icon className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[10px] leading-tight text-muted-foreground sm:text-xs">{stat.label}</p>
                <p className="text-sm font-bold leading-tight tracking-tight sm:text-lg">{isLoading ? '—' : stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle, type, fuel…"
            className="h-9 bg-white/85 pl-9 text-sm"
          />
          <Activity className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
        {/* Grade filter pills — scrollable on mobile */}
        <div className="flex flex-shrink-0 gap-1 overflow-x-auto">
          {(['All', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => {
            const active = gradeFilter === g;
            const colorMap: Record<string, string> = {
              All: 'border-emerald-300 bg-emerald-50 text-emerald-700',
              A: 'border-emerald-300 bg-emerald-50 text-emerald-700',
              B: 'border-cyan-300 bg-cyan-50 text-cyan-700',
              C: 'border-yellow-300 bg-yellow-50 text-yellow-700',
              D: 'border-orange-300 bg-orange-50 text-orange-700',
              F: 'border-red-300 bg-red-50 text-red-700',
            };
            return (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`h-7 rounded-md border px-2 text-[11px] font-semibold transition-colors ${
                  active ? colorMap[g] : 'border-transparent bg-slate-100 text-muted-foreground hover:bg-slate-200'
                }`}
                title={g === 'All' ? 'All grades' : `Grade ${g}${gradeCounts[g] ? ` (${gradeCounts[g]})` : ''}`}
              >
                {g === 'All' ? 'All' : `${g}${!isLoading && gradeCounts[g] ? ` ·${gradeCounts[g]}` : ''}`}
              </button>
            );
          })}
        </div>

        {/* Sort pills */}
        <div className="flex flex-shrink-0 gap-1 overflow-x-auto">
          {(['score', 'vehicleNumber', 'expired'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`h-7 rounded-md border px-2 text-[11px] font-medium transition-colors ${
                sortKey === key
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  : 'border-transparent bg-slate-100 text-muted-foreground hover:bg-slate-200'
              }`}
            >
              {key === 'score' ? 'Score ↑' : key === 'vehicleNumber' ? 'A–Z' : 'Expired ↓'}
            </button>
          ))}
        </div>

        <Link
          href="/vehicle-management/renewals"
          className="ml-auto flex h-7 items-center gap-1 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-2.5 text-[11px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <AlertTriangle className="h-3 w-3" />
          Renewals Hub
        </Link>
        </div>
      </div>

      {/* Vehicle list — compact table, minimum row height, click a row to expand details */}
      <Card className="vm-panel-strong overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-1.5 p-3">
              {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : filteredList.length === 0 ? (
            <div className="flex items-center justify-center px-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">No vehicles found. Add vehicles in Vehicle Master.</p>
            </div>
          ) : (
            <div className="overflow-auto rounded-b-lg h-[calc(100vh-330px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <TableRow className="h-8">
                    <TableHead className="w-11 px-2">Grade</TableHead>
                    <TableHead className="px-2">Vehicle</TableHead>
                    <TableHead className="w-36 px-2">Score</TableHead>
                    <TableHead className="w-16 px-2 text-center">Expired</TableHead>
                    <TableHead className="w-16 px-2 text-center">Due Soon</TableHead>
                    <TableHead className="w-16 px-2 text-center">Missing</TableHead>
                    <TableHead className="w-14 px-2 text-center">N/A</TableHead>
                    <TableHead className="w-8 px-2" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredList.map((v) => {
                    const isExpanded = expandedId === v.id;
                    return (
                      <Fragment key={v.id}>
                        <TableRow
                          className="h-9 cursor-pointer transition-colors hover:bg-emerald-50/50"
                          onClick={() => setExpandedId(isExpanded ? null : v.id)}
                        >
                          <TableCell className="px-2 py-1">
                            <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold', gradeBg(v.grade), gradeColor(v.grade))}>
                              {v.grade}
                            </span>
                          </TableCell>
                          <TableCell className="px-2 py-1">
                            <p className="truncate font-medium leading-tight">{v.vehicleNumber || '—'}</p>
                            <p className="truncate text-[11px] leading-tight text-muted-foreground">
                              {[v.vehicleType, v.fuelType].filter(Boolean).join(' · ') || '—'}
                            </p>
                          </TableCell>
                          <TableCell className="px-2 py-1">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-100">
                                <div className={cn('h-full rounded-full', progressColor(v.score))} style={{ width: `${v.score}%` }} />
                              </div>
                              <span className={cn('text-xs font-semibold tabular-nums', gradeColor(v.grade))}>{v.score}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-2 py-1 text-center text-xs font-semibold text-red-600">{v.expired || '–'}</TableCell>
                          <TableCell className="px-2 py-1 text-center text-xs font-semibold text-yellow-600">{v.dueSoon || '–'}</TableCell>
                          <TableCell className="px-2 py-1 text-center text-xs font-semibold text-slate-500">{v.missing || '–'}</TableCell>
                          <TableCell className="px-2 py-1 text-center text-xs text-slate-400">{v.notApplicable || '–'}</TableCell>
                          <TableCell className="px-2 py-1 text-right">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-slate-50/70 hover:bg-slate-50/70">
                            <TableCell colSpan={8} className="px-3 py-2.5">
                              <div className="flex flex-wrap gap-1.5">
                                {v.alerts.map((alert) => {
                                  const cat = DOC_CATEGORIES.find((c) => c.label === alert.category);
                                  const chip = (
                                    <span className="inline-flex items-center gap-1.5 rounded-md border border-black/5 bg-white px-2 py-1 text-[11px] shadow-sm">
                                      {cat && <cat.icon className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                      <span className="font-medium text-slate-600">{alert.category}</span>
                                      {statusBadge(alert.status)}
                                      {alert.expiryDate && <span className="text-muted-foreground">{alert.expiryDate}</span>}
                                    </span>
                                  );
                                  return alert.status === 'Missing' && cat ? (
                                    <Link
                                      key={alert.category}
                                      href={`${cat.addHref}?add=1&vid=${encodeURIComponent(v.id)}&vnum=${encodeURIComponent(v.vehicleNumber)}`}
                                      className="transition-opacity hover:opacity-80"
                                    >
                                      {chip}
                                    </Link>
                                  ) : (
                                    <span key={alert.category}>{chip}</span>
                                  );
                                })}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                <span>Applicable docs: <strong className="text-slate-600">{v.totalDocs}</strong></span>
                                <span>Last service: <strong className="text-slate-600">{v.lastMaintenanceDate || 'Not recorded'}</strong></span>
                                <span>Mileage: <strong className="text-slate-600">{v.fuelHealthLabel}</strong></span>
                                <Link href="/vehicle-management/renewals" className="ml-auto font-medium text-emerald-600 hover:underline">
                                  View Renewals →
                                </Link>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
