'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ChevronLeft, Download, Wrench } from 'lucide-react';
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

export default function MaintenanceCostReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicles, setVehicles] = useState<Record<string, any>[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [vehicleSnap, maintSnap] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.maintenance)),
        ]);
        setVehicles(vehicleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMaintenanceRows(maintSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Failed to load maintenance cost report', err);
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

  const maintThisMonth = useMemo(
    () => maintenanceRows.filter((r) => String(r.serviceDate || '').startsWith(month)),
    [maintenanceRows, month]
  );

  const rows = useMemo(() => {
    const table: Record<
      string,
      { vehicleNumber: string; vehicleType: string; visits: number; labourCost: number; partsCost: number; otherCost: number; totalCost: number }
    > = {};
    maintThisMonth.forEach((r) => {
      const vehicleId = String(r.vehicleId || '');
      const vehicle = vehicleMap[vehicleId];
      const key = vehicleId || String(r.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(r.vehicleNumber || vehicle?.vehicleNumber || vehicle?.registrationNo || 'Unknown'),
          vehicleType: String(vehicle?.vehicleType || '-'),
          visits: 0,
          labourCost: 0,
          partsCost: 0,
          otherCost: 0,
          totalCost: 0,
        };
      }
      table[key].visits += 1;
      table[key].labourCost += Number(r.labourCost || 0);
      table[key].partsCost += Number(r.partsCost || 0);
      table[key].otherCost += Number(r.otherCharges || 0);
      table[key].totalCost += Number(r.totalCost || 0);
    });
    return Object.values(table).sort((a, b) => b.totalCost - a.totalCost);
  }, [maintThisMonth, vehicleMap]);

  const totalCost = useMemo(() => rows.reduce((s, r) => s + r.totalCost, 0), [rows]);
  const totalVisits = useMemo(() => rows.reduce((s, r) => s + r.visits, 0), [rows]);
  const maxCost = useMemo(() => rows.reduce((max, r) => Math.max(max, r.totalCost), 0), [rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Maintenance Cost');
      ws.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 22 },
        { header: 'Type', key: 'vehicleType', width: 14 },
        { header: 'Service Visits', key: 'visits', width: 16 },
        { header: 'Labour Cost (INR)', key: 'labourCost', width: 20 },
        { header: 'Parts Cost (INR)', key: 'partsCost', width: 18 },
        { header: 'Other Charges (INR)', key: 'otherCost', width: 20 },
        { header: 'Total Cost (INR)', key: 'totalCost', width: 18 },
      ];
      rows.forEach((r) => ws.addRow(r));
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `maintenance-cost-${month}.xlsx`;
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
        <div className="h-1 w-full bg-gradient-to-r from-amber-500 to-orange-500" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <Wrench className="h-4 w-4 text-amber-500" /> Maintenance Cost
            </CardTitle>
            <CardDescription>Service visit count, labour, parts, and total maintenance spend per vehicle.</CardDescription>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-500/80 to-orange-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Maintenance Cost</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totalCost)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{maintThisMonth.length} records this month</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-orange-500/80 to-red-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Service Visits</CardDescription>
            <CardTitle className="text-xl">{totalVisits}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Across {rows.length} vehicles</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-rose-500/80 to-pink-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Avg Cost Per Visit</CardDescription>
            <CardTitle className="text-xl">
              {totalVisits > 0 ? formatCurrency(totalCost / totalVisits) : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Total cost ÷ visits</CardContent>
        </Card>
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">Maintenance Cost by Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 sm:hidden">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No maintenance data for selected month.
            </div>
          ) : (
            rows.map((row) => (
              <div key={row.vehicleNumber} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm font-semibold">{row.vehicleNumber}</span>
                  <span className="text-sm font-medium">{formatCurrency(row.totalCost)}</span>
                </div>
                <div className="mb-2 h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                    style={{ width: `${maxCost > 0 ? (row.totalCost / maxCost) * 100 : 0}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                  <span>Visits: {row.visits}</span>
                  <span>Labour: {formatCurrency(row.labourCost)}</span>
                  <span>Parts: {formatCurrency(row.partsCost)}</span>
                  <span>Other: {formatCurrency(row.otherCost)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden sm:block p-0">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No maintenance data for selected month.
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Visits</TableHead>
                    <TableHead>Labour</TableHead>
                    <TableHead>Parts</TableHead>
                    <TableHead>Other</TableHead>
                    <TableHead>Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.vehicleNumber} className="hover:bg-amber-50/70 transition-colors">
                      <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                      <TableCell>{row.vehicleType}</TableCell>
                      <TableCell>{row.visits}</TableCell>
                      <TableCell>{formatCurrency(row.labourCost)}</TableCell>
                      <TableCell>{formatCurrency(row.partsCost)}</TableCell>
                      <TableCell>{formatCurrency(row.otherCost)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{formatCurrency(row.totalCost)}</div>
                          <div className="h-1.5 w-32 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
                              style={{ width: `${maxCost > 0 ? (row.totalCost / maxCost) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
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
