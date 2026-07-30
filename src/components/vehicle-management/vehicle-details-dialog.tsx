'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs } from 'firebase/firestore';
import { Clock, ExternalLink, History, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { computeRenewalMeta, formatVehicleTimestamp, getVehicleTimestampMillis, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Row = Record<string, any>;

type ComplianceSection = {
  title: string;
  href: string;
  rows: Row[];
  referenceKeys: string[];
  expiryKeys: string[];
};

type ActivitySection = {
  title: string;
  href: string;
  rows: Row[];
  dateKeys: string[];
  detail: (row: Row) => string;
  metrics: (row: Row) => string;
  statusKeys: string[];
};

const firstValue = (row: Row, keys: string[]) =>
  keys.map((key) => String(row[key] || '').trim()).find(Boolean) || '-';

const renewalHref = (base: string, row: Row, vehicle: Row) => {
  const params = new URLSearchParams({
    renew: String(row.id),
    vid: String(vehicle.id),
    vnum: String(vehicle.vehicleNumber || vehicle.registrationNo || ''),
  });
  return `${base}?${params.toString()}`;
};

export function VehicleDetailsDialog({
  vehicle,
  open,
  onOpenChange,
  canRenewInsurance,
}: {
  vehicle: Row | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRenewInsurance: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<Record<string, Row[]>>({});
  const [selectedSection, setSelectedSection] = useState('All');

  useEffect(() => {
    if (!open || !vehicle) return;
    setSelectedSection('All');
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const sources = [
          VEHICLE_COLLECTIONS.insurance,
          VEHICLE_COLLECTIONS.puc,
          VEHICLE_COLLECTIONS.fitness,
          VEHICLE_COLLECTIONS.roadTax,
          VEHICLE_COLLECTIONS.permit,
          VEHICLE_COLLECTIONS.documents,
          VEHICLE_COLLECTIONS.maintenance,
          VEHICLE_COLLECTIONS.fuel,
          VEHICLE_COLLECTIONS.trips,
          VEHICLE_COLLECTIONS.driverDailyStatus,
          VEHICLE_COLLECTIONS.driver,
        ];
        const snapshots = await Promise.all(sources.map((name) => getDocs(collection(db, name))));
        if (cancelled) return;
        const vehicleId = String(vehicle.id || '');
        const vehicleNumber = String(vehicle.vehicleNumber || vehicle.registrationNo || '').toLowerCase();
        const next: Record<string, Row[]> = {};
        sources.forEach((name, index) => {
          next[name] = snapshots[index].docs
            .map((entry): Row => ({ id: entry.id, ...(entry.data() as Row) }))
            .filter((row) =>
              String(row.vehicleId || '') === vehicleId ||
              String(row.assignedVehicleId || '') === vehicleId ||
              String(row.vehicleNumber || row.registrationNo || row.assignedVehicleNumber || '').toLowerCase() === vehicleNumber
            )
            .sort((a, b) => getVehicleTimestampMillis(b.createdAt) - getVehicleTimestampMillis(a.createdAt));
        });
        setRecords(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [open, vehicle]);

  const sections = useMemo<ComplianceSection[]>(() => [
    { title: 'Insurance', href: '/vehicle-management/insurance', rows: records[VEHICLE_COLLECTIONS.insurance] || [], referenceKeys: ['policyNumber', 'insuranceCompany'], expiryKeys: ['expiryDate'] },
    { title: 'PUC', href: '/vehicle-management/puc', rows: records[VEHICLE_COLLECTIONS.puc] || [], referenceKeys: ['pucCertificateNumber', 'testingCenterName'], expiryKeys: ['expiryDate'] },
    { title: 'Fitness', href: '/vehicle-management/fitness', rows: records[VEHICLE_COLLECTIONS.fitness] || [], referenceKeys: ['fitnessCertificateNumber', 'rtoName'], expiryKeys: ['expiryDate'] },
    { title: 'Road Tax', href: '/vehicle-management/road-tax', rows: records[VEHICLE_COLLECTIONS.roadTax] || [], referenceKeys: ['receiptNumber', 'taxType'], expiryKeys: ['validTill', 'expiryDate'] },
    { title: 'Permit', href: '/vehicle-management/permit', rows: records[VEHICLE_COLLECTIONS.permit] || [], referenceKeys: ['permitNumber', 'permitType'], expiryKeys: ['validTill', 'expiryDate'] },
    { title: 'Documents', href: '/vehicle-management/documents', rows: records[VEHICLE_COLLECTIONS.documents] || [], referenceKeys: ['documentNumber', 'documentType'], expiryKeys: ['expiryDate'] },
  ], [records]);

  const activitySections = useMemo<ActivitySection[]>(() => [
    {
      title: 'Driver Assignment History',
      href: '/vehicle-management/driver',
      rows: records[VEHICLE_COLLECTIONS.driver] || [],
      dateKeys: ['joiningDate', 'assignedDate'],
      detail: (row) => `${row.driverName || '-'} · ${row.mobileNumber || '-'} · License ${row.licenseNumber || '-'}`,
      metrics: (row) => `${row.experienceYears || 0} years experience · Blood ${row.bloodGroup || '-'}`,
      statusKeys: ['status'],
    },
    {
      title: 'Driver Daily Logs',
      href: '/vehicle-management/driver-mobile/daily-status',
      rows: records[VEHICLE_COLLECTIONS.driverDailyStatus] || [],
      dateKeys: ['statusDate'],
      detail: (row) => `${row.driverName || '-'} · ${row.routeSummary || 'No route summary'}`,
      metrics: (row) => `${Number(row.totalDistanceKm || 0).toFixed(1)} km · ${row.totalTrips || 0} trips`,
      statusKeys: ['runningStatus'],
    },
    {
      title: 'Trip Logs',
      href: '/vehicle-management/trips',
      rows: records[VEHICLE_COLLECTIONS.trips] || [],
      dateKeys: ['startTimeIso', 'startDate'],
      detail: (row) => `${row.driverName || '-'} · ${row.startAddress || '-'} → ${row.endAddress || '-'}`,
      metrics: (row) => `${Number(row.totalDistanceKm || 0).toFixed(2)} km · ${Number(row.totalPoints || 0)} points`,
      statusKeys: ['tripStatus'],
    },
    {
      title: 'Maintenance History',
      href: '/vehicle-management/maintenance',
      rows: records[VEHICLE_COLLECTIONS.maintenance] || [],
      dateKeys: ['serviceDate', 'serviceDoneDate'],
      detail: (row) => `${row.maintenanceType || '-'} · ${row.garageName || '-'} · ${row.workDescription || ''}`,
      metrics: (row) => `₹${Number(row.totalCost || 0).toLocaleString('en-IN')} · Odometer ${Number(row.odometerReadingKm || 0).toLocaleString('en-IN')} km`,
      statusKeys: ['approvalStatus'],
    },
    {
      title: 'Fuel Logs',
      href: '/vehicle-management/fuel',
      rows: records[VEHICLE_COLLECTIONS.fuel] || [],
      dateKeys: ['fuelDate'],
      detail: (row) => `${row.fillType || '-'} · ${row.fuelStationName || '-'} · ${row.billNumber || 'No bill number'}`,
      metrics: (row) => `${Number(row.quantityLiters || 0).toFixed(2)} L · ₹${Number(row.totalAmount || 0).toLocaleString('en-IN')} · ${row.mileageKmPerLiter || '-'} km/L`,
      statusKeys: ['fuelStatus'],
    },
  ], [records]);

  const sectionButtons = useMemo(() => [
    { title: 'All', count: sections.reduce((total, section) => total + section.rows.length, 0) + activitySections.reduce((total, section) => total + section.rows.length, 0) },
    ...sections.map((section) => ({ title: section.title, count: section.rows.length })),
    ...activitySections.map((section) => ({ title: section.title, count: section.rows.length })),
  ], [activitySections, sections]);

  if (!vehicle) return null;

  const detailFields = [
    ['Vehicle ID', vehicle.vehicleId], ['Vehicle Number', vehicle.vehicleNumber || vehicle.registrationNo],
    ['Type', vehicle.vehicleType], ['Category', vehicle.vehicleCategory], ['Brand', vehicle.brand],
    ['Model', vehicle.model], ['Manufacture Year', vehicle.yearOfManufacture], ['Fuel', vehicle.fuelType],
    ['Chassis Number', vehicle.chassisNumber], ['Engine Number', vehicle.engineNumber],
    ['Ownership', vehicle.ownershipType], ['Purchase Date', vehicle.purchaseDate],
    ['Odometer', vehicle.currentOdometerKm ? `${vehicle.currentOdometerKm} km` : '-'],
    ['Department', vehicle.assignedDepartmentName], ['Project', vehicle.assignedProjectName],
    ['Driver', vehicle.assignedDriverName], ['Status', vehicle.vehicleStatus],
    ['Created Time', formatVehicleTimestamp(vehicle.createdAt)],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:left-1/2 sm:top-1/2 sm:h-[92vh] sm:w-[calc(100vw-3rem)] sm:max-w-7xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl">
        <DialogHeader className="shrink-0 border-b bg-gradient-to-r from-emerald-50 to-cyan-50 px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" />{vehicle.vehicleNumber || 'Vehicle Profile'}</DialogTitle>
          <DialogDescription>Complete vehicle profile, compliance status, and old renewal history.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50 p-4 sm:p-6">
          <section className="rounded-xl border bg-white p-4">
            <h3 className="mb-3 font-semibold text-slate-800">Vehicle Details</h3>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
              {detailFields.map(([label, value]) => (
                <div key={String(label)}><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-0.5 break-words text-sm font-medium text-slate-800">{String(value || '-')}</p></div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Select details to expand</p>
            <div className="flex flex-wrap gap-2">
              {sectionButtons.map((section) => (
                <Button
                  key={section.title}
                  type="button"
                  size="sm"
                  variant={selectedSection === section.title ? 'default' : 'outline'}
                  onClick={() => setSelectedSection(section.title)}
                  className={selectedSection === section.title ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-white'}
                >
                  {section.title}
                  <Badge variant="secondary" className="ml-2 h-5 min-w-5 justify-center px-1.5">{section.count}</Badge>
                </Button>
              ))}
            </div>
          </section>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border bg-white py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading compliance records...</div>
          ) : sections.filter((section) => selectedSection === 'All' || selectedSection === section.title).map((section) => (
            <section key={section.title} className="overflow-hidden rounded-xl border bg-white">
              <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2"><h3 className="font-semibold">{section.title}</h3><Badge variant="outline">{section.rows.length} record{section.rows.length === 1 ? '' : 's'}</Badge></div>
                <Link href={section.href}><Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open</Button></Link>
              </div>
              {section.rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No records available.</p> : (
                <div className="overflow-x-auto"><table className="w-full text-sm"><TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Expiry</TableHead><TableHead>Compliance</TableHead><TableHead>Record</TableHead><TableHead>Created Time</TableHead>{section.title === 'Insurance' && <TableHead className="text-right">Action</TableHead>}</TableRow></TableHeader>
                  <TableBody>{section.rows.map((row) => { const expiry = firstValue(row, section.expiryKeys); const meta = computeRenewalMeta(expiry === '-' ? '' : expiry); return (
                    <TableRow key={String(row.id)}><TableCell className="font-medium">{firstValue(row, section.referenceKeys)}</TableCell><TableCell>{expiry}</TableCell><TableCell><Badge variant={meta.alertStage === 'Expired' ? 'destructive' : 'outline'}>{meta.alertStage}</Badge></TableCell><TableCell>{row.isArchived ? <Badge variant="secondary"><History className="mr-1 h-3 w-3" />History</Badge> : <Badge className="bg-emerald-600">Current</Badge>}</TableCell><TableCell className="whitespace-nowrap"><Clock className="mr-1 inline h-3.5 w-3.5" />{formatVehicleTimestamp(row.createdAt)}</TableCell>{section.title === 'Insurance' && <TableCell className="text-right">{!row.isArchived && canRenewInsurance ? <Link href={renewalHref(section.href, row, vehicle)}><Button size="sm" className="bg-amber-500 hover:bg-amber-600"><RefreshCw className="mr-1 h-3.5 w-3.5" />Renew</Button></Link> : '-'}</TableCell>}</TableRow>
                  );})}</TableBody></table></div>
              )}
            </section>
          ))}

          {!loading && activitySections.filter((section) => selectedSection === 'All' || selectedSection === section.title).map((section) => (
            <section key={section.title} className="overflow-hidden rounded-xl border bg-white">
              <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2"><h3 className="font-semibold">{section.title}</h3><Badge variant="outline">{section.rows.length} log{section.rows.length === 1 ? '' : 's'}</Badge></div>
                <Link href={section.href}><Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Open</Button></Link>
              </div>
              {section.rows.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No logs available.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <TableHeader><TableRow><TableHead>Date / Time</TableHead><TableHead>Details</TableHead><TableHead>Metrics</TableHead><TableHead>Status</TableHead><TableHead>Created Time</TableHead></TableRow></TableHeader>
                    <TableBody>{section.rows.map((row) => (
                      <TableRow key={String(row.id)}>
                        <TableCell className="whitespace-nowrap">{firstValue(row, section.dateKeys)}</TableCell>
                        <TableCell className="min-w-[260px] max-w-[460px]">{section.detail(row)}</TableCell>
                        <TableCell className="whitespace-nowrap">{section.metrics(row)}</TableCell>
                        <TableCell><Badge variant="outline">{firstValue(row, section.statusKeys)}</Badge></TableCell>
                        <TableCell className="whitespace-nowrap">{formatVehicleTimestamp(row.createdAt)}</TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
