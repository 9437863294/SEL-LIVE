'use client';

/**
 * My Vehicle — the driver's assigned vehicle, phone first: the vehicle (number, make and model,
 * status) with its odometer, fuel, type and how its papers stand; then each document as a tile
 * coloured by where it stands (valid, due, expired, missing); then the latest services, fuel fills
 * and the document folder.
 *
 * What a document needs is the vehicle's own rule (`getVehicleComplianceRequirements`, as Vehicle
 * Health applies it): a paper the vehicle does not need — fitness or a permit on a private two
 * wheeler — is listed once as not required instead of as a red "Missing" card. Where a document
 * stands is worked out from its expiry today, not read from the status stored with it, which goes
 * stale the day after it was saved. No page title: the module header and the sidebar (My Vehicle)
 * name the page, as on the other Fleet & Travel pages.
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { BadgeCheck, Bike, Bus, Car, ExternalLink, FileText, FolderOpen, Fuel, Gauge, Receipt, ShieldCheck, Truck, Wind, Wrench } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { VEHICLE_COLLECTIONS, getVehicleComplianceRequirements } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/shared/status-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VM_ICON_CHIP } from '@/components/vehicle-management/vm-ui';
import { cn } from '@/lib/utils';

const pickLatestByDate = (rows: Record<string, any>[], key: string) =>
  [...rows].sort((a, b) => String(b[key] || '').localeCompare(String(a[key] || '')))[0] || null;

const pickLatestDocByType = (rows: Record<string, any>[]) => {
  const grouped: Record<string, Record<string, any>> = {};
  rows.forEach((row) => {
    const type = String(row.documentType || 'Other');
    if (!grouped[type]) {
      grouped[type] = row;
      return;
    }
    const existingScore = String(grouped[type].expiryDate || grouped[type].issueDate || '');
    const nextScore = String(row.expiryDate || row.issueDate || '');
    if (nextScore.localeCompare(existingScore) > 0) {
      grouped[type] = row;
    }
  });
  return Object.values(grouped);
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount || 0
  );

const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

/** A stored date (YYYY-MM-DD, or anything Date reads) as "25 Oct 2027"; as stored when unreadable. */
const formatDate = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Whole days from today to that date (negative once past), on local calendar days. */
const daysUntil = (value: string) => {
  const target = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
};

/** Renewal reminders start this many days ahead, as in Renewals (computeRenewalMeta). */
const DUE_SOON_DAYS = 30;

type DocState = 'valid' | 'open' | 'due' | 'expired' | 'missing';

const STATE_TONE: Record<DocState, StatusTone> = { valid: 'success', open: 'success', due: 'warning', expired: 'danger', missing: 'danger' };
const STATE_CHIP: Record<DocState, string> = {
  valid: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  open: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  due: 'bg-amber-50 text-amber-600 ring-amber-100',
  expired: 'bg-rose-50 text-rose-600 ring-rose-100',
  missing: 'bg-rose-50 text-rose-600 ring-rose-100',
};
const TILE_TONE: Record<'success' | 'warning' | 'danger', string> = {
  success: 'border-emerald-200 bg-emerald-50',
  warning: 'border-amber-200 bg-amber-50',
  danger: 'border-rose-200 bg-rose-50',
};

interface ComplianceDoc {
  label: string;
  icon: ComponentType<{ className?: string }>;
  record: Record<string, any> | null;
  required: boolean;
  expiry: string;
  reference: string;
  documentUrl: string;
}

/** Where one document stands today, and how to say it. */
function docView(item: ComplianceDoc): { state: DocState; badge: string; line: string } {
  if (!item.record) return { state: 'missing', badge: 'Missing', line: 'Not on record — the fleet office adds it in Vehicle Management.' };
  if (!item.expiry) return { state: 'open', badge: 'On record', line: 'No expiry date recorded.' };
  const days = daysUntil(item.expiry);
  const date = formatDate(item.expiry);
  if (days === null) return { state: 'open', badge: 'On record', line: `Valid till ${date}.` };
  if (days < 0) return { state: 'expired', badge: 'Expired', line: `Expired on ${date} · ${-days} day${days === -1 ? '' : 's'} ago` };
  if (days === 0) return { state: 'due', badge: 'Due today', line: `Renew today (${date})` };
  if (days <= DUE_SOON_DAYS) return { state: 'due', badge: `Due in ${days} d`, line: `Renew by ${date}` };
  return { state: 'valid', badge: 'Valid', line: `Valid till ${date} · ${days} days left` };
}

/** The vehicle's own icon: a bike, a bus, a truck, else a car. */
function VehicleGlyph({ vehicle, className }: { vehicle: Record<string, any> | null; className?: string }) {
  const kind = `${vehicle?.vehicleType || ''} ${vehicle?.vehicleCategory || ''}`.toLowerCase();
  if (/two|bike|scooter|motor ?cycle/.test(kind)) return <Bike className={className} aria-hidden />;
  if (/bus/.test(kind)) return <Bus className={className} aria-hidden />;
  if (/truck|goods|tipper|lorry|tractor|pickup|carrier/.test(kind)) return <Truck className={className} aria-hidden />;
  return <Car className={className} aria-hidden />;
}

/** One figure about the vehicle; its `icon` is drawn at 14px. */
function Fact({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className={cn('min-w-0 rounded-xl border p-2.5', tone ? TILE_TONE[tone] : 'border-slate-200 bg-white')}>
      <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function Section({ title, icon: Icon, description, children }: { title: string; icon: ComponentType<{ className?: string }>; description?: string; children: ReactNode }) {
  return (
    <Card className="w-full min-w-0">
      <CardHeader className="space-y-0.5 p-4 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-slate-500" aria-hidden />
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent className="min-w-0 p-4 pt-0">{children}</CardContent>
    </Card>
  );
}

/** An empty list, in one quiet line. */
const Nothing = ({ children }: { children: ReactNode }) => <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-xs text-muted-foreground">{children}</p>;

/** "Open" for a stored file, a thumb-sized icon button. */
function OpenFile({ url, label }: { url: string; label: string }) {
  return (
    <Button asChild size="icon" variant="outline" className="h-9 w-9 shrink-0 bg-white">
      <a href={url} target="_blank" rel="noreferrer" aria-label={`Open the ${label} document`} title={`Open the ${label} document`}>
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
    </Button>
  );
}

export default function DriverVehicleDetailsPage() {
  const { can } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const [isLoading, setIsLoading] = useState(true);
  const [vehicle, setVehicle] = useState<Record<string, any> | null>(null);
  const [insuranceRows, setInsuranceRows] = useState<Record<string, any>[]>([]);
  const [pucRows, setPucRows] = useState<Record<string, any>[]>([]);
  const [fitnessRows, setFitnessRows] = useState<Record<string, any>[]>([]);
  const [roadTaxRows, setRoadTaxRows] = useState<Record<string, any>[]>([]);
  const [permitRows, setPermitRows] = useState<Record<string, any>[]>([]);
  const [maintenanceRows, setMaintenanceRows] = useState<Record<string, any>[]>([]);
  const [fuelRows, setFuelRows] = useState<Record<string, any>[]>([]);
  const [documentRows, setDocumentRows] = useState<Record<string, any>[]>([]);
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canView =
    can('View', 'Driver Management.Assigned Vehicle Details') ||
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Driver Management');
  const hasAccess = canView || isAssignedDriver;

  useEffect(() => {
    const load = async () => {
      const vehicleIdRaw = String(driver?.assignedVehicleId || '');
      const isOwnAssignedVehicle =
        vehicleIdRaw === OWN_VEHICLE_OPTION ||
        (!vehicleIdRaw && Boolean(driver?.assignedVehicleNumber));
      const vehicleId = isOwnAssignedVehicle ? '' : vehicleIdRaw;
      const vehicleNumber = String(driver?.assignedVehicleNumber || '');
      if (!vehicleId && !vehicleNumber) {
        setVehicle(null);
        setInsuranceRows([]);
        setPucRows([]);
        setFitnessRows([]);
        setRoadTaxRows([]);
        setPermitRows([]);
        setMaintenanceRows([]);
        setFuelRows([]);
        setDocumentRows([]);
        setIsLoading(false);
        return;
      }

      if (isOwnAssignedVehicle && vehicleNumber) {
        setVehicle({
          id: '',
          vehicleNumber,
          vehicleType: String(driver?.assignedVehicleType || driver?.ownVehicleType || 'Personal Vehicle'),
          fuelType: String(driver?.assignedFuelType || driver?.ownFuelType || '-'),
          vehicleStatus: 'Own Vehicle',
          documentHealthStatus: 'Self Managed',
        });
        setInsuranceRows([]);
        setPucRows([]);
        setFitnessRows([]);
        setRoadTaxRows([]);
        setPermitRows([]);
        setMaintenanceRows([]);
        setFuelRows([]);
        setDocumentRows([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const [
          vehicleSnap,
          insuranceSnap,
          pucSnap,
          fitnessSnap,
          roadTaxSnap,
          permitSnap,
          maintenanceSnap,
          fuelSnap,
          documentsSnap,
        ] = await Promise.all([
          getDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId)),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.insurance), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.puc), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.fitness), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.roadTax), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.permit), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.maintenance), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.fuel), where('vehicleId', '==', vehicleId))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.documents), where('vehicleId', '==', vehicleId))),
        ]);

        setVehicle(vehicleSnap.exists() ? { id: vehicleSnap.id, ...vehicleSnap.data() } : null);
        setInsuranceRows(insuranceSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPucRows(pucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setFitnessRows(fitnessSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRoadTaxRows(roadTaxSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setPermitRows(permitSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setMaintenanceRows(
          maintenanceSnap.docs
            .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.serviceDate || '').localeCompare(String(a.serviceDate || '')))
        );
        setFuelRows(
          fuelSnap.docs
            .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.fuelDate || '').localeCompare(String(a.fuelDate || '')))
        );
        setDocumentRows(
          documentsSnap.docs
            .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.expiryDate || b.issueDate || '').localeCompare(String(a.expiryDate || a.issueDate || '')))
        );
      } catch (error) {
        console.error('Failed to load assigned vehicle details', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [
    driver?.assignedFuelType,
    driver?.assignedVehicleId,
    driver?.assignedVehicleNumber,
    driver?.assignedVehicleType,
    driver?.ownFuelType,
    driver?.ownVehicleType,
  ]);

  const insurance = useMemo(() => pickLatestByDate(insuranceRows, 'expiryDate'), [insuranceRows]);
  const puc = useMemo(() => pickLatestByDate(pucRows, 'expiryDate'), [pucRows]);
  const fitness = useMemo(() => pickLatestByDate(fitnessRows, 'expiryDate'), [fitnessRows]);
  const roadTax = useMemo(() => pickLatestByDate(roadTaxRows, 'validTill'), [roadTaxRows]);
  const permit = useMemo(() => pickLatestByDate(permitRows, 'validTill'), [permitRows]);
  const latestDocsByType = useMemo(() => pickLatestDocByType(documentRows), [documentRows]);

  if (!hasAccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view assigned vehicle details.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isDriverLoading || (isLoading && (driver?.assignedVehicleId || driver?.assignedVehicleNumber))) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!driver) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Driver Profile Not Linked</CardTitle>
          <CardDescription>
            Ask admin to link your user in Driver Management (`Linked App User`).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!driver.assignedVehicleId && !driver.assignedVehicleNumber) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Vehicle Assigned</CardTitle>
          <CardDescription>Your driver profile currently has no assigned vehicle.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ownVehicle = !driver.assignedVehicleId || driver.assignedVehicleId === OWN_VEHICLE_OPTION;
  const required = vehicle ? getVehicleComplianceRequirements(vehicle) : { insurance: true, puc: true, fitness: true, roadTax: true, permit: true };

  const complianceItems: ComplianceDoc[] = [
    {
      label: 'Insurance',
      icon: ShieldCheck,
      record: insurance,
      required: required.insurance,
      expiry: String(insurance?.expiryDate || ''),
      reference: [insurance?.insuranceCompany, insurance?.policyNumber].filter(Boolean).join(' · '),
      documentUrl: String(insurance?.policyDocumentUrl || ''),
    },
    {
      label: 'PUC',
      icon: Wind,
      record: puc,
      required: required.puc,
      expiry: String(puc?.expiryDate || ''),
      reference: String(puc?.pucCertificateNumber || ''),
      documentUrl: String(puc?.certificateDocumentUrl || ''),
    },
    {
      label: 'Fitness',
      icon: BadgeCheck,
      record: fitness,
      required: required.fitness,
      expiry: String(fitness?.expiryDate || ''),
      reference: String(fitness?.fitnessCertificateNumber || ''),
      documentUrl: String(fitness?.certificateDocumentUrl || ''),
    },
    {
      label: 'Road Tax',
      icon: Receipt,
      record: roadTax,
      required: required.roadTax,
      expiry: String(roadTax?.validTill || ''),
      reference: [roadTax?.taxType, roadTax?.receiptNumber].filter(Boolean).join(' · '),
      documentUrl: String(roadTax?.receiptDocumentUrl || ''),
    },
    {
      label: 'Permit',
      icon: FileText,
      record: permit,
      required: required.permit,
      expiry: String(permit?.validTill || ''),
      reference: String(permit?.permitNumber || ''),
      documentUrl: String(permit?.permitDocumentUrl || ''),
    },
  ];
  // A paper the vehicle does not need is listed once, unless one is on record anyway.
  const shown = complianceItems.filter((item) => item.required || item.record).map((item) => ({ item, view: docView(item) }));
  const notRequired = complianceItems.filter((item) => !item.required && !item.record).map((item) => item.label);
  const needsAction = shown.filter(({ view }) => view.state === 'expired' || view.state === 'missing').length;
  const dueSoon = shown.filter(({ view }) => view.state === 'due').length;
  const papers: { value: string; tone?: 'success' | 'warning' | 'danger' } = ownVehicle
    ? { value: 'Self managed' }
    : needsAction
      ? { value: `${needsAction} need${needsAction === 1 ? 's' : ''} action`, tone: 'danger' }
      : dueSoon
        ? { value: `${dueSoon} due soon`, tone: 'warning' }
        : { value: shown.length ? `All ${shown.length} valid` : '—', tone: shown.length ? 'success' : undefined };

  const odometer = Number(vehicle?.currentOdometerKm || 0);
  const makeModel = [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ');
  const subtitle = [makeModel, vehicle?.yearOfManufacture, vehicle?.vehicleType].filter(Boolean).join(' · ');
  const vehicleStatus = String(vehicle?.vehicleStatus || '');

  return (
    <div className="space-y-4">
      {/* The vehicle: what it is, and how it stands at a glance. */}
      <Card className="w-full min-w-0 overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn(VM_ICON_CHIP, 'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl')}>
              <VehicleGlyph vehicle={vehicle} className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{ownVehicle ? 'Your own vehicle' : 'Assigned to you'}</p>
              <p className="break-words text-2xl font-bold tracking-wide text-slate-900">{vehicle?.vehicleNumber || vehicle?.registrationNo || driver.assignedVehicleNumber || '—'}</p>
              {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {vehicleStatus && (
              <div className="shrink-0">
                <StatusBadge status={vehicleStatus} />
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact icon={<Gauge aria-hidden />} label="Odometer" value={odometer > 0 ? `${odometer.toLocaleString('en-IN')} km` : 'Not recorded'} />
            <Fact icon={<Fuel aria-hidden />} label="Fuel" value={vehicle?.fuelType || '—'} />
            <Fact icon={<VehicleGlyph vehicle={vehicle} />} label="Type" value={vehicle?.vehicleType || '—'} />
            <Fact icon={<ShieldCheck aria-hidden />} label="Documents" value={papers.value} tone={papers.tone} />
          </div>
        </CardContent>
      </Card>

      <Section title="Documents" icon={ShieldCheck} description={ownVehicle ? undefined : 'Insurance, PUC, road tax and the rest — the latest on record.'}>
        {ownVehicle ? (
          <Nothing>Your own vehicle: its papers are yours to keep, and are not tracked in Vehicle Master.</Nothing>
        ) : (
          <>
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {shown.map(({ item, view }) => {
                const Icon = item.icon;
                return (
                  <li key={item.label} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1', STATE_CHIP[view.state])}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{item.label}</span>
                        <StatusBadge status={view.badge} tone={STATE_TONE[view.state]}>
                          {view.badge}
                        </StatusBadge>
                      </div>
                      {item.reference && (
                        <span className="block truncate text-xs text-slate-600" title={item.reference}>
                          {item.reference}
                        </span>
                      )}
                      <span className={cn('block text-xs', view.state === 'expired' || view.state === 'missing' ? 'text-rose-700' : view.state === 'due' ? 'text-amber-700' : 'text-muted-foreground')}>
                        {view.line}
                      </span>
                    </div>
                    {item.documentUrl && <OpenFile url={item.documentUrl} label={item.label} />}
                  </li>
                );
              })}
            </ul>
            {notRequired.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Not required for this vehicle: {notRequired.join(', ')}.
              </p>
            )}
          </>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Service history" icon={Wrench}>
          {maintenanceRows.length === 0 ? (
            <Nothing>No services recorded yet.</Nothing>
          ) : (
            <ul className="divide-y divide-slate-100">
              {maintenanceRows.slice(0, 5).map((row) => (
                <li key={row.id as string} className="flex min-w-0 items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{row.maintenanceType || 'Service'}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[formatDate(row.serviceDate), row.garageName].filter(Boolean).join(' · ') || '—'}</span>
                    {(row.nextServiceDate || row.nextServiceKm) && (
                      <span className="block text-xs text-muted-foreground">
                        Next: {[formatDate(row.nextServiceDate), row.nextServiceKm ? `${Number(row.nextServiceKm).toLocaleString('en-IN')} km` : ''].filter(Boolean).join(' or ')}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{formatCurrency(Number(row.totalCost || 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Fuel" icon={Fuel}>
          {fuelRows.length === 0 ? (
            <Nothing>No fuel fills recorded yet.</Nothing>
          ) : (
            <ul className="divide-y divide-slate-100">
              {fuelRows.slice(0, 5).map((row) => (
                <li key={row.id as string} className="flex min-w-0 items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">
                      {Number(row.quantityLiters || 0).toLocaleString('en-IN')} L{row.fuelStationName ? ` · ${row.fuelStationName}` : ''}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{formatDate(row.fuelDate) || '—'}</span>
                    {(row.mileageKmPerLiter || row.costPerKm) && (
                      <span className="block text-xs text-muted-foreground">
                        {[row.mileageKmPerLiter ? `${row.mileageKmPerLiter} km/L` : '', row.costPerKm ? `₹${row.costPerKm}/km` : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{formatCurrency(Number(row.totalAmount || 0))}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="Document folder" icon={FolderOpen} description="The latest of each kind — RC, licences and the rest.">
        {latestDocsByType.length === 0 ? (
          <Nothing>No documents in the folder yet.</Nothing>
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {latestDocsByType.map((row) => (
              <li key={`${row.documentType}-${row.id}`} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{row.documentType || 'Document'}</span>
                    {row.status && <StatusBadge status={String(row.status)} />}
                  </div>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[row.documentNumber, row.expiryDate ? `expires ${formatDate(row.expiryDate)}` : ''].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
                {row.fileUrl && <OpenFile url={String(row.fileUrl)} label={String(row.documentType || 'document')} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
