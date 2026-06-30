'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ChevronLeft, Download, TrendingUp } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

export default function MonthlyTrendsReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [fuelRows, setFuelRows] = useState<Record<string, any>[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<Record<string, any>[]>([]);
  const [vehicleMap, setVehicleMap] = useState<Record<string, Record<string, any>>>({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [vehicleSnap, fuelSnap, maintSnap] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fuel)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.maintenance)),
        ]);
        const vMap: Record<string, Record<string, any>> = {};
        vehicleSnap.docs.forEach((d) => { vMap[d.id] = { id: d.id, ...d.data() }; });
        setVehicleMap(vMap);
        setFuelRows(fuelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMaintenanceRows(maintSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load monthly trends report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const months = useMemo(() => {
    const base = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(base.getFullYear(), base.getMonth() - (5 - i), 1);
      return d.toISOString().slice(0, 7);
    });
  }, []);

  const currentMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];

  const trends = useMemo(
    () =>
      months.map((m) => {
        const fuelTotal = fuelRows
          .filter((r) => String(r.fuelDate || '').startsWith(m))
          .reduce((s, r) => s + Number(r.totalAmount || 0), 0);
        const maintTotal = maintenanceRows
          .filter((r) => String(r.serviceDate || '').startsWith(m))
          .reduce((s, r) => s + Number(r.totalCost || 0), 0);
        return { month: m, fuelTotal, maintTotal, total: fuelTotal + maintTotal };
      }),
    [months, fuelRows, maintenanceRows]
  );

  const maxTotal = useMemo(() => trends.reduce((max, r) => Math.max(max, r.total), 0), [trends]);
  const EMPTY_TREND = { month: '', fuelTotal: 0, maintTotal: 0, total: 0 };
  const currentTrend = trends[trends.length - 1] ?? EMPTY_TREND;
  const prevTrend = trends[trends.length - 2] ?? EMPTY_TREND;

  const fuelThisMonth = useMemo(
    () => fuelRows.filter((r) => String(r.fuelDate || '').startsWith(currentMonth)),
    [fuelRows, currentMonth]
  );
  const maintThisMonth = useMemo(
    () => maintenanceRows.filter((r) => String(r.serviceDate || '').startsWith(currentMonth)),
    [maintenanceRows, currentMonth]
  );

  const topVehicles = useMemo(() => {
    const table: Record<string, { vehicleNumber: string; fuelCost: number; maintCost: number }> = {};
    fuelThisMonth.forEach((r) => {
      const key = String(r.vehicleId || r.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(r.vehicleNumber || vehicleMap[key]?.vehicleNumber || 'Unknown'),
          fuelCost: 0,
          maintCost: 0,
        };
      }
      table[key].fuelCost += Number(r.totalAmount || 0);
    });
    maintThisMonth.forEach((r) => {
      const key = String(r.vehicleId || r.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(r.vehicleNumber || vehicleMap[key]?.vehicleNumber || 'Unknown'),
          fuelCost: 0,
          maintCost: 0,
        };
      }
      table[key].maintCost += Number(r.totalCost || 0);
    });
    return Object.values(table)
      .map((r) => ({ ...r, total: r.fuelCost + r.maintCost }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [fuelThisMonth, maintThisMonth, vehicleMap]);

  const maxTopCost = useMemo(() => topVehicles.reduce((max, r) => Math.max(max, r.total), 0), [topVehicles]);

  const pctChange =
    prevTrend?.total > 0
      ? ((currentTrend.total - prevTrend.total) / prevTrend.total) * 100
      : null;

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Monthly Trends');
      ws.columns = [
        { header: 'Month', key: 'month', width: 14 },
        { header: 'Fuel Cost (INR)', key: 'fuelTotal', width: 18 },
        { header: 'Maintenance Cost (INR)', key: 'maintTotal', width: 24 },
        { header: 'Total Cost (INR)', key: 'total', width: 18 },
      ];
      trends.forEach((r) => ws.addRow(r));

      const ws2 = wb.addWorksheet('Top Vehicles This Month');
      ws2.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 22 },
        { header: 'Fuel Cost (INR)', key: 'fuelCost', width: 18 },
        { header: 'Maintenance Cost (INR)', key: 'maintCost', width: 24 },
        { header: 'Total Cost (INR)', key: 'total', width: 18 },
      ];
      topVehicles.forEach((r) => ws2.addRow(r));

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monthly-trends.xlsx`;
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
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 to-purple-600" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <TrendingUp className="h-4 w-4 text-violet-500" /> Monthly Cost Trends
            </CardTitle>
            <CardDescription>6-month fleet expenditure overview — fuel and maintenance combined.</CardDescription>
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
          <div className="h-1 w-full bg-gradient-to-r from-violet-500/80 to-purple-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>This Month Total</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(currentTrend.total)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{currentMonth}</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-slate-400/80 to-slate-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Previous Month</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(prevTrend?.total || 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{prevMonth}</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div
            className={`h-1 w-full bg-gradient-to-r ${pctChange !== null && pctChange > 0 ? 'from-rose-500/80 to-orange-500/80' : 'from-emerald-500/80 to-teal-500/80'}`}
          />
          <CardHeader className="pb-2">
            <CardDescription>Month-on-Month Change</CardDescription>
            <CardTitle className={`text-xl ${pctChange !== null && pctChange > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {pctChange !== null ? `${pctChange > 0 ? '+' : ''}${pctChange.toFixed(1)}%` : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">vs previous month</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>This Month Fuel</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(currentTrend.fuelTotal)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Maintenance: {formatCurrency(currentTrend.maintTotal)}
          </CardContent>
        </Card>
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">6-Month Cost Trend</CardTitle>
          <CardDescription>Stacked fuel (cyan) and maintenance (amber) spend per month.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {trends.map((row) => (
            <div key={row.month} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span
                  className={`w-16 font-medium ${row.month === currentMonth ? 'text-violet-600' : 'text-slate-600'}`}
                >
                  {row.month}
                </span>
                <span className={row.month === currentMonth ? 'font-semibold text-slate-800' : ''}>
                  {formatCurrency(row.total)}
                </span>
              </div>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all duration-500"
                  style={{ width: `${maxTotal > 0 ? (row.fuelTotal / maxTotal) * 100 : 0}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
                  style={{ width: `${maxTotal > 0 ? (row.maintTotal / maxTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cyan-500" /> Fuel
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" /> Maintenance
            </span>
          </div>
        </CardContent>
      </Card>

      {topVehicles.length > 0 && (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle className="text-base">Top 5 Vehicles by Total Cost</CardTitle>
            <CardDescription>Highest combined fuel + maintenance spend in {currentMonth}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {topVehicles.map((row, idx) => (
              <div key={row.vehicleNumber} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                      {idx + 1}
                    </span>
                    <span className="font-medium">{row.vehicleNumber}</span>
                  </span>
                  <span className="font-semibold">{formatCurrency(row.total)}</span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all"
                    style={{ width: `${maxTopCost > 0 ? (row.fuelCost / maxTopCost) * 100 : 0}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                    style={{ width: `${maxTopCost > 0 ? (row.maintCost / maxTopCost) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>Fuel: {formatCurrency(row.fuelCost)}</span>
                  <span>Maintenance: {formatCurrency(row.maintCost)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
