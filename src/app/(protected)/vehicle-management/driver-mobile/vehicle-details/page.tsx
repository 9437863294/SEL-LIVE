'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { computeRenewalMeta, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

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
      const vehicleId = String(driver?.assignedVehicleId || '');
      if (!vehicleId) {
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
  }, [driver?.assignedVehicleId]);

  const insurance = useMemo(() => pickLatestByDate(insuranceRows, 'expiryDate'), [insuranceRows]);
  const puc = useMemo(() => pickLatestByDate(pucRows, 'expiryDate'), [pucRows]);
  const fitness = useMemo(() => pickLatestByDate(fitnessRows, 'expiryDate'), [fitnessRows]);
  const roadTax = useMemo(() => pickLatestByDate(roadTaxRows, 'validTill'), [roadTaxRows]);
  const permit = useMemo(() => pickLatestByDate(permitRows, 'validTill'), [permitRows]);
  const latestDocsByType = useMemo(() => pickLatestDocByType(documentRows), [documentRows]);

  if (!hasAccess) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view assigned vehicle details.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isDriverLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!driver) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Driver Profile Not Linked</CardTitle>
          <CardDescription>
            Ask admin to link your user in Driver Management (`Linked App User`).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!driver.assignedVehicleId) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>No Vehicle Assigned</CardTitle>
          <CardDescription>Your driver profile currently has no assigned vehicle.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const complianceItems = [
    {
      label: 'Insurance',
      record: insurance,
      expiry: String(insurance?.expiryDate || ''),
      primary: String(insurance?.policyNumber || insurance?.insuranceCompany || '-'),
      documentUrl: String(insurance?.policyDocumentUrl || ''),
    },
    {
      label: 'PUC',
      record: puc,
      expiry: String(puc?.expiryDate || ''),
      primary: String(puc?.pucCertificateNumber || '-'),
      documentUrl: String(puc?.certificateDocumentUrl || ''),
    },
    {
      label: 'Fitness',
      record: fitness,
      expiry: String(fitness?.expiryDate || ''),
      primary: String(fitness?.fitnessCertificateNumber || '-'),
      documentUrl: String(fitness?.certificateDocumentUrl || ''),
    },
    {
      label: 'Road Tax',
      record: roadTax,
      expiry: String(roadTax?.validTill || ''),
      primary: String(roadTax?.receiptNumber || roadTax?.taxType || '-'),
      documentUrl: String(roadTax?.receiptDocumentUrl || ''),
    },
    {
      label: 'Permit',
      record: permit,
      expiry: String(permit?.validTill || ''),
      primary: String(permit?.permitNumber || '-'),
      documentUrl: String(permit?.permitDocumentUrl || ''),
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Assigned Vehicle Details</CardTitle>
          <CardDescription>All key details for your assigned vehicle.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Vehicle Number: <span className="font-medium">{vehicle?.vehicleNumber || vehicle?.registrationNo || '-'}</span>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Vehicle Type: <span className="font-medium">{vehicle?.vehicleType || '-'}</span>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Fuel Type: <span className="font-medium">{vehicle?.fuelType || '-'}</span>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Current Odometer: <span className="font-medium">{vehicle?.currentOdometerKm || 0} km</span>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Status: <span className="font-medium">{vehicle?.vehicleStatus || '-'}</span>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/85 px-3 py-2">
            Document Health: <span className="font-medium">{vehicle?.documentHealthStatus || '-'}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Insurance / PUC / Fitness / Tax / Permit</CardTitle>
          <CardDescription>Latest compliance details</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {complianceItems.map((item) => {
            const meta = computeRenewalMeta(item.expiry);
            const alert = item.record?.alertStage || meta.alertStage;
            const status = item.record?.complianceStatus || meta.complianceStatus;
            return (
              <div key={item.label} className="rounded-xl border border-white/70 bg-white/85 p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold">{item.label}</span>
                  <Badge
                    variant={String(status) === 'Expired' ? 'destructive' : 'outline'}
                    className={String(status) !== 'Expired' ? 'bg-amber-50 text-amber-700' : ''}
                  >
                    {alert}
                  </Badge>
                </div>
                {item.record ? (
                  <div className="space-y-1 text-sm">
                    <div className="text-muted-foreground">Ref: <span className="text-foreground">{item.primary}</span></div>
                    <div className="text-muted-foreground">Expiry: <span className="text-foreground">{item.expiry || '-'}</span></div>
                    <div className="text-muted-foreground">Status: <span className="text-foreground">{status}</span></div>
                    {item.documentUrl && (
                      <a href={item.documentUrl} target="_blank" rel="noreferrer">
                        <Button size="sm" variant="outline" className="mt-2 w-full bg-white">Open Document</Button>
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No record found.</p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Recent Maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {maintenanceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No maintenance records found.</p>
          ) : (
            maintenanceRows.slice(0, 5).map((row) => (
              <div key={row.id as string} className="rounded-xl border border-white/70 bg-white/85 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{row.maintenanceType || 'Maintenance'}</span>
                  <span className="text-muted-foreground">{row.serviceDate || '-'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Garage: {row.garageName || '-'}</div>
                  <div>Cost: {formatCurrency(Number(row.totalCost || 0))}</div>
                  <div>Next Date: {row.nextServiceDate || '-'}</div>
                  <div>Next KM: {row.nextServiceKm || '-'}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Recent Fuel Logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {fuelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fuel records found.</p>
          ) : (
            fuelRows.slice(0, 5).map((row) => (
              <div key={row.id as string} className="rounded-xl border border-white/70 bg-white/85 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{row.fuelDate || '-'}</span>
                  <span className="text-muted-foreground">{formatCurrency(Number(row.totalAmount || 0))}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Quantity: {row.quantityLiters || 0} L</div>
                  <div>Mileage: {row.mileageKmPerLiter || 'N/A'}</div>
                  <div>Station: {row.fuelStationName || '-'}</div>
                  <div>Cost/KM: {row.costPerKm || 'N/A'}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Document Folder</CardTitle>
          <CardDescription>Latest document by type</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {latestDocsByType.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents found.</p>
          ) : (
            latestDocsByType.map((row) => (
              <div key={`${row.documentType}-${row.id}`} className="rounded-xl border border-white/70 bg-white/85 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{row.documentType || 'Document'}</span>
                  <Badge variant="outline" className="bg-slate-50">
                    {row.status || 'N/A'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Number: {row.documentNumber || '-'}</div>
                  <div>Expiry: {row.expiryDate || '-'}</div>
                </div>
                {row.fileUrl && (
                  <a href={String(row.fileUrl)} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="mt-2 w-full bg-white">Open Document</Button>
                  </a>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
