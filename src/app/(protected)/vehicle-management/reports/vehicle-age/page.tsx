'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { Car, Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { VmStatStrip, type VmStat, type VmStatTone } from '@/components/vehicle-management/vm-ui';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);

const BRACKETS = ['New (0-2 yrs)', 'Moderate (3-5 yrs)', 'Old (6-10 yrs)', 'Aging (10+ yrs)', 'Unknown'] as const;

// `tone` colours the table's badges; `stat` colours a bracket's count in the summary strip, and
// only the brackets that call for attention (old, aging) get a colour there.
const bracketStyle: Record<string, { tone: StatusTone; stat: VmStatTone }> = {
  'New (0-2 yrs)': { tone: 'success', stat: 'default' },
  'Moderate (3-5 yrs)': { tone: 'info', stat: 'default' },
  'Old (6-10 yrs)': { tone: 'warning', stat: 'warning' },
  'Aging (10+ yrs)': { tone: 'danger', stat: 'danger' },
  Unknown: { tone: 'neutral', stat: 'muted' },
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
    <div className="vm-report-page space-y-3 sm:space-y-4">
      <PageHeader
        title="Vehicle Age Report"
        description="Fleet age analysis by year of manufacture. Fleet-wide — not filtered by month."
        icon={Car}
        backHref="/vehicle-management/reports"
        backLabel="Back to Reports"
        actions={
          canExport ? (
            <Button
              variant="outline"
              onClick={exportExcel}
              disabled={isExporting}
              className="w-full md:w-auto"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export Excel'}
            </Button>
          ) : undefined
        }
      />

      <VmStatStrip
        stats={[
          { label: 'Total Vehicles', value: vehicles.length, hint: 'Across entire fleet' },
          {
            label: 'Average Fleet Age',
            value: ageStats.avg !== null ? `${ageStats.avg} yrs` : 'N/A',
            hint: 'Based on year of manufacture',
          },
          {
            label: 'Newest Vehicle',
            value: <span title={ageStats.newest?.vehicleNumber || 'N/A'}>{ageStats.newest?.vehicleNumber || 'N/A'}</span>,
            hint: ageStats.newest?.age !== null ? `${ageStats.newest?.age} yrs old (${ageStats.newest?.yearOfManufacture})` : '-',
          },
          {
            label: 'Oldest Vehicle',
            value: <span title={ageStats.oldest?.vehicleNumber || 'N/A'}>{ageStats.oldest?.vehicleNumber || 'N/A'}</span>,
            hint: ageStats.oldest?.age !== null ? `${ageStats.oldest?.age} yrs old (${ageStats.oldest?.yearOfManufacture})` : '-',
          },
        ]}
      />

      {/* Age bracket summary */}
      <VmStatStrip
        stats={bracketCounts.map((b): VmStat => ({
          label: b.bracket,
          value: b.count,
          tone: b.count > 0 ? bracketStyle[b.bracket]?.stat ?? 'default' : 'default',
        }))}
      />

      <TableCard title="Fleet Age Details" icon={Car} count={rows.length} noun="vehicle">
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No vehicle data.
          </div>
        ) : (
          <>
            <div className="space-y-2 p-3 sm:hidden">
              {rows.map((row) => (
                <div key={row.vehicleNumber} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{row.vehicleNumber}</span>
                    <StatusBadge status={row.bracket} tone={bracketStyle[row.bracket]?.tone ?? 'neutral'}>
                      {row.age !== null ? `${row.age} yrs` : 'Unknown'}
                    </StatusBadge>
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
              ))}
            </div>
            <div className="hidden sm:block">
              <Table containerClassName="overflow-visible">
                <TableHeader>
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
                    <TableHead className="text-right">Purchase Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.vehicleNumber}>
                      <TableCell className="font-medium">{row.vehicleNumber}</TableCell>
                      <TableCell>{row.brand} {row.model}</TableCell>
                      <TableCell className="tabular-nums">{row.yearOfManufacture ?? '-'}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{row.age !== null ? `${row.age} yrs` : '-'}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.bracket} tone={bracketStyle[row.bracket]?.tone ?? 'neutral'}>
                          {row.bracket}
                        </StatusBadge>
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
                      <TableCell className="text-right tabular-nums">{row.purchaseValue > 0 ? formatCurrency(row.purchaseValue) : '-'}</TableCell>
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
