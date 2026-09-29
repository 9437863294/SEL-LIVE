'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, Fuel } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { VmStatStrip } from '@/components/vehicle-management/vm-ui';

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
    <div className="vm-report-page space-y-3 sm:space-y-4">
      <PageHeader
        title="Fuel Cost Per Vehicle"
        description="Monthly fuel spend, mileage efficiency, and cost per km by vehicle."
        icon={Fuel}
        backHref="/vehicle-management/reports"
        backLabel="Back to Reports"
        actions={
          <>
            <div className="flex min-w-full items-center gap-2 sm:min-w-0">
              <span className="text-sm text-muted-foreground">Month</span>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full sm:w-auto"
              />
            </div>
            {canExport && (
              <Button
                variant="outline"
                onClick={exportExcel}
                disabled={isExporting}
                className="w-full sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
          </>
        }
      />

      <VmStatStrip
        stats={[
          { label: 'Total Fuel Cost', value: formatCurrency(totalFuelCost), hint: `${fuelThisMonth.length} entries` },
          { label: 'Total Liters', value: `${totalLiters.toFixed(1)} L`, hint: `Across ${rows.length} vehicles` },
          { label: 'Total Distance', value: `${new Intl.NumberFormat('en-IN').format(totalDistance)} km`, hint: 'From fuel logs' },
          {
            label: 'Fleet Cost Per KM',
            value: totalDistance > 0 ? formatCurrency(totalFuelCost / totalDistance) : 'N/A',
            hint: 'Fuel ÷ total distance',
          },
        ]}
      />

      <TableCard title="Fuel Breakdown by Vehicle" icon={Fuel} count={rows.length} noun="vehicle">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No fuel data for selected month.
          </div>
        ) : (
          <>
            <div className="space-y-2 p-3 sm:hidden">
              {rows.map((row) => (
                <div key={row.vehicleNumber} className="rounded-lg border border-slate-200 bg-white p-3">
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
              ))}
            </div>
            <div className="hidden sm:block">
              <Table containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fuel Type</TableHead>
                    <TableHead className="text-right">Liters</TableHead>
                    <TableHead>Total Cost</TableHead>
                    <TableHead className="text-right">Distance (KM)</TableHead>
                    <TableHead className="text-right">Mileage (KM/L)</TableHead>
                    <TableHead className="text-right">Cost Per KM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.vehicleNumber}>
                      <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                      <TableCell>{row.vehicleType}</TableCell>
                      <TableCell>{row.fuelType}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.totalLiters.toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums">
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
                      <TableCell className="text-right tabular-nums">{new Intl.NumberFormat('en-IN').format(row.totalDistance)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.mileage !== null ? row.mileage.toFixed(2) : 'N/A'}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.costPerKm !== null ? formatCurrency(row.costPerKm) : 'N/A'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </TableCard>
    </div>
  );
}
