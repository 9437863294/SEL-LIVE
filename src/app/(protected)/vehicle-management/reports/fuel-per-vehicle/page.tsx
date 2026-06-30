'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ChevronLeft, Download, Fuel } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

export default function FuelPerVehicleReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicles, setVehicles] = useState<Record<string, any>[]>([]);
  const [fuelRows, setFuelRows] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [vehicleSnap, fuelSnap] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fuel)),
        ]);
        setVehicles(vehicleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFuelRows(fuelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load fuel per vehicle report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const vehicleMap = useMemo(() => {
    const m: Record<string, Record<string, any>> = {};
    vehicles.forEach((v) => { m[v.id] = v; });
    return m;
  }, [vehicles]);

  const fuelThisMonth = useMemo(
    () => fuelRows.filter((r) => String(r.fuelDate || '').startsWith(month)),
    [fuelRows, month]
  );

  const rows = useMemo(() => {
    const table: Record<
      string,
      { vehicleNumber: string; vehicleType: string; fuelType: string; totalFuelCost: number; totalLiters: number; totalDistance: number }
    > = {};
    fuelThisMonth.forEach((r) => {
      const vehicleId = String(r.vehicleId || '');
      const vehicle = vehicleMap[vehicleId];
      const key = vehicleId || String(r.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(r.vehicleNumber || vehicle?.vehicleNumber || vehicle?.registrationNo || 'Unknown'),
          vehicleType: String(vehicle?.vehicleType || '-'),
          fuelType: String(r.fuelType || vehicle?.fuelType || '-'),
          totalFuelCost: 0,
          totalLiters: 0,
          totalDistance: 0,
        };
      }
      table[key].totalFuelCost += Number(r.totalAmount || 0);
      table[key].totalLiters += Number(r.quantityLiters || 0);
      table[key].totalDistance += Number(r.distanceSinceLastFuelKm || 0);
    });
    return Object.values(table)
      .map((r) => ({
        ...r,
        mileage:
          r.totalLiters > 0 && r.totalDistance > 0
            ? Number((r.totalDistance / r.totalLiters).toFixed(2))
            : null,
        costPerKm: r.totalDistance > 0 ? Number((r.totalFuelCost / r.totalDistance).toFixed(2)) : null,
      }))
      .sort((a, b) => b.totalFuelCost - a.totalFuelCost);
  }, [fuelThisMonth, vehicleMap]);

  const totalFuelCost = useMemo(() => rows.reduce((s, r) => s + r.totalFuelCost, 0), [rows]);
  const totalLiters = useMemo(() => rows.reduce((s, r) => s + r.totalLiters, 0), [rows]);
  const totalDistance = useMemo(() => rows.reduce((s, r) => s + r.totalDistance, 0), [rows]);
  const maxFuelCost = useMemo(() => rows.reduce((max, r) => Math.max(max, r.totalFuelCost), 0), [rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Fuel Per Vehicle');
      ws.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 22 },
        { header: 'Type', key: 'vehicleType', width: 14 },
        { header: 'Fuel Type', key: 'fuelType', width: 12 },
        { header: 'Total Liters', key: 'totalLiters', width: 14 },
        { header: 'Total Fuel Cost (INR)', key: 'totalFuelCost', width: 22 },
        { header: 'Distance (KM)', key: 'totalDistance', width: 14 },
        { header: 'Mileage (KM/L)', key: 'mileage', width: 16 },
        { header: 'Cost Per KM (INR)', key: 'costPerKm', width: 18 },
      ];
      rows.forEach((r) =>
        ws.addRow({ ...r, mileage: r.mileage ?? '', costPerKm: r.costPerKm ?? '' })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fuel-per-vehicle-${month}.xlsx`;
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
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 to-sky-500" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <Fuel className="h-4 w-4 text-cyan-500" /> Fuel Cost Per Vehicle
            </CardTitle>
            <CardDescription>Monthly fuel spend, mileage efficiency, and cost per km by vehicle.</CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
            <span className="text-sm text-muted-foreground">Month</span>
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full bg-white/80 border-white/70 md:w-44"
            />
            {canExport && (
              <Button
                variant="outline"
                onClick={exportExcel}
                disabled={isExporting}
                className="w-full bg-white/80 hover:bg-white md:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Fuel Cost</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totalFuelCost)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{fuelThisMonth.length} entries</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-sky-500/80 to-blue-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Liters</CardDescription>
            <CardTitle className="text-xl">{totalLiters.toFixed(1)} L</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Across {rows.length} vehicles</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500/80 to-teal-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Distance</CardDescription>
            <CardTitle className="text-xl">{new Intl.NumberFormat('en-IN').format(totalDistance)} km</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">From fuel logs</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500/80 to-blue-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Fleet Cost Per KM</CardDescription>
            <CardTitle className="text-xl">
              {totalDistance > 0 ? formatCurrency(totalFuelCost / totalDistance) : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Fuel ÷ total distance</CardContent>
        </Card>
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">Fuel Breakdown by Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 sm:hidden">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No fuel data for selected month.
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.vehicleNumber} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">{row.vehicleNumber}</span>
                  <span className="text-sm font-medium">{formatCurrency(row.totalFuelCost)}</span>
                </div>
                <div className="mb-2 h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"
                    style={{ width: `${maxFuelCost > 0 ? (row.totalFuelCost / maxFuelCost) * 100 : 0}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>Liters: {row.totalLiters.toFixed(2)}</span>
                  <span>Distance: {new Intl.NumberFormat('en-IN').format(row.totalDistance)} km</span>
                  <span>Mileage: {row.mileage !== null ? `${row.mileage} km/l` : 'N/A'}</span>
                  <span>Cost/KM: {row.costPerKm !== null ? formatCurrency(row.costPerKm) : 'N/A'}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      <CardContent className="hidden sm:block p-0">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
            No fuel data for selected month.
          </div>
        ) : (
          <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-420px)]">
            <table className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Fuel Type</TableHead>
                  <TableHead>Liters</TableHead>
                  <TableHead>Total Cost</TableHead>
                  <TableHead>Distance (KM)</TableHead>
                  <TableHead>Mileage (KM/L)</TableHead>
                  <TableHead>Cost Per KM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.vehicleNumber} className="hover:bg-cyan-50/70 transition-colors">
                    <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                    <TableCell>{row.vehicleType}</TableCell>
                    <TableCell>{row.fuelType}</TableCell>
                    <TableCell>{row.totalLiters.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{formatCurrency(row.totalFuelCost)}</div>
                        <div className="h-1.5 w-32 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all"
                            style={{ width: `${maxFuelCost > 0 ? (row.totalFuelCost / maxFuelCost) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{new Intl.NumberFormat('en-IN').format(row.totalDistance)}</TableCell>
                    <TableCell>{row.mileage !== null ? row.mileage.toFixed(2) : 'N/A'}</TableCell>
                    <TableCell>{row.costPerKm !== null ? formatCurrency(row.costPerKm) : 'N/A'}</TableCell>
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
