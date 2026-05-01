'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Car,
  ChevronDown,
  ChevronRight,
  Fuel,
  Gauge,
  Landmark,
  Leaf,
  RefreshCw,
  ScrollText,
  Shield,
  TrendingDown,
  TrendingUp,
  Wrench,
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

// ─── Types ─────────────────────────────────────────────────────────────────

type DocCategory = {
  label: string;
  icon: React.ElementType;
  color: string;
  collectionName: string;
  expiryFields: string[];
  vehicleIdField: string;
  mandatoryField?: string;
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
  { label: 'Insurance', icon: Shield, color: 'blue', collectionName: VEHICLE_COLLECTIONS.insurance, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId' },
  { label: 'PUC', icon: Leaf, color: 'green', collectionName: VEHICLE_COLLECTIONS.puc, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId' },
  { label: 'Fitness', icon: BadgeCheck, color: 'purple', collectionName: VEHICLE_COLLECTIONS.fitness, expiryFields: ['expiryDate', 'validTill'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory' },
  { label: 'Road Tax', icon: Landmark, color: 'yellow', collectionName: VEHICLE_COLLECTIONS.roadTax, expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId' },
  { label: 'Permit', icon: ScrollText, color: 'orange', collectionName: VEHICLE_COLLECTIONS.permit, expiryFields: ['validTill', 'expiryDate'], vehicleIdField: 'vehicleId', mandatoryField: 'isMandatory' },
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

function statusBadge(status: string) {
  if (status === 'Expired') return <Badge className="bg-red-100 text-red-700 border-red-200">{status}</Badge>;
  if (status === 'Due Soon') return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200">{status}</Badge>;
  if (status === 'Valid') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">{status}</Badge>;
  if (status === 'Not Applicable') return <Badge className="bg-slate-100 text-slate-600 border-slate-200">{status}</Badge>;
  return <Badge variant="outline">{status}</Badge>;
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
  const canView = can('View', 'Vehicle Management.Vehicle Master') || can('View', 'Vehicle Management.Overview');

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
      const lastFuel: Record<string, number> = {};
      fuelSnap.docs.forEach((d) => {
        const data = d.data();
        const vid = String(data.vehicleId || '');
        const mileage = Number(data.mileageKmPerLiter || 0);
        if (!lastFuel[vid] && mileage > 0) lastFuel[vid] = mileage;
      });

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
    <div className="space-y-5 vm-reveal">
      {/* Header */}
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-cyan-500 to-blue-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <Activity className="h-5 w-5 text-cyan-500" />
              Vehicle Health Dashboard
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Compliance score is calculated only on applicable documents by vehicle type/category/fuel.
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-foreground backdrop-blur hover:bg-white/20 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </CardHeader>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total Vehicles', value: summary.total, icon: Car, color: 'from-blue-500 to-indigo-600' },
          { label: 'Fleet Health Score', value: `${summary.avgScore}%`, icon: Gauge, color: 'from-cyan-500 to-teal-600' },
          { label: 'Healthy (≥75)', value: summary.healthy, icon: TrendingUp, color: 'from-emerald-500 to-green-600' },
          { label: 'Critical (<35)', value: summary.critical, icon: TrendingDown, color: 'from-red-500 to-rose-600' },
        ].map((stat) => (
          <Card key={stat.label} className="vm-panel-strong overflow-hidden">
            <div className={`h-0.5 w-full bg-gradient-to-r ${stat.color}`} />
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${stat.color} shadow-lg`}>
                <stat.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold tracking-tight">{isLoading ? '—' : stat.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vehicle, type, fuel…"
            className="bg-white/85 pl-9"
          />
          <Activity className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        {/* Grade filter pills */}
        <div className="flex gap-1">
          {(['All', 'A', 'B', 'C', 'D', 'F'] as const).map((g) => {
            const active = gradeFilter === g;
            const colorMap: Record<string, string> = {
              All: 'border-cyan-400 bg-cyan-50 text-cyan-700',
              A: 'border-emerald-400 bg-emerald-50 text-emerald-700',
              B: 'border-cyan-400 bg-cyan-50 text-cyan-700',
              C: 'border-yellow-400 bg-yellow-50 text-yellow-700',
              D: 'border-orange-400 bg-orange-50 text-orange-700',
              F: 'border-red-400 bg-red-50 text-red-700',
            };
            return (
              <button
                key={g}
                onClick={() => setGradeFilter(g)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? colorMap[g]
                    : 'border-white/20 bg-white/10 text-muted-foreground hover:bg-white/20'
                }`}
                title={g === 'All' ? 'All grades' : `Grade ${g}${gradeCounts[g] ? ` (${gradeCounts[g]})` : ''}`}
              >
                {g === 'All' ? 'All' : `${g}${!isLoading && gradeCounts[g] ? ` ·${gradeCounts[g]}` : ''}`}
              </button>
            );
          })}
        </div>

        {/* Sort pills */}
        <div className="flex gap-1">
          {(['score', 'vehicleNumber', 'expired'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                sortKey === key
                  ? 'border-cyan-400 bg-cyan-50 text-cyan-700'
                  : 'border-white/20 bg-white/10 text-muted-foreground hover:bg-white/20'
              }`}
            >
              {key === 'score' ? 'Score ↑' : key === 'vehicleNumber' ? 'A–Z' : 'Expired ↓'}
            </button>
          ))}
        </div>

        <Link
          href="/vehicle-management/renewals"
          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow hover:opacity-90 transition-opacity"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Renewals Hub
        </Link>
      </div>

      {/* Vehicle Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : filteredList.length === 0 ? (
        <Card className="vm-panel flex items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">No vehicles found. Add vehicles in Vehicle Master.</p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredList.map((v) => {
            const isExpanded = expandedId === v.id;
            return (
              <Card key={v.id} className="vm-panel-strong overflow-hidden transition-all">
                <div
                  className={`h-0.5 w-full bg-gradient-to-r ${
                    v.grade === 'A'
                      ? 'from-emerald-400 to-green-500'
                      : v.grade === 'B'
                      ? 'from-cyan-400 to-teal-500'
                      : v.grade === 'C'
                      ? 'from-yellow-400 to-amber-500'
                      : v.grade === 'D'
                      ? 'from-orange-400 to-amber-600'
                      : 'from-red-500 to-rose-600'
                  }`}
                />
                {/* Summary Row */}
                <button
                  className="w-full text-left"
                  onClick={() => setExpandedId(isExpanded ? null : v.id)}
                >
                  <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap">
                    {/* Grade Badge */}
                    <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 ${
                      v.grade === 'A' ? 'border-emerald-400 bg-emerald-50' :
                      v.grade === 'B' ? 'border-cyan-400 bg-cyan-50' :
                      v.grade === 'C' ? 'border-yellow-400 bg-yellow-50' :
                      v.grade === 'D' ? 'border-orange-400 bg-orange-50' :
                      'border-red-400 bg-red-50'
                    }`}>
                      <span className={`text-2xl font-black ${gradeColor(v.grade)}`}>{v.grade}</span>
                    </div>

                    {/* Vehicle Info */}
                    <div className="flex-1 space-y-1 min-w-0">
                      <p className="text-base font-bold tracking-tight truncate">{v.vehicleNumber || '—'}</p>
                      <p className="text-xs text-muted-foreground">{v.vehicleType} · {v.fuelType}</p>
                    </div>

                    {/* Progress Bar */}
                    <div className="flex-1 space-y-1.5 min-w-[120px]">
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Health Score</span>
                        <span className={`font-semibold ${gradeColor(v.grade)}`}>{v.score}%</span>
                      </div>
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${progressColor(v.score)}`}
                          style={{ width: `${v.score}%` }}
                        />
                      </div>
                    </div>

                    {/* Counts */}
                    <div className="flex items-center gap-3 text-center">
                      {v.expired > 0 && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-2 py-1">
                          <p className="text-xs font-bold text-red-700">{v.expired}</p>
                          <p className="text-[10px] text-red-500">Expired</p>
                        </div>
                      )}
                      {v.dueSoon > 0 && (
                        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-2 py-1">
                          <p className="text-xs font-bold text-yellow-700">{v.dueSoon}</p>
                          <p className="text-[10px] text-yellow-500">Due Soon</p>
                        </div>
                      )}
                      {v.missing > 0 && (
                        <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1">
                          <p className="text-xs font-bold text-gray-600">{v.missing}</p>
                          <p className="text-[10px] text-gray-400">Missing</p>
                        </div>
                      )}
                      {v.notApplicable > 0 && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-2 py-1">
                          <p className="text-xs font-bold text-slate-600">{v.notApplicable}</p>
                          <p className="text-[10px] text-slate-500">N/A</p>
                        </div>
                      )}
                    </div>

                    {/* Expand */}
                    <div className="shrink-0 text-muted-foreground">
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </div>
                  </CardContent>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <CardContent className="border-t border-white/10 bg-white/5 px-4 pb-5 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      {v.alerts.map((alert) => {
                        const cat = DOC_CATEGORIES.find((c) => c.label === alert.category);
                        return (
                          <div
                            key={alert.category}
                            className={`rounded-xl border p-3 ${
                              alert.status === 'Expired'
                                ? 'border-red-200 bg-red-50/70'
                                : alert.status === 'Due Soon'
                                ? 'border-yellow-200 bg-yellow-50/70'
                                : alert.status === 'Not Applicable'
                                ? 'border-slate-200 bg-slate-50/70'
                                : alert.status === 'Missing'
                                ? 'border-gray-200 bg-gray-50/70'
                                : 'border-emerald-200 bg-emerald-50/70'
                            }`}
                          >
                            <div className="mb-1.5 flex items-center gap-1.5">
                              {cat && <cat.icon className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="text-xs font-semibold text-muted-foreground">{alert.category}</span>
                            </div>
                            {statusBadge(alert.status)}
                            {alert.expiryDate && (
                              <p className="mt-1.5 text-[11px] text-muted-foreground">
                                Exp: {alert.expiryDate}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Meta row */}
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground border-t border-white/10 pt-3">
                      <span>Applicable Docs: <strong>{v.totalDocs}</strong></span>
                      <span>🔧 Last Service: <strong>{v.lastMaintenanceDate || 'Not recorded'}</strong></span>
                      <span>⛽ Mileage: <strong>{v.fuelHealthLabel}</strong></span>
                      <Link
                        href={`/vehicle-management/renewals`}
                        className="ml-auto text-cyan-600 hover:underline font-medium"
                      >
                        View Renewals →
                      </Link>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
