'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import {
  ALERT_STAGE_LABELS,
  computeRenewalMeta,
  getVehicleComplianceRequirements,
  VEHICLE_COLLECTIONS,
  type VehicleComplianceRequirements,
} from '@/lib/vehicle-management';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { TableCard } from '@/components/shared/table-card';
import { FilterBar } from '@/components/shared/filter-bar';
import { StatusBadge } from '@/components/shared/status-badge';
import { VM_SEGMENT_TRACK, VmStatStrip, vmSegmentItem } from '@/components/vehicle-management/vm-ui';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL_MODULES = ['All', 'Insurance', 'PUC', 'Fitness', 'Road Tax', 'Permit', 'Documents', 'Driver License'] as const;
const STATUS_OPTIONS = ['All', 'Expired', 'Due Today', 'Due Within 30 Days', 'Future', 'Missing Date'] as const;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

type AlertRow = {
  module: string;
  vehicleNumber: string;
  reference: string;
  expiryDate: string;
  alertStage: string;
  complianceStatus: string;
  daysToExpiry: number | null;
  expiryMonth: number | null;
  expiryYear: number | null;
};

export default function ExpiryAlertsReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [monthFilter, setMonthFilter] = useState<string>('All');
  const [yearFilter, setYearFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [insuranceRows, setInsuranceRows] = useState<Record<string, any>[]>([]);
  const [pucRows, setPucRows] = useState<Record<string, any>[]>([]);
  const [fitnessRows, setFitnessRows] = useState<Record<string, any>[]>([]);
  const [roadTaxRows, setRoadTaxRows] = useState<Record<string, any>[]>([]);
  const [permitRows, setPermitRows] = useState<Record<string, any>[]>([]);
  const [documentRows, setDocumentRows] = useState<Record<string, any>[]>([]);
  const [driverRows, setDriverRows] = useState<Record<string, any>[]>([]);
  const [vehicleMap, setVehicleMap] = useState<Record<string, Record<string, any>>>({});

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const [insSnap, pucSnap, fitSnap, rtSnap, permSnap, docSnap, drvSnap, vehSnap] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.insurance)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.puc)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fitness)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.roadTax)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.permit)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.documents)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.driver)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.vehicleMaster)),
        ]);
        setInsuranceRows(insSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPucRows(pucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFitnessRows(fitSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRoadTaxRows(rtSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPermitRows(permSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDocumentRows(docSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDriverRows(drvSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setVehicleMap(Object.fromEntries(vehSnap.docs.map((d) => [d.id, d.data()])));
      } catch (err) {
        console.error('Failed to load expiry alerts report', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const allAlerts = useMemo(() => {
    const rows: AlertRow[] = [];

    const push = (
      module: string,
      collection: Record<string, any>[],
      expiryKey: string,
      refGetter: (r: Record<string, any>) => string,
      requirementKey?: keyof VehicleComplianceRequirements
    ) => {
      collection.forEach((r) => {
        if (r.isArchived === true || r.renewalStatus === 'Renewed') return;
        // Skip categories that don't even apply to this vehicle (e.g. insurance/PUC/etc.
        // for a Sold/Scrapped vehicle) so they don't inflate the expired/due-soon counts.
        if (requirementKey) {
          const vehicle = vehicleMap[String(r.vehicleId || '')];
          if (vehicle && !getVehicleComplianceRequirements(vehicle)[requirementKey]) return;
        }
        const expiryDate = String(r[expiryKey] || '');
        const meta = computeRenewalMeta(expiryDate);
        const parsedDate = expiryDate ? new Date(`${expiryDate}T00:00:00`) : null;
        const validDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const daysToExpiry = validDate
          ? Math.ceil((validDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
          : null;
        rows.push({
          module,
          vehicleNumber: String(r.vehicleNumber || r.assignedVehicleNumber || 'Unknown'),
          reference: refGetter(r),
          expiryDate,
          alertStage: meta.alertStage,
          complianceStatus: meta.complianceStatus,
          daysToExpiry,
          expiryMonth: validDate ? validDate.getMonth() + 1 : null,
          expiryYear: validDate ? validDate.getFullYear() : null,
        });
      });
    };

    push('Insurance', insuranceRows, 'expiryDate', (r) => String(r.policyNumber || '-'), 'insurance');
    push('PUC', pucRows, 'expiryDate', (r) => String(r.pucCertificateNumber || '-'), 'puc');
    push('Fitness', fitnessRows, 'expiryDate', (r) => String(r.fitnessCertificateNumber || '-'), 'fitness');
    push('Road Tax', roadTaxRows, 'validTill', (r) => String(r.receiptNumber || '-'), 'roadTax');
    push('Permit', permitRows, 'validTill', (r) => String(r.permitNumber || '-'), 'permit');
    // Documents and driver licenses aren't covered by getVehicleComplianceRequirements, so
    // they're always evaluated as-is (no requirementKey passed).
    push('Documents', documentRows, 'expiryDate', (r) => String(r.documentType || '-'));
    push('Driver License', driverRows, 'licenseExpiryDate', (r) => String(r.licenseNumber || '-'));

    return rows.sort((a, b) => {
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate.localeCompare(b.expiryDate);
    });
  }, [insuranceRows, pucRows, fitnessRows, roadTaxRows, permitRows, documentRows, driverRows, vehicleMap]);

  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>([currentYear, currentYear + 1, currentYear + 2, currentYear + 3]);
    allAlerts.forEach((row) => row.expiryYear && years.add(row.expiryYear));
    return Array.from(years).sort((a, b) => a - b);
  }, [allAlerts]);

  const filteredAlerts = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return allAlerts.filter((row) => {
      if (moduleFilter !== 'All' && row.module !== moduleFilter) return false;
      if (monthFilter !== 'All' && row.expiryMonth !== Number(monthFilter)) return false;
      if (yearFilter !== 'All' && row.expiryYear !== Number(yearFilter)) return false;
      if (statusFilter === 'Expired' && (row.daysToExpiry === null || row.daysToExpiry >= 0)) return false;
      if (statusFilter === 'Due Today' && row.daysToExpiry !== 0) return false;
      if (statusFilter === 'Due Within 30 Days' && (row.daysToExpiry === null || row.daysToExpiry < 0 || row.daysToExpiry > 30)) return false;
      if (statusFilter === 'Future' && (row.daysToExpiry === null || row.daysToExpiry <= 30)) return false;
      if (statusFilter === 'Missing Date' && row.daysToExpiry !== null) return false;
      if (term && !`${row.vehicleNumber} ${row.reference} ${row.module}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [allAlerts, moduleFilter, monthFilter, searchQuery, statusFilter, yearFilter]);

  const expiredCount = useMemo(
    () => allAlerts.filter((r) => r.alertStage === 'Expired').length,
    [allAlerts]
  );
  const dueTodayCount = useMemo(
    () => allAlerts.filter((r) => r.alertStage === 'Due Today').length,
    [allAlerts]
  );
  const dueSoonCount = useMemo(
    () => allAlerts.filter((r) => ['7d', '15d', '30d'].includes(r.alertStage)).length,
    [allAlerts]
  );
  const futureCount = useMemo(
    () => allAlerts.filter((r) => r.daysToExpiry !== null && r.daysToExpiry > 30).length,
    [allAlerts]
  );

  const resetFilters = () => {
    setModuleFilter('All');
    setStatusFilter('All');
    setMonthFilter('All');
    setYearFilter('All');
    setSearchQuery('');
  };

  const exportExcel = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Expiry Alerts');
      ws.columns = [
        { header: 'Module', key: 'module', width: 18 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 20 },
        { header: 'Reference', key: 'reference', width: 24 },
        { header: 'Expiry Date', key: 'expiryDate', width: 16 },
        { header: 'Alert Stage', key: 'alertStage', width: 16 },
        { header: 'Compliance Status', key: 'complianceStatus', width: 20 },
        { header: 'Days to Expiry', key: 'daysToExpiry', width: 18 },
      ];
      filteredAlerts.forEach((r) =>
        ws.addRow({
          ...r,
          alertStage: ALERT_STAGE_LABELS[r.alertStage] || r.alertStage,
          daysToExpiry: r.daysToExpiry === null ? 'Missing Date' : r.daysToExpiry,
        })
      );
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expiry-alerts${moduleFilter !== 'All' ? `-${moduleFilter.toLowerCase().replace(/\s+/g, '-')}` : ''}.xlsx`;
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

  const alertBadge = (stage: string) => (
    <StatusBadge status={stage} tone={stage === 'Expired' ? 'danger' : 'warning'}>
      {ALERT_STAGE_LABELS[stage] || stage}
    </StatusBadge>
  );

  return (
    <div className="vm-report-page space-y-3 sm:space-y-4">
      <PageHeader
        title="Expiry-wise Report"
        description="Review expired, upcoming, and future compliance expiries month-wise and year-wise."
        icon={AlertTriangle}
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
          { label: 'Expired', value: expiredCount, tone: expiredCount > 0 ? 'danger' : 'default', hint: 'Immediate action needed' },
          { label: 'Due Today', value: dueTodayCount, tone: dueTodayCount > 0 ? 'warning' : 'default', hint: 'Expiring today' },
          { label: 'Due Soon', value: dueSoonCount, tone: dueSoonCount > 0 ? 'warning' : 'default', hint: 'Within 30 days' },
          { label: 'Future', value: futureCount, hint: 'More than 30 days ahead' },
        ]}
      />

      <TableCard
        title={moduleFilter === 'All' ? 'All Expiry Records' : `${moduleFilter} Expiries`}
        description="Select any future month and year to plan renewals in advance."
        icon={AlertTriangle}
        count={filteredAlerts.length}
        total={allAlerts.length}
        noun="alert"
        toolbar={
          <div className="space-y-2">
            {/* Module filter tabs */}
            <div className={VM_SEGMENT_TRACK}>
              {ALL_MODULES.map((m) => (
                <button
                  key={m}
                  onClick={() => setModuleFilter(m)}
                  className={vmSegmentItem(moduleFilter === m)}
                >
                  {m}
                  {m !== 'All' && (
                    <span className="tabular-nums opacity-70">
                      {allAlerts.filter((r) => r.module === m).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <FilterBar
              search={{ value: searchQuery, onChange: setSearchQuery, placeholder: 'Vehicle or reference...' }}
              activeCount={[moduleFilter, statusFilter, monthFilter, yearFilter].filter((value) => value !== 'All').length}
              onClear={resetFilters}
            >
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue placeholder="Expiry status" /></SelectTrigger>
                <SelectContent>{STATUS_OPTIONS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger><SelectValue placeholder="Expiry month" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Months</SelectItem>
                  {MONTHS.map((month, index) => <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger><SelectValue placeholder="Expiry year" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Years</SelectItem>
                  {availableYears.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterBar>
          </div>
        }
      >
        {filteredAlerts.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No expiry records match the selected filters.
          </div>
        ) : (
          <>
            <div className="space-y-2 p-3 sm:hidden">
              {filteredAlerts.map((item, idx) => (
                <div
                  key={`${item.module}-${item.reference}-${idx}`}
                  className="rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{item.module}</span>
                    {alertBadge(item.alertStage)}
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Vehicle</span>
                      <span className="font-medium">{item.vehicleNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time Remaining</span>
                      <span>{item.daysToExpiry === null ? '-' : item.daysToExpiry < 0 ? `${Math.abs(item.daysToExpiry)} days overdue` : `${item.daysToExpiry} days`}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reference</span>
                      <span>{item.reference}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Expiry</span>
                      <span>{item.expiryDate || '-'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block">
              <Table containerClassName="overflow-visible">
                <TableHeader>
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead>Alert Stage</TableHead>
                    <TableHead>Compliance</TableHead>
                    <TableHead>Time Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((item, idx) => (
                    <TableRow key={`${item.module}-${item.reference}-${idx}`}>
                      <TableCell>{item.module}</TableCell>
                      <TableCell className="font-medium">{item.vehicleNumber}</TableCell>
                      <TableCell>{item.reference}</TableCell>
                      <TableCell className="whitespace-nowrap">{item.expiryDate || '-'}</TableCell>
                      <TableCell>{alertBadge(item.alertStage)}</TableCell>
                      <TableCell>{item.complianceStatus}</TableCell>
                      <TableCell className={item.daysToExpiry !== null && item.daysToExpiry < 0 ? 'whitespace-nowrap font-medium text-rose-600' : 'whitespace-nowrap'}>
                        {item.daysToExpiry === null ? '-' : item.daysToExpiry < 0 ? `${Math.abs(item.daysToExpiry)} days overdue` : item.daysToExpiry === 0 ? 'Today' : `${item.daysToExpiry} days`}
                      </TableCell>
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
