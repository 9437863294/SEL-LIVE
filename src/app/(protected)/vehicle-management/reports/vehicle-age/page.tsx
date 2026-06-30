'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Car, ChevronLeft, Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

const BRACKETS = ['New (0-2 yrs)', 'Moderate (3-5 yrs)', 'Old (6-10 yrs)', 'Aging (10+ yrs)', 'Unknown'] as const;

const bracketStyle: Record<string, { badge: string; card: string }> = {
  'New (0-2 yrs)': { badge: 'bg-emerald-50 text-emerald-700', card: 'border-emerald-200 bg-emerald-50' },
  'Moderate (3-5 yrs)': { badge: 'bg-sky-50 text-sky-700', card: 'border-sky-200 bg-sky-50' },
  'Old (6-10 yrs)': { badge: 'bg-amber-50 text-amber-700', card: 'border-amber-200 bg-amber-50' },
  'Aging (10+ yrs)': { badge: 'bg-rose-50 text-rose-700', card: 'border-rose-200 bg-rose-50' },
  Unknown: { badge: 'bg-slate-100 text-slate-600', card: 'border-white/70 bg-white/80' },
};

export default function VehicleAgeReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [vehicles, setVehicles] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster));
        setVehicles(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load vehicle age report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const rows = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return vehicles
      .map((v) => {
        const year = Number(v.yearOfManufacture) || null;
        const age = year ? currentYear - year : null;
        const bracket =
          age === null
            ? 'Unknown'
            : age <= 2
            ? 'New (0-2 yrs)'
            : age <= 5
            ? 'Moderate (3-5 yrs)'
            : age <= 10
            ? 'Old (6-10 yrs)'
            : 'Aging (10+ yrs)';
        return {
          vehicleNumber: String(v.vehicleNumber || v.registrationNo || '-'),
          brand: String(v.brand || '-'),
          model: String(v.model || '-'),
          vehicleType: String(v.vehicleType || '-'),
          fuelType: String(v.fuelType || '-'),
          yearOfManufacture: year,
          age,
          bracket,
          currentStatus: String(v.currentStatus || v.vehicleStatus || '-'),
          purchaseValue: Number(v.purchaseValue || 0),
          assignedProject: String(v.assignedProjectName || v.assignedProjectId || 'Unassigned'),
        };
      })
      .sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  }, [vehicles]);

  const bracketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => { counts[r.bracket] = (counts[r.bracket] || 0) + 1; });
    return BRACKETS.map((b) => ({ bracket: b, count: counts[b] || 0 }));
  }, [rows]);

  const ageStats = useMemo(() => {
    const withAge = rows.filter((r) => r.age !== null);
    if (withAge.length === 0) return { avg: null, oldest: null, newest: null };
    let oldest = withAge[0];
    let newest = withAge[0];
    let total = 0;
    withAge.forEach((r) => {
      if (r.age! > oldest.age!) oldest = r;
      if (r.age! < newest.age!) newest = r;
      total += r.age!;
    });
    return { avg: Math.round(total / withAge.length), oldest, newest };
  }, [rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Vehicle Age');
      ws.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 20 },
        { header: 'Brand', key: 'brand', width: 16 },
        { header: 'Model', key: 'model', width: 16 },
        { header: 'Type', key: 'vehicleType', width: 14 },
        { header: 'Fuel Type', key: 'fuelType', width: 12 },
        { header: 'Year of Manufacture', key: 'yearOfManufacture', width: 20 },
        { header: 'Age (Years)', key: 'age', width: 14 },
        { header: 'Age Category', key: 'bracket', width: 22 },
        { header: 'Status', key: 'currentStatus', width: 14 },
        { header: 'Assigned Project', key: 'assignedProject', width: 26 },
        { header: 'Purchase Value (INR)', key: 'purchaseValue', width: 22 },
      ];
      rows.forEach((r) =>
        ws.addRow({ ...r, yearOfManufacture: r.yearOfManufacture ?? '', age: r.age ?? '', purchaseValue: r.purchaseValue || '' })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vehicle-age-report.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setIsExporting(false);
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view reports.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-pink-500 to-rose-500" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <Car className="h-4 w-4 text-pink-500" /> Vehicle Age Report
            </CardTitle>
            <CardDescription>
              Fleet age analysis by year of manufacture. Fleet-wide — not filtered by month.
            </CardDescription>
          </div>
          {canExport && (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting}
              className="bg-white/80 hover:bg-white"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          )}
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-pink-500/80 to-rose-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Vehicles</CardDescription>
            <CardTitle className="text-xl">{vehicles.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Across entire fleet</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500/80 to-red-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Average Fleet Age</CardDescription>
            <CardTitle className="text-xl">{ageStats.avg !== null ? `${ageStats.avg} yrs` : 'N/A'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Based on year of manufacture</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500/80 to-teal-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Newest Vehicle</CardDescription>
            <CardTitle className="text-base truncate">{ageStats.newest?.vehicleNumber || 'N/A'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {ageStats.newest?.age !== null ? `${ageStats.newest?.age} yrs old (${ageStats.newest?.yearOfManufacture})` : '-'}
          </CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-slate-400/80 to-slate-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Oldest Vehicle</CardDescription>
            <CardTitle className="text-base truncate">{ageStats.oldest?.vehicleNumber || 'N/A'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {ageStats.oldest?.age !== null ? `${ageStats.oldest?.age} yrs old (${ageStats.oldest?.yearOfManufacture})` : '-'}
          </CardContent>
        </Card>
      </div>

      {/* Age bracket summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {bracketCounts.map((b) => (
          <div
            key={b.bracket}
            className={`rounded-lg border p-3 text-center shadow-sm ${bracketStyle[b.bracket]?.card || 'border-white/70 bg-white/80'}`}
          >
            <div className="text-2xl font-bold text-slate-700">{b.count}</div>
            <div className="mt-1 text-xs leading-tight text-muted-foreground">{b.bracket}</div>
          </div>
        ))}
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">Fleet Age Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 sm:hidden">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No vehicle data.
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.vehicleNumber} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{row.vehicleNumber}</span>
                  <Badge variant="outline" className={bracketStyle[row.bracket]?.badge || ''}>
                    {row.age !== null ? `${row.age} yrs` : 'Unknown'}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Brand / Model</span>
                    <span>{row.brand} {row.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Year / Type</span>
                    <span>{row.yearOfManufacture ?? '-'} · {row.vehicleType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Project</span>
                    <span>{row.assignedProject}</span>
                  </div>
                  {row.purchaseValue > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Purchase Value</span>
                      <span>{formatCurrency(row.purchaseValue)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden sm:block p-0">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No vehicle data.
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Brand / Model</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fuel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Purchase Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.vehicleNumber} className="hover:bg-pink-50/50 transition-colors">
                      <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                      <TableCell>{row.brand} {row.model}</TableCell>
                      <TableCell>{row.yearOfManufacture ?? '-'}</TableCell>
                      <TableCell>{row.age !== null ? `${row.age} yrs` : '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={bracketStyle[row.bracket]?.badge || ''}>
                          {row.bracket}
                        </Badge>
                      </TableCell>
                      <TableCell>{row.vehicleType}</TableCell>
                      <TableCell>{row.fuelType}</TableCell>
                      <TableCell>{row.currentStatus}</TableCell>
                      <TableCell>
                        {row.assignedProject === 'Unassigned' ? (
                          <Badge variant="outline">Unassigned</Badge>
                        ) : (
                          row.assignedProject
                        )}
                      </TableCell>
                      <TableCell>{row.purchaseValue > 0 ? formatCurrency(row.purchaseValue) : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
