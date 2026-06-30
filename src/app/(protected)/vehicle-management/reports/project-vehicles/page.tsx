'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { ChevronLeft, Download, FolderOpen } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export default function ProjectVehiclesReportPage() {
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
        console.error('Failed to load project vehicles report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const rows = useMemo(() => {
    const table: Record<
      string,
      { projectName: string; total: number; active: number; inactive: number; types: Record<string, number> }
    > = {};
    vehicles.forEach((v) => {
      const project = String(v.assignedProjectName || v.assignedProjectId || 'Unassigned');
      if (!table[project]) {
        table[project] = { projectName: project, total: 0, active: 0, inactive: 0, types: {} };
      }
      table[project].total += 1;
      const status = String(v.currentStatus || v.vehicleStatus || '').toLowerCase();
      if (status === 'active') table[project].active += 1;
      else table[project].inactive += 1;
      const type = String(v.vehicleType || 'Unknown');
      table[project].types[type] = (table[project].types[type] || 0) + 1;
    });
    return Object.values(table).sort((a, b) => b.total - a.total);
  }, [vehicles]);

  const maxTotal = useMemo(() => rows.reduce((max, r) => Math.max(max, r.total), 0), [rows]);
  const activeCount = useMemo(
    () => vehicles.filter((v) => String(v.currentStatus || v.vehicleStatus || '').toLowerCase() === 'active').length,
    [vehicles]
  );
  const unassignedCount = useMemo(
    () => vehicles.filter((v) => !v.assignedProjectId && !v.assignedProjectName).length,
    [vehicles]
  );

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Project Vehicle Count');
      ws.columns = [
        { header: 'Project', key: 'projectName', width: 34 },
        { header: 'Total Vehicles', key: 'total', width: 16 },
        { header: 'Active', key: 'active', width: 12 },
        { header: 'Inactive / Other', key: 'inactive', width: 18 },
        { header: 'Vehicle Types', key: 'types', width: 44 },
      ];
      rows.forEach((r) =>
        ws.addRow({
          projectName: r.projectName,
          total: r.total,
          active: r.active,
          inactive: r.inactive,
          types: Object.entries(r.types)
            .map(([type, count]) => `${type}: ${count}`)
            .join(', '),
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-vehicle-count.xlsx`;
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
        <div className="h-1 w-full bg-gradient-to-r from-fuchsia-500 to-violet-500" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <FolderOpen className="h-4 w-4 text-fuchsia-500" /> Project Vehicle Count
            </CardTitle>
            <CardDescription>
              Vehicles deployed per project with active/inactive status and type breakdown. Fleet-wide — not filtered by month.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-fuchsia-500/80 to-violet-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Total Fleet Size</CardDescription>
            <CardTitle className="text-xl">{vehicles.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{activeCount} active vehicles</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-violet-500/80 to-purple-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Projects with Vehicles</CardDescription>
            <CardTitle className="text-xl">{rows.filter((r) => r.projectName !== 'Unassigned').length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {rows.length} total groups
          </CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-slate-400/80 to-slate-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Unassigned Vehicles</CardDescription>
            <CardTitle className="text-xl">{unassignedCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">No project linked</CardContent>
        </Card>
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">Vehicles by Project</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:hidden">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No vehicle data.
            </div>
          ) : (
            rows.map((item) => (
              <div key={item.projectName} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {item.projectName === 'Unassigned' ? (
                      <Badge variant="outline">Unassigned</Badge>
                    ) : (
                      item.projectName
                    )}
                  </span>
                  <span className="text-lg font-bold text-slate-700">{item.total}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-500 transition-all duration-500"
                    style={{ width: `${maxTotal > 0 ? (item.total / maxTotal) * 100 : 0}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <span className="font-medium text-emerald-600">{item.active} active</span>
                  <span className="text-rose-500">{item.inactive} inactive/other</span>
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground">
                  {Object.entries(item.types)
                    .map(([type, count]) => `${type}: ${count}`)
                    .join(' · ')}
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
                    <TableHead>Project</TableHead>
                    <TableHead>Total Vehicles</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead>Inactive / Other</TableHead>
                    <TableHead>Vehicle Types</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.projectName} className="hover:bg-fuchsia-50/50 transition-colors">
                      <TableCell className="font-medium">
                        {item.projectName === 'Unassigned' ? (
                          <Badge variant="outline">Unassigned</Badge>
                        ) : (
                          item.projectName
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-semibold">{item.total}</div>
                          <div className="h-1.5 w-40 rounded-full bg-slate-100">
                            <div
                              className="h-1.5 rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-500 transition-all"
                              style={{ width: `${maxTotal > 0 ? (item.total / maxTotal) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-emerald-600">{item.active}</TableCell>
                      <TableCell className="text-rose-500">{item.inactive}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(item.types).map(([type, count]) => (
                          <span key={type} className="mr-2 inline-flex items-center gap-1">
                            <Badge variant="outline" className="px-1 py-0 text-[10px]">
                              {type}
                            </Badge>
                            <span>{count}</span>
                          </span>
                        ))}
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
