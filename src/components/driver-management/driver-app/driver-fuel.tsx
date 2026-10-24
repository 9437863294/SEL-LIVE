'use client';

/**
 * Fuel Entries — a driver logs a fill-up of an office vehicle.
 *
 * Fuel is recorded against company vehicles only, and every vehicle detail comes from Vehicle
 * Master: the number, type, fuel type, make and model, and the last odometer reading (which fills
 * in the previous reading). A personal vehicle has no fuel log — its running is claimed per km in
 * My Trips. A driver assigned an office vehicle fuels that one; anyone else picks from the active
 * fleet (sold or scrapped vehicles are not offered). The database rules refuse a driver-app fuel
 * log that does not name a Vehicle Master vehicle.
 */

import { useEffect, useMemo, useState } from 'react';
import { CarFront } from 'lucide-react';
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db } from '@/lib/firebase';
import { storage } from '@/lib/firebase-storage';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuth } from '@/components/auth/AuthProvider';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useFieldControl, validateFieldControlRequirements } from '@/components/vehicle-management/use-field-control';
import { ControlledField } from '@/components/vehicle-management/controlled-field';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchSelect } from '@/components/driver-management/trips/trip-ui';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { cn } from '@/lib/utils';

type FuelFormState = {
  /** Empty until chosen; a driver assigned an office vehicle has it chosen for them. */
  vehicleId: string;
  fuelDate: string;
  quantityLiters: string;
  ratePerUnit: string;
  odometerReadingKm: string;
  /** null until typed: the vehicle's last reading in Vehicle Master stands in for it. */
  previousOdometerReadingKm: string | null;
  fuelStationName: string;
  billNumber: string;
  remarks: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const initialForm: FuelFormState = {
  vehicleId: '',
  fuelDate: today(),
  quantityLiters: '',
  ratePerUnit: '',
  odometerReadingKm: '',
  previousOdometerReadingKm: null,
  fuelStationName: '',
  billNumber: '',
  remarks: '',
};

/** Driver Master's marker for a driver who drives their own vehicle (it has no Vehicle Master record). */
const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

/** Vehicles that have left the fleet take no fuel. */
const RETIRED = /sold|scrap|dispos|inactive|retired|written/i;

const vehicleNumberOf = (row: Record<string, any> | undefined) => String(row?.vehicleNumber || row?.registrationNo || '').trim();

export default function DriverMobileFuelPage() {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { field } = useFieldControl('driverMobileFuel');
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { rows: vehicleRows, map: vehicleMap, isLoading: isVehiclesLoading } = useVehicleOptions();
  const [form, setForm] = useState<FuelFormState>(initialForm);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canView =
    can('View', 'Driver Management.Driver Fuel') ||
    can('View', 'Vehicle Management.Driver Mobile Fuel') ||
    can('View', 'Vehicle Management.Fuel Management') ||
    isAssignedDriver;
  const canAdd =
    can('Add', 'Driver Management.Driver Fuel') ||
    can('Add', 'Vehicle Management.Driver Mobile Fuel') ||
    can('Add', 'Vehicle Management.Fuel Management') ||
    isAssignedDriver;

  // Fuel goes on office vehicles only: Vehicle Master records still in the fleet.
  const assignedVehicleId = String(driver?.assignedVehicleId || '');
  const assignedCompanyVehicleId = assignedVehicleId && assignedVehicleId !== OWN_VEHICLE_OPTION ? assignedVehicleId : '';
  const drivesOwnVehicle = !assignedCompanyVehicleId && (assignedVehicleId === OWN_VEHICLE_OPTION || Boolean(driver?.assignedVehicleNumber));

  const companyVehicles = useMemo(
    () => vehicleRows.filter((row) => vehicleNumberOf(row) && !RETIRED.test(String(row.vehicleStatus || row.currentStatus || ''))),
    [vehicleRows],
  );
  // A driver assigned an office vehicle fuels that one; anyone else picks from the fleet.
  const assignedVehicle = assignedCompanyVehicleId ? companyVehicles.find((row) => row.id === assignedCompanyVehicleId) : undefined;
  const vehicleOptions = useMemo(
    () =>
      (assignedVehicle ? [assignedVehicle] : companyVehicles).map((row) => ({
        value: String(row.id),
        label: `${vehicleNumberOf(row)}${row.vehicleType ? ` · ${row.vehicleType}` : ''}`,
        hint: [row.fuelType, row.assignedDriverName && `Driver: ${row.assignedDriverName}`].filter(Boolean).join(' · ') || undefined,
      })),
    [assignedVehicle, companyVehicles],
  );

  const vehicleId = form.vehicleId || (assignedVehicle ? String(assignedVehicle.id) : '');
  const selectedVehicle = vehicleId ? (vehicleMap[vehicleId] as Record<string, any> | undefined) : undefined;
  const lastReading = Number(selectedVehicle?.currentOdometerKm) > 0 ? Number(selectedVehicle?.currentOdometerKm) : null;
  // The previous reading is the vehicle's last one in Vehicle Master until the driver types another.
  const previousOdometerText = form.previousOdometerReadingKm ?? (lastReading !== null ? String(lastReading) : '');

  // Recent entries; `logsTick` reloads them after a save. The rows of a load stay on screen while
  // the next one runs.
  const driverId = String(driver?.id || '');
  const [logsTick, setLogsTick] = useState(0);
  const [logsState, setLogsState] = useState<{ driverId: string; rows: Record<string, any>[] } | null>(null);
  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    getDocs(query(collection(db, VEHICLE_COLLECTIONS.fuel), where('driverId', '==', driverId)))
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs
          .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => String(b.fuelDate || '').localeCompare(String(a.fuelDate || '')))
          .slice(0, 20);
        setLogsState({ driverId, rows });
      })
      .catch((error) => {
        console.error('Failed to load driver fuel logs', error);
        if (cancelled) return;
        setLogsState({ driverId, rows: [] });
        toast({ title: 'Error', description: 'Unable to load your fuel history.', variant: 'destructive' });
      });
    return () => {
      cancelled = true;
    };
  }, [driverId, logsTick, toast]);
  const logs = logsState?.driverId === driverId ? logsState.rows : [];
  const isLoadingLogs = Boolean(driverId) && logsState?.driverId !== driverId;

  const onSubmit = async () => {
    if (!canAdd || isSubmitting) return;
    if (!driver?.id) {
      toast({
        title: 'Driver Profile Missing',
        description: 'Your user is not linked to a driver record.',
        variant: 'destructive',
      });
      return;
    }
    const vehicle = selectedVehicle;
    if (!vehicleId || !vehicle || !companyVehicles.some((row) => row.id === vehicleId)) {
      toast({
        title: 'Choose a company vehicle',
        description: 'Fuel is recorded for office vehicles in Vehicle Master only.',
        variant: 'destructive',
      });
      return;
    }
    const missingLabel = validateFieldControlRequirements('driverMobileFuel', { ...form, vehicleId, previousOdometerReadingKm: previousOdometerText, billFile }, field);
    if (missingLabel) {
      toast({
        title: 'Validation Error',
        description: `${missingLabel} is required.`,
        variant: 'destructive',
      });
      return;
    }

    const quantity = Number(form.quantityLiters || 0);
    const rate = Number(form.ratePerUnit || 0);
    const currentOdometer = Number(form.odometerReadingKm || 0);
    const previousOdometer = Number(previousOdometerText || 0);

    if (quantity <= 0 || rate <= 0 || currentOdometer <= 0) {
      toast({
        title: 'Validation Error',
        description: 'Quantity, rate, and odometer must be greater than zero.',
        variant: 'destructive',
      });
      return;
    }
    if (previousOdometer > 0 && currentOdometer <= previousOdometer) {
      toast({
        title: 'Check the odometer',
        description: `The reading must be above the previous one (${previousOdometer.toLocaleString('en-IN')} km).`,
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const totalAmount = quantity * rate;
      const distance = currentOdometer > previousOdometer ? currentOdometer - previousOdometer : 0;
      const mileage = quantity > 0 && distance > 0 ? Number((distance / quantity).toFixed(2)) : '';
      const costPerKm = distance > 0 ? Number((totalAmount / distance).toFixed(2)) : '';

      let billUploadUrl = '';
      if (billFile) {
        const safeName = billFile.name.replace(/\s+/g, '-');
        const storageRef = ref(
          storage,
          `vehicle-management/driver-app/fuel/${driver.id}/${Date.now()}-${safeName}`
        );
        await uploadBytes(storageRef, billFile);
        billUploadUrl = await getDownloadURL(storageRef);
      }

      // Every vehicle detail comes from its Vehicle Master record.
      await addDoc(collection(db, VEHICLE_COLLECTIONS.fuel), {
        vehicleId,
        vehicleNumber: vehicleNumberOf(vehicle),
        vehicleType: String(vehicle.vehicleType || ''),
        fuelDate: form.fuelDate,
        fuelType: String(vehicle.fuelType || 'Other'),
        quantityLiters: quantity,
        ratePerUnit: rate,
        totalAmount,
        odometerReadingKm: currentOdometer,
        previousOdometerReadingKm: previousOdometer || '',
        distanceSinceLastFuelKm: distance,
        mileageKmPerLiter: mileage,
        costPerKm,
        fuelStationName: form.fuelStationName,
        billNumber: form.billNumber.trim(),
        billUploadUrl,
        remarks: form.remarks.trim(),
        driverId: String(driver.id),
        driverName: String(driver.driverName || ''),
        enteredByUserId: user?.id || '',
        enteredByName: user?.name || '',
        fuelStatus: 'Submitted',
        sourceApp: 'Driver Mobile',
        vehicleOwnershipType: 'Company Vehicle',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // The vehicle's reading follows the fill-up. Best effort: the fuel log above is the record, and
      // the rules let only the vehicle's own driver (or a driver-app grant) move its odometer.
      try {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId), {
          currentOdometerKm: currentOdometer,
          // Which driver record wrote this: the rules check it is the caller's, assigned this vehicle.
          updatedByDriverId: String(driver.id),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        console.warn('Fuel saved; the vehicle odometer was not updated', error);
      }

      toast({
        title: 'Fuel Submitted',
        description: 'Your fuel entry has been saved successfully.',
      });

      // Same vehicle next time; this reading becomes its previous one (Vehicle Master now holds it,
      // the list loaded on arrival does not).
      setForm({ ...initialForm, vehicleId, previousOdometerReadingKm: String(currentOdometer) });
      setBillFile(null);
      setLogsTick((tick) => tick + 1);
    } catch (error) {
      console.error('Failed to submit driver fuel', error);
      toast({
        title: 'Error',
        description: 'Unable to submit fuel entry.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to use driver fuel entry.</CardDescription>
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
            Ask admin to link your user in Driver Management (`Linked App User ID`).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fuel Entries"
        description="Log a fill-up of an office vehicle. The vehicle's details come from Vehicle Management."
      />
      {drivesOwnVehicle && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Your driver record is set to your own vehicle. Fuel is recorded for company vehicles only — claim your own vehicle&apos;s running per km in My Trips. You can still log fuel for an office vehicle you drove.
        </p>
      )}
      <Card className="vm-panel-strong overflow-hidden">
        <CardContent className="grid grid-cols-1 gap-3 pt-[var(--card-pad,1.5rem)] md:grid-cols-2">
          <ControlledField setting={field('vehicleId')}>
            <SearchSelect
              options={vehicleOptions}
              value={vehicleId || null}
              onChange={(value) => setForm((prev) => ({ ...prev, vehicleId: value ?? '', previousOdometerReadingKm: null }))}
              placeholder={isVehiclesLoading ? 'Loading vehicles…' : 'Choose a company vehicle'}
              emptyText="No company vehicle matches."
              disabled={Boolean(assignedVehicle) || isVehiclesLoading}
            />
            {assignedVehicle && <p className="text-[11px] text-muted-foreground">Your assigned vehicle.</p>}
          </ControlledField>

          <ControlledField setting={field('fuelDate')}>
            <Input type="date" value={form.fuelDate} onChange={(e) => setForm((prev) => ({ ...prev, fuelDate: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 md:col-span-2">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <CarFront className="h-3.5 w-3.5" aria-hidden />
              From Vehicle Management
            </p>
            {selectedVehicle ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
                {[
                  ['Vehicle', vehicleNumberOf(selectedVehicle)],
                  ['Type', selectedVehicle.vehicleType || '—'],
                  ['Fuel', selectedVehicle.fuelType || 'Not set'],
                  ['Make / model', [selectedVehicle.brand, selectedVehicle.model].filter(Boolean).join(' ') || '—'],
                  ['Last odometer', lastReading !== null ? `${lastReading.toLocaleString('en-IN')} km` : 'Not recorded'],
                  ['Driver', selectedVehicle.assignedDriverName || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="truncate font-medium text-slate-800">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Choose the vehicle to see its details.</p>
            )}
          </div>

          <ControlledField setting={field('fuelStationName')}>
            <Input value={form.fuelStationName} onChange={(e) => setForm((prev) => ({ ...prev, fuelStationName: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <ControlledField setting={field('quantityLiters')}>
            <Input type="number" value={form.quantityLiters} onChange={(e) => setForm((prev) => ({ ...prev, quantityLiters: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <ControlledField setting={field('ratePerUnit')}>
            <Input type="number" value={form.ratePerUnit} onChange={(e) => setForm((prev) => ({ ...prev, ratePerUnit: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <ControlledField setting={field('odometerReadingKm')}>
            <Input type="number" value={form.odometerReadingKm} onChange={(e) => setForm((prev) => ({ ...prev, odometerReadingKm: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <ControlledField setting={field('previousOdometerReadingKm')}>
            <Input type="number" value={previousOdometerText} onChange={(e) => setForm((prev) => ({ ...prev, previousOdometerReadingKm: e.target.value }))} className="bg-white/85" />
            {form.previousOdometerReadingKm === null && lastReading !== null && <p className="text-[11px] text-muted-foreground">The vehicle&apos;s last reading in Vehicle Management.</p>}
          </ControlledField>

          <ControlledField setting={field('billNumber')}>
            <Input value={form.billNumber} onChange={(e) => setForm((prev) => ({ ...prev, billNumber: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <ControlledField setting={field('billFile')}>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setBillFile(e.target.files?.[0] || null)}
              className="bg-white/85 file:mr-3 file:rounded-md file:border-0 file:bg-[image:var(--sel-tab-gradient)] file:px-3 file:py-1 file:text-[color:var(--sel-tab-on)]"
            />
          </ControlledField>

          <ControlledField setting={field('remarks')} className="space-y-2 md:col-span-2">
            <Textarea value={form.remarks} onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))} className="bg-white/85" />
          </ControlledField>

          <div className="md:col-span-2">
            <Button
              onClick={onSubmit}
              disabled={!canAdd || isSubmitting}
              className={cn('w-full', VM_PRIMARY_BUTTON)}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Fuel Entry'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle>Recent Fuel Entries</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingLogs ? (
            Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-20 w-full rounded-xl" />)
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fuel logs found.</p>
          ) : (
            logs.map((row) => (
              <div key={row.id as string} className="rounded-xl border border-white/70 bg-white/85 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{row.vehicleNumber || '-'}</span>
                  <span className="text-muted-foreground">{row.fuelDate || '-'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Qty: {row.quantityLiters || 0} L</div>
                  <div>Amount: {row.totalAmount || 0}</div>
                  <div>Mileage: {row.mileageKmPerLiter || 'N/A'}</div>
                  <div>Station: {row.fuelStationName || '-'}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
