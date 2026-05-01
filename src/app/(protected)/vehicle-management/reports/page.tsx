'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  ALERT_STAGE_LABELS,
  computeRenewalMeta,
  getAlertPriority,
  VEHICLE_COLLECTIONS,
} from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount || 0
  );

export default function VehicleReportsPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [vehicles, setVehicles] = useState<Record<string, any>[]>([]);
  const [fuelRows, setFuelRows] = useState<Record<string, any>[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<Record<string, any>[]>([]);
  const [insuranceRows, setInsuranceRows] = useState<Record<string, any>[]>([]);
  const [pucRows, setPucRows] = useState<Record<string, any>[]>([]);
  const [fitnessRows, setFitnessRows] = useState<Record<string, any>[]>([]);
  const [roadTaxRows, setRoadTaxRows] = useState<Record<string, any>[]>([]);
  const [permitRows, setPermitRows] = useState<Record<string, any>[]>([]);
  const [documentRows, setDocumentRows] = useState<Record<string, any>[]>([]);
  const [driverRows, setDriverRows] = useState<Record<string, any>[]>([]);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [
          vehicleSnap,
          fuelSnap,
          maintenanceSnap,
          insuranceSnap,
          pucSnap,
          fitnessSnap,
          roadTaxSnap,
          permitSnap,
          documentSnap,
          driverSnap,
        ] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fuel)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.maintenance)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.insurance)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.puc)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fitness)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.roadTax)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.permit)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.documents)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.driver)),
        ]);

        setVehicles(vehicleSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFuelRows(fuelSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMaintenanceRows(maintenanceSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setInsuranceRows(insuranceSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPucRows(pucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFitnessRows(fitnessSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRoadTaxRows(roadTaxSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPermitRows(permitSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDocumentRows(documentSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDriverRows(driverSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (error) {
        console.error('Failed to load vehicle reports data', error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const vehicleMap = useMemo(() => {
    const table: Record<string, Record<string, any>> = {};
    vehicles.forEach((vehicle) => {
      table[vehicle.id as string] = vehicle;
    });
    return table;
  }, [vehicles]);

  const fuelThisMonth = useMemo(
    () => fuelRows.filter((row) => String(row.fuelDate || '').startsWith(month)),
    [fuelRows, month]
  );

  const maintenanceThisMonth = useMemo(
    () => maintenanceRows.filter((row) => String(row.serviceDate || '').startsWith(month)),
    [maintenanceRows, month]
  );

  const fuelCostPerVehicle = useMemo(() => {
    const table: Record<
      string,
      { vehicleNumber: string; totalFuelCost: number; totalLiters: number; totalDistance: number; mileage: number | null; costPerKm: number | null }
    > = {};
    fuelThisMonth.forEach((row) => {
      const vehicleId = String(row.vehicleId || '');
      const vehicle = vehicleMap[vehicleId];
      const key = vehicleId || String(row.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(row.vehicleNumber || vehicle?.vehicleNumber || vehicle?.registrationNo || 'Unknown'),
          totalFuelCost: 0,
          totalLiters: 0,
          totalDistance: 0,
          mileage: null,
          costPerKm: null,
        };
      }
      table[key].totalFuelCost += Number(row.totalAmount || 0);
      table[key].totalLiters += Number(row.quantityLiters || 0);
      table[key].totalDistance += Number(row.distanceSinceLastFuelKm || 0);
    });
    return Object.values(table)
      .map((row) => ({
        ...row,
        mileage: row.totalLiters > 0 && row.totalDistance > 0 ? Number((row.totalDistance / row.totalLiters).toFixed(2)) : null,
        costPerKm: row.totalDistance > 0 ? Number((row.totalFuelCost / row.totalDistance).toFixed(2)) : null,
      }))
      .sort((a, b) => b.totalFuelCost - a.totalFuelCost);
  }, [fuelThisMonth, vehicleMap]);

  const projectWiseFuelCost = useMemo(() => {
    const table: Record<string, number> = {};
    fuelThisMonth.forEach((row) => {
      const vehicle = vehicleMap[String(row.vehicleId || '')];
      const project = String(row.projectId || vehicle?.assignedProjectId || 'Unassigned');
      table[project] = (table[project] || 0) + Number(row.totalAmount || 0);
    });
    return Object.entries(table)
      .map(([project, totalCost]) => ({ project, totalCost }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [fuelThisMonth, vehicleMap]);

  const monthlyFuelExpense = useMemo(() => fuelThisMonth.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0), [fuelThisMonth]);
  const monthlyMaintenanceExpense = useMemo(
    () => maintenanceThisMonth.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
    [maintenanceThisMonth]
  );
  const maintenanceCostPerVehicle = useMemo(() => {
    const table: Record<string, { vehicleNumber: string; totalCost: number; visits: number }> = {};
    maintenanceThisMonth.forEach((row) => {
      const vehicleId = String(row.vehicleId || '');
      const vehicle = vehicleMap[vehicleId];
      const key = vehicleId || String(row.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(row.vehicleNumber || vehicle?.vehicleNumber || vehicle?.registrationNo || 'Unknown'),
          totalCost: 0,
          visits: 0,
        };
      }
      table[key].totalCost += Number(row.totalCost || 0);
      table[key].visits += 1;
    });
    return Object.values(table).sort((a, b) => b.totalCost - a.totalCost);
  }, [maintenanceThisMonth, vehicleMap]);
  const totalDistance = useMemo(() => fuelThisMonth.reduce((sum, row) => sum + Number(row.distanceSinceLastFuelKm || 0), 0), [fuelThisMonth]);
  const maxFuelCost = useMemo(
    () => fuelCostPerVehicle.reduce((max, row) => Math.max(max, row.totalFuelCost), 0),
    [fuelCostPerVehicle]
  );
  const maxProjectCost = useMemo(
    () => projectWiseFuelCost.reduce((max, item) => Math.max(max, item.totalCost), 0),
    [projectWiseFuelCost]
  );
  const maxMaintenanceCost = useMemo(
    () => maintenanceCostPerVehicle.reduce((max, item) => Math.max(max, item.totalCost), 0),
    [maintenanceCostPerVehicle]
  );

  const monthlyTrends = useMemo(() => {
    const months: string[] = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }
    return months.map((m) => {
      const fuelTotal = fuelRows
        .filter((r) => String(r.fuelDate || '').startsWith(m))
        .reduce((s, r) => s + Number(r.totalAmount || 0), 0);
      const maintTotal = maintenanceRows
        .filter((r) => String(r.serviceDate || '').startsWith(m))
        .reduce((s, r) => s + Number(r.totalCost || 0), 0);
      return { month: m, fuelTotal, maintTotal, total: fuelTotal + maintTotal };
    });
  }, [fuelRows, maintenanceRows]);

  const maxTrendTotal = useMemo(
    () => monthlyTrends.reduce((max, r) => Math.max(max, r.total), 0),
    [monthlyTrends]
  );

  const combinedTopVehicles = useMemo(() => {
    const table: Record<string, { vehicleNumber: string; fuelCost: number; maintCost: number }> = {};
    fuelThisMonth.forEach((row) => {
      const key = String(row.vehicleId || row.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(row.vehicleNumber || vehicleMap[key]?.vehicleNumber || 'Unknown'),
          fuelCost: 0,
          maintCost: 0,
        };
      }
      table[key].fuelCost += Number(row.totalAmount || 0);
    });
    maintenanceThisMonth.forEach((row) => {
      const key = String(row.vehicleId || row.vehicleNumber || 'unknown');
      if (!table[key]) {
        table[key] = {
          vehicleNumber: String(row.vehicleNumber || vehicleMap[key]?.vehicleNumber || 'Unknown'),
          fuelCost: 0,
          maintCost: 0,
        };
      }
      table[key].maintCost += Number(row.totalCost || 0);
    });
    return Object.values(table)
      .map((r) => ({ ...r, total: r.fuelCost + r.maintCost }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [fuelThisMonth, maintenanceThisMonth, vehicleMap]);

  const maxCombinedCost = useMemo(
    () => combinedTopVehicles.reduce((max, r) => Math.max(max, r.total), 0),
    [combinedTopVehicles]
  );
  const expiryAlerts = useMemo(() => {
    const rows: Array<{
      module: string;
      vehicleNumber: string;
      reference: string;
      expiryDate: string;
      alertStage: string;
      complianceStatus: string;
    }> = [];

    const includeRow = (
      module: string,
      collectionRows: Record<string, any>[],
      expiryKey: string,
      referenceGetter: (row: Record<string, any>) => string
    ) => {
      collectionRows.forEach((row) => {
        const expiryDate = String(row[expiryKey] || '');
        const meta = computeRenewalMeta(expiryDate);
        if (!['Expired', 'Due Today', '7d', '15d', '30d'].includes(meta.alertStage)) return;
        rows.push({
          module,
          vehicleNumber: String(row.vehicleNumber || row.assignedVehicleNumber || 'Unknown'),
          reference: referenceGetter(row),
          expiryDate,
          alertStage: meta.alertStage,
          complianceStatus: meta.complianceStatus,
        });
      });
    };

    includeRow('Insurance', insuranceRows, 'expiryDate', (row) => String(row.policyNumber || '-'));
    includeRow('PUC', pucRows, 'expiryDate', (row) => String(row.pucCertificateNumber || '-'));
    includeRow('Fitness', fitnessRows, 'expiryDate', (row) => String(row.fitnessCertificateNumber || '-'));
    includeRow('Road Tax', roadTaxRows, 'validTill', (row) => String(row.receiptNumber || '-'));
    includeRow('Permit', permitRows, 'validTill', (row) => String(row.permitNumber || '-'));
    includeRow('Documents', documentRows, 'expiryDate', (row) => String(row.documentType || '-'));
    includeRow('Driver License', driverRows, 'licenseExpiryDate', (row) => String(row.licenseNumber || '-'));

    return rows.sort((a, b) => {
      const p = getAlertPriority(a.alertStage) - getAlertPriority(b.alertStage);
      if (p !== 0) return p;
      return String(a.expiryDate || '').localeCompare(String(b.expiryDate || ''));
    });
  }, [insuranceRows, pucRows, fitnessRows, roadTaxRows, permitRows, documentRows, driverRows]);

  const exportReportWorkbook = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();

      const summarySheet = workbook.addWorksheet('Summary');
      summarySheet.columns = [
        { header: 'Metric', key: 'metric', width: 34 },
        { header: 'Value', key: 'value', width: 32 },
      ];
      summarySheet.addRows([
        { metric: 'Month', value: month },
        { metric: 'Monthly Fuel Expense (INR)', value: Number(monthlyFuelExpense || 0) },
        { metric: 'Monthly Maintenance Expense (INR)', value: Number(monthlyMaintenanceExpense || 0) },
        { metric: 'Total Distance (KM)', value: Number(totalDistance || 0) },
        {
          metric: 'Fuel Cost Per KM (INR)',
          value: totalDistance > 0 ? Number((monthlyFuelExpense / totalDistance).toFixed(2)) : '',
        },
      ]);

      const fuelSheet = workbook.addWorksheet('Fuel Per Vehicle');
      fuelSheet.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 24 },
        { header: 'Total Liters', key: 'totalLiters', width: 16 },
        { header: 'Total Fuel Cost (INR)', key: 'totalFuelCost', width: 20 },
        { header: 'Distance (KM)', key: 'totalDistance', width: 16 },
        { header: 'Mileage (KM/L)', key: 'mileage', width: 16 },
        { header: 'Cost Per KM (INR)', key: 'costPerKm', width: 18 },
      ];
      fuelCostPerVehicle.forEach((row) => {
        fuelSheet.addRow({
          vehicleNumber: row.vehicleNumber,
          totalLiters: Number(row.totalLiters || 0),
          totalFuelCost: Number(row.totalFuelCost || 0),
          totalDistance: Number(row.totalDistance || 0),
          mileage: row.mileage ?? '',
          costPerKm: row.costPerKm ?? '',
        });
      });

      const projectSheet = workbook.addWorksheet('Project Fuel Cost');
      projectSheet.columns = [
        { header: 'Project', key: 'project', width: 32 },
        { header: 'Total Fuel Cost (INR)', key: 'totalCost', width: 20 },
      ];
      projectWiseFuelCost.forEach((row) => {
        projectSheet.addRow({ project: row.project, totalCost: Number(row.totalCost || 0) });
      });

      const maintenanceSheet = workbook.addWorksheet('Maintenance Per Vehicle');
      maintenanceSheet.columns = [
        { header: 'Vehicle', key: 'vehicleNumber', width: 24 },
        { header: 'Service Entries', key: 'visits', width: 18 },
        { header: 'Total Maintenance Cost (INR)', key: 'totalCost', width: 24 },
      ];
      maintenanceCostPerVehicle.forEach((row) => {
        maintenanceSheet.addRow({
          vehicleNumber: row.vehicleNumber,
          visits: Number(row.visits || 0),
          totalCost: Number(row.totalCost || 0),
        });
      });

      const alertSheet = workbook.addWorksheet('Expiry Alerts');
      alertSheet.columns = [
        { header: 'Module', key: 'module', width: 18 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 20 },
        { header: 'Reference', key: 'reference', width: 22 },
        { header: 'Expiry Date', key: 'expiryDate', width: 16 },
        { header: 'Alert Stage', key: 'alertStage', width: 16 },
        { header: 'Compliance Status', key: 'complianceStatus', width: 20 },
      ];
      expiryAlerts.forEach((row) => alertSheet.addRow(row));

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeMonth = month.replace(/[^0-9-]/g, '');
      anchor.href = url;
      anchor.download = `vehicle-reports-${safeMonth || 'all'}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export vehicle reports', error);
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
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="tracking-tight">Reports</CardTitle>
            <CardDescription>Fuel cost per vehicle, mileage, monthly expense, and project-wise cost.</CardDescription>
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
                onClick={exportReportWorkbook}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Monthly Fuel Expense</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(monthlyFuelExpense)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{fuelThisMonth.length} fuel entries</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-500/80 to-orange-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Monthly Maintenance Expense</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(monthlyMaintenanceExpense)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{maintenanceThisMonth.length} maintenance entries</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-violet-500/80 to-purple-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Fleet Cost</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(monthlyFuelExpense + monthlyMaintenanceExpense)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Fuel + maintenance combined</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500/80 to-teal-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Distance</CardDescription>
            <CardTitle className="text-xl">{new Intl.NumberFormat('en-IN').format(totalDistance)} km</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Distance from fuel logs</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-indigo-500/80 to-blue-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Fuel Cost Per KM</CardDescription>
            <CardTitle className="text-xl">
              {totalDistance > 0 ? formatCurrency(monthlyFuelExpense / totalDistance) : 'N/A'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Fuel expense ÷ total distance</CardContent>
        </Card>
      </div>

      {/* 6-Month Trend */}
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">6-Month Cost Trend</CardTitle>
          <CardDescription>Monthly fuel and maintenance spend for the last 6 months.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {monthlyTrends.map((row) => (
            <div key={row.month} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="w-16 font-medium text-slate-600">{row.month}</span>
                <span>{formatCurrency(row.total)}</span>
              </div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all duration-500"
                  style={{ width: `${maxTrendTotal > 0 ? (row.fuelTotal / maxTrendTotal) * 100 : 0}%` }}
                />
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
                  style={{ width: `${maxTrendTotal > 0 ? (row.maintTotal / maxTrendTotal) * 100 : 0}%` }}
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

      {/* Top 5 Vehicles by Combined Cost */}
      {combinedTopVehicles.length > 0 && (
        <Card className="vm-panel-strong">
          <CardHeader>
            <CardTitle className="text-lg">Top Vehicles by Total Cost</CardTitle>
            <CardDescription>Highest combined fuel + maintenance spend this month.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {combinedTopVehicles.map((row, idx) => (
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
                    className="h-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-all duration-500"
                    style={{ width: `${maxCombinedCost > 0 ? (row.fuelCost / maxCombinedCost) * 100 : 0}%` }}
                  />
                  <div
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500"
                    style={{ width: `${maxCombinedCost > 0 ? (row.maintCost / maxCombinedCost) * 100 : 0}%` }}
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

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Fuel Cost Per Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:hidden">
          {fuelCostPerVehicle.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No data for selected month.
            </div>
          ) : (
            fuelCostPerVehicle.map((row) => (
              <div key={row.vehicleNumber} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold">{row.vehicleNumber}</div>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Fuel Cost</span>
                    <span>{formatCurrency(row.totalFuelCost)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"
                      style={{ width: `${maxFuelCost > 0 ? (row.totalFuelCost / maxFuelCost) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Liters</span>
                    <span>{row.totalLiters.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Distance</span>
                    <span>{new Intl.NumberFormat('en-IN').format(row.totalDistance)} km</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Mileage</span>
                    <span>{row.mileage === null ? 'N/A' : `${row.mileage.toFixed(2)} km/l`}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Cost / KM</span>
                    <span>{row.costPerKm === null ? 'N/A' : formatCurrency(row.costPerKm)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden overflow-x-auto rounded-lg border border-white/70 bg-white/80 sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Vehicle</TableHead>
                <TableHead>Total Liters</TableHead>
                <TableHead>Total Fuel Cost</TableHead>
                <TableHead>Distance (KM)</TableHead>
                <TableHead>Mileage (KM/L)</TableHead>
                <TableHead>Cost Per KM</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fuelCostPerVehicle.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-20 text-muted-foreground">
                    No data for selected month.
                  </TableCell>
                </TableRow>
              ) : (
                fuelCostPerVehicle.map((row) => (
                  <TableRow key={row.vehicleNumber} className="hover:bg-cyan-50/70 transition-colors">
                    <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                    <TableCell>{row.totalLiters.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{formatCurrency(row.totalFuelCost)}</div>
                        <div className="h-1.5 w-36 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-500"
                            style={{ width: `${maxFuelCost > 0 ? (row.totalFuelCost / maxFuelCost) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{new Intl.NumberFormat('en-IN').format(row.totalDistance)}</TableCell>
                    <TableCell>{row.mileage === null ? 'N/A' : row.mileage.toFixed(2)}</TableCell>
                    <TableCell>{row.costPerKm === null ? 'N/A' : formatCurrency(row.costPerKm)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Project-wise Fuel Cost</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:hidden">
          {projectWiseFuelCost.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No project-wise fuel data for selected month.
            </div>
          ) : (
            projectWiseFuelCost.map((item) => (
              <div key={item.project} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold">
                  {item.project === 'Unassigned' ? <Badge variant="outline">Unassigned</Badge> : item.project}
                </div>
                <div className="text-sm">{formatCurrency(item.totalCost)}</div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600"
                    style={{ width: `${maxProjectCost > 0 ? (item.totalCost / maxProjectCost) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden overflow-x-auto rounded-lg border border-white/70 bg-white/80 sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Project</TableHead>
                <TableHead>Total Fuel Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectWiseFuelCost.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center h-20 text-muted-foreground">
                    No project-wise fuel data for selected month.
                  </TableCell>
                </TableRow>
              ) : (
                projectWiseFuelCost.map((item) => (
                  <TableRow key={item.project} className="hover:bg-cyan-50/70 transition-colors">
                    <TableCell className="font-medium">
                      {item.project === 'Unassigned' ? <Badge variant="outline">Unassigned</Badge> : item.project}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{formatCurrency(item.totalCost)}</div>
                        <div className="h-1.5 w-40 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-500"
                            style={{ width: `${maxProjectCost > 0 ? (item.totalCost / maxProjectCost) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Maintenance Cost Per Vehicle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:hidden">
          {maintenanceCostPerVehicle.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No maintenance data for selected month.
            </div>
          ) : (
            maintenanceCostPerVehicle.map((item) => (
              <div key={item.vehicleNumber} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-2 text-sm font-semibold">{item.vehicleNumber}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Cost</span>
                  <span>{formatCurrency(item.totalCost)}</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500"
                    style={{ width: `${maxMaintenanceCost > 0 ? (item.totalCost / maxMaintenanceCost) * 100 : 0}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{item.visits} service entries</div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden overflow-x-auto rounded-lg border border-white/70 bg-white/80 sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Vehicle</TableHead>
                <TableHead>Service Entries</TableHead>
                <TableHead>Total Maintenance Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maintenanceCostPerVehicle.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                    No maintenance data for selected month.
                  </TableCell>
                </TableRow>
              ) : (
                maintenanceCostPerVehicle.map((item) => (
                  <TableRow key={item.vehicleNumber} className="hover:bg-cyan-50/70 transition-colors">
                    <TableCell className="font-medium">{item.vehicleNumber}</TableCell>
                    <TableCell>{item.visits}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div>{formatCurrency(item.totalCost)}</div>
                        <div className="h-1.5 w-40 rounded-full bg-slate-100">
                          <div
                            className="h-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 transition-all duration-500"
                            style={{ width: `${maxMaintenanceCost > 0 ? (item.totalCost / maxMaintenanceCost) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-lg">Expiry Alert Center</CardTitle>
          <CardDescription>30/15/7 day, due today, and expired compliance alerts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 sm:hidden">
          {expiryAlerts.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No active compliance alerts.
            </div>
          ) : (
            expiryAlerts.slice(0, 25).map((item, idx) => (
              <div key={`${item.module}-${item.reference}-${idx}`} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{item.module}</span>
                  <Badge
                    variant={item.alertStage === 'Expired' ? 'destructive' : 'outline'}
                    className={item.alertStage !== 'Expired' ? 'bg-amber-50 text-amber-700' : ''}
                  >
                    {ALERT_STAGE_LABELS[item.alertStage] || item.alertStage}
                  </Badge>
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vehicle</span>
                    <span>{item.vehicleNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ref</span>
                    <span>{item.reference}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expiry</span>
                    <span>{item.expiryDate || '-'}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
        <CardContent className="hidden overflow-x-auto rounded-lg border border-white/70 bg-white/80 sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead>Module</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Alert Stage</TableHead>
                <TableHead>Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expiryAlerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                    No active compliance alerts.
                  </TableCell>
                </TableRow>
              ) : (
                expiryAlerts.map((item, idx) => (
                  <TableRow key={`${item.module}-${item.reference}-${idx}`} className="hover:bg-cyan-50/70 transition-colors">
                    <TableCell>{item.module}</TableCell>
                    <TableCell className="font-medium">{item.vehicleNumber}</TableCell>
                    <TableCell>{item.reference}</TableCell>
                    <TableCell>{item.expiryDate || '-'}</TableCell>
                    <TableCell>
                      <Badge
                        variant={item.alertStage === 'Expired' ? 'destructive' : 'outline'}
                        className={item.alertStage !== 'Expired' ? 'bg-amber-50 text-amber-700' : ''}
                      >
                        {ALERT_STAGE_LABELS[item.alertStage] || item.alertStage}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.complianceStatus}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
