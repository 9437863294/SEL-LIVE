'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ExcelJS from 'exceljs';
import { collection, getDocs } from 'firebase/firestore';
import { AlertTriangle, ChevronLeft, Download } from 'lucide-react';
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
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

const ALL_MODULES = ['All', 'Insurance', 'PUC', 'Fitness', 'Road Tax', 'Permit', 'Documents', 'Driver License'] as const;

type AlertRow = {
  module: string;
  vehicleNumber: string;
  reference: string;
  expiryDate: string;
  alertStage: string;
  complianceStatus: string;
};

export default function ExpiryAlertsReportPage() {
  const { can } = useAuthorization();
  const canView = can('View', 'Vehicle Management.Reports');
  const canExport = can('Export', 'Vehicle Management.Reports') || canView;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('All');
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
        const [insSnap, pucSnap, fitSnap, rtSnap, permSnap, docSnap, drvSnap] = await Promise.all([
          getDocs(collection(db, VEHICLE_COLLECTIONS.insurance)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.puc)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.fitness)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.roadTax)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.permit)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.documents)),
          getDocs(collection(db, VEHICLE_COLLECTIONS.driver)),
        ]);
        setInsuranceRows(insSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPucRows(pucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFitnessRows(fitSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRoadTaxRows(rtSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPermitRows(permSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDocumentRows(docSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setDriverRows(drvSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
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
      refGetter: (r: Record<string, any>) => string
    ) => {
      collection.forEach((r) => {
        const expiryDate = String(r[expiryKey] || '');
        const meta = computeRenewalMeta(expiryDate);
        if (!['Expired', 'Due Today', '7d', '15d', '30d', 'Missing'].includes(meta.alertStage)) return;
        rows.push({
          module,
          vehicleNumber: String(r.vehicleNumber || r.assignedVehicleNumber || 'Unknown'),
          reference: refGetter(r),
          expiryDate,
          alertStage: meta.alertStage,
          complianceStatus: meta.complianceStatus,
        });
      });
    };

    push('Insurance', insuranceRows, 'expiryDate', (r) => String(r.policyNumber || '-'));
    push('PUC', pucRows, 'expiryDate', (r) => String(r.pucCertificateNumber || '-'));
    push('Fitness', fitnessRows, 'expiryDate', (r) => String(r.fitnessCertificateNumber || '-'));
    push('Road Tax', roadTaxRows, 'validTill', (r) => String(r.receiptNumber || '-'));
    push('Permit', permitRows, 'validTill', (r) => String(r.permitNumber || '-'));
    push('Documents', documentRows, 'expiryDate', (r) => String(r.documentType || '-'));
    push('Driver License', driverRows, 'licenseExpiryDate', (r) => String(r.licenseNumber || '-'));

    return rows.sort((a, b) => {
      const p = getAlertPriority(a.alertStage) - getAlertPriority(b.alertStage);
      return p !== 0 ? p : String(a.expiryDate).localeCompare(String(b.expiryDate));
    });
  }, [insuranceRows, pucRows, fitnessRows, roadTaxRows, permitRows, documentRows, driverRows]);

  const filteredAlerts = useMemo(
    () => (moduleFilter === 'All' ? allAlerts : allAlerts.filter((r) => r.module === moduleFilter)),
    [allAlerts, moduleFilter]
  );

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
      ];
      filteredAlerts.forEach((r) =>
        ws.addRow({ ...r, alertStage: ALERT_STAGE_LABELS[r.alertStage] || r.alertStage })
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
    <Badge
      variant={stage === 'Expired' ? 'destructive' : 'outline'}
      className={stage !== 'Expired' ? 'bg-amber-50 text-amber-700' : ''}
    >
      {ALERT_STAGE_LABELS[stage] || stage}
    </Badge>
  );

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-rose-500 to-red-600" />
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/vehicle-management/reports"
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back to Reports
            </Link>
            <CardTitle className="flex items-center gap-2 tracking-tight">
              <AlertTriangle className="h-4 w-4 text-rose-500" /> Expiry Alert Center
            </CardTitle>
            <CardDescription>All compliance expiry alerts fleet-wide across all document types.</CardDescription>
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

      <div className="grid grid-cols-3 gap-4">
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-red-600/90 to-rose-600/90" />
          <CardHeader className="pb-2">
            <CardDescription>Expired</CardDescription>
            <CardTitle className="text-xl text-rose-600">{expiredCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Immediate action needed</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-orange-500/80 to-amber-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Due Today</CardDescription>
            <CardTitle className="text-xl text-orange-500">{dueTodayCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Expiring today</CardContent>
        </Card>
        <Card className="vm-panel overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-amber-400/80 to-yellow-500/80" />
          <CardHeader className="pb-2">
            <CardDescription>Due Soon</CardDescription>
            <CardTitle className="text-xl text-amber-600">{dueSoonCount}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Within 30 days</CardContent>
        </Card>
      </div>

      {/* Module filter tabs */}
      <div className="flex flex-wrap gap-2">
        {ALL_MODULES.map((m) => (
          <button
            key={m}
            onClick={() => setModuleFilter(m)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              moduleFilter === m
                ? 'border-rose-300 bg-rose-500 text-white shadow-sm'
                : 'border-white/70 bg-white/80 text-slate-600 hover:bg-white'
            }`}
          >
            {m}
            {m !== 'All' && (
              <span className="ml-1.5 opacity-70">
                {allAlerts.filter((r) => r.module === m).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle className="text-base">
            {moduleFilter === 'All' ? 'All Compliance Alerts' : `${moduleFilter} Alerts`}
          </CardTitle>
          <CardDescription>{filteredAlerts.length} alert{filteredAlerts.length !== 1 ? 's' : ''} found</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 sm:hidden">
          {filteredAlerts.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-3 py-6 text-center text-muted-foreground">
              No active compliance alerts.
            </div>
          ) : (
            filteredAlerts.map((item, idx) => (
              <div
                key={`${item.module}-${item.reference}-${idx}`}
                className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm"
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
                    <span className="text-muted-foreground">Reference</span>
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
        <CardContent className="hidden sm:block p-0">
          {filteredAlerts.length === 0 ? (
            <div className="rounded-lg border border-white/70 bg-white/80 px-4 py-10 text-center text-muted-foreground">
              No active compliance alerts.
            </div>
          ) : (
            <div className="overflow-auto rounded-lg border border-white/70 bg-white/80 h-[calc(100vh-420px)]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <TableRow>
                    <TableHead>Module</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Expiry Date</TableHead>
                    <TableHead>Alert Stage</TableHead>
                    <TableHead>Compliance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAlerts.map((item, idx) => (
                    <TableRow
                      key={`${item.module}-${item.reference}-${idx}`}
                      className="hover:bg-rose-50/50 transition-colors"
                    >
                      <TableCell>{item.module}</TableCell>
                      <TableCell className="font-medium">{item.vehicleNumber}</TableCell>
                      <TableCell>{item.reference}</TableCell>
                      <TableCell>{item.expiryDate || '-'}</TableCell>
                      <TableCell>{alertBadge(item.alertStage)}</TableCell>
                      <TableCell>{item.complianceStatus}</TableCell>
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
