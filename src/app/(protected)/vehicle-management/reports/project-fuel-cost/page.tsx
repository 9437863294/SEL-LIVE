'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Download, Layers } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

export default function ProjectFuelCostReportPage() {
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
        console.error('Failed to load project fuel cost report', err);
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
      { projectName: string; totalCost: number; totalLiters: number; entries: number; vehicles: Set<string> }
    > = {};
    fuelThisMonth.forEach((r) => {
      const vehicle = vehicleMap[String(r.vehicleId || '')];
      const project = String(
        r.projectName || vehicle?.assignedProjectName || r.projectId || vehicle?.assignedProjectId || 'Unassigned'
      );
      if (!table[project]) {
        table[project] = { projectName: project, totalCost: 0, totalLiters: 0, entries: 0, vehicles: new Set() };
      }
      table[project].totalCost += Number(r.totalAmount || 0);
      table[project].totalLiters += Number(r.quantityLiters || 0);
      table[project].entries += 1;
      if (r.vehicleId) table[project].vehicles.add(String(r.vehicleId));
    });
    return Object.values(table)
      .map(({ vehicles, ...rest }) => ({ ...rest, vehicleCount: vehicles.size }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [fuelThisMonth, vehicleMap]);

  const totalCost = useMemo(() => rows.reduce((s, r) => s + r.totalCost, 0), [rows]);
  const maxCost = useMemo(() => rows.reduce((max, r) => Math.max(max, r.totalCost), 0), [rows]);

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Fuel Cost');
      ws.columns = [
        { header: 'Project', key: 'projectName', width: 34 },
        { header: 'Total Fuel Cost (INR)', key: 'totalCost', width: 22 },
        { header: 'Total Liters', key: 'totalLiters', width: 14 },
        { header: 'Fuel Entries', key: 'entries', width: 14 },
        { header: 'Vehicles Used', key: 'vehicleCount', width: 16 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          projectName: r.projectName,
          totalCost: r.totalCost,
          totalLiters: r.totalLiters,
          entries: r.entries,
          vehicleCount: r.vehicleCount,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-fuel-cost-${month}.xlsx`;
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
        title="Project-wise Fuel Cost"
        description="Total fuel expenditure grouped by project for the selected month."
        icon={Layers}
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
                className="w-full bg-white/80 hover:bg-white sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-500/80 to-teal-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Fuel Cost</CardDescription>
            <CardTitle className="text-xl">{formatCurrency(totalCost)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{fuelThisMonth.length} entries this month</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-teal-500/80 to-cyan-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Active Projects</CardDescription>
            <CardTitle className="text-xl">{rows.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Projects with fuel activity</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-500/80 to-sky-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Top Project Cost</CardDescription>
            <CardTitle className="text-xl">{rows[0] ? formatCurrency(rows[0].totalCost) : 'N/A'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground truncate">{rows[0]?.projectName || '-'}</CardContent>
        </Card>
      </div>

      <TableCard title="Project Fuel Breakdown" icon={Layers} count={rows.length} noun="project">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No data for selected month.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-3 sm:hidden">
              {rows.map((item) => (
                <div key={item.projectName} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {item.projectName === 'Unassigned' ? (
                        <Badge variant="outline">Unassigned</Badge>
                      ) : (
                        item.projectName
                      )}
                    </span>
                    <span className="text-sm font-medium">{formatCurrency(item.totalCost)}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600"
                      style={{ width: `${maxCost > 0 ? (item.totalCost / maxCost) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {item.totalLiters.toFixed(1)} L · {item.entries} entries · {item.vehicleCount} vehicles
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <Table containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Total Fuel Cost</TableHead>
                    <TableHead className="text-right">Total Liters</TableHead>
                    <TableHead className="text-right">Fuel Entries</TableHead>
                    <TableHead className="text-right">Vehicles Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.projectName}>
                      <TableCell className="font-medium">
                        {item.projectName === 'Unassigned' ? (
                          <Badge variant="outline">Unassigned</Badge>
                        ) : (
                          item.projectName
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <div className="space-y-1">
                          <div>{formatCurrency(item.totalCost)}</div>
                          <div className="h-1.5 w-40 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all"
                              style={{ width: `${maxCost > 0 ? (item.totalCost / maxCost) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{item.totalLiters.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.entries}</TableCell>
                      <TableCell className="text-right tabular-nums">{item.vehicleCount}</TableCell>
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
