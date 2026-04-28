'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuth } from '@/components/auth/AuthProvider';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

type FuelFormState = {
  vehicleId: string;
  fuelDate: string;
  quantityLiters: string;
  ratePerUnit: string;
  odometerReadingKm: string;
  previousOdometerReadingKm: string;
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
  previousOdometerReadingKm: '',
  fuelStationName: '',
  billNumber: '',
  remarks: '',
};

const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

export default function DriverMobileFuelPage() {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { options: allVehicleOptions, map: vehicleMap } = useVehicleOptions();
  const [form, setForm] = useState<FuelFormState>(initialForm);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [logs, setLogs] = useState<Record<string, any>[]>([]);
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

  const driverAssignedVehicleId = String(driver?.assignedVehicleId || '');
  const isOwnAssignedVehicle =
    driverAssignedVehicleId === OWN_VEHICLE_OPTION ||
    (!driverAssignedVehicleId && Boolean(driver?.assignedVehicleNumber));

  const vehicleOptions = useMemo(() => {
    if (driverAssignedVehicleId && driverAssignedVehicleId !== OWN_VEHICLE_OPTION) {
      const assigned = allVehicleOptions.find((option) => option.value === driverAssignedVehicleId);
      return assigned ? [assigned] : allVehicleOptions;
    }
    if (isOwnAssignedVehicle && driver?.assignedVehicleNumber) {
      return [
        {
          value: OWN_VEHICLE_OPTION,
          label: `${String(driver.assignedVehicleNumber)} (Own Vehicle)`,
        },
      ];
    }
    if (!driverAssignedVehicleId) return allVehicleOptions;
    const assigned = allVehicleOptions.find((option) => option.value === driverAssignedVehicleId);
    return assigned ? [assigned] : allVehicleOptions;
  }, [allVehicleOptions, driver?.assignedVehicleNumber, driverAssignedVehicleId, isOwnAssignedVehicle]);

  const selectedVehicle = useMemo(() => {
    if (form.vehicleId === OWN_VEHICLE_OPTION) {
      return {
        vehicleNumber: String(driver?.assignedVehicleNumber || ''),
        registrationNo: String(driver?.assignedVehicleNumber || ''),
        fuelType: String(driver?.assignedFuelType || driver?.ownFuelType || 'Other'),
        vehicleType: String(driver?.assignedVehicleType || driver?.ownVehicleType || 'Personal Vehicle'),
      };
    }
    return vehicleMap[String(form.vehicleId)];
  }, [driver?.assignedFuelType, driver?.assignedVehicleNumber, driver?.assignedVehicleType, driver?.ownFuelType, driver?.ownVehicleType, form.vehicleId, vehicleMap]);

  const loadLogs = async () => {
    if (!driver?.id) {
      setLogs([]);
      setIsLoadingLogs(false);
      return;
    }

    setIsLoadingLogs(true);
    try {
      const snap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.fuel), where('driverId', '==', String(driver.id)))
      );
      const rows: Record<string, any>[] = snap.docs
        .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.fuelDate || '').localeCompare(String(a.fuelDate || '')))
        .slice(0, 20);
      setLogs(rows);
    } catch (error) {
      console.error('Failed to load driver fuel logs', error);
      toast({
        title: 'Error',
        description: 'Unable to load your fuel history.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (!driver?.id) return;
    setForm((prev) => ({
      ...prev,
      vehicleId:
        prev.vehicleId ||
        String(driver.assignedVehicleId || (driver.assignedVehicleNumber ? OWN_VEHICLE_OPTION : '')),
    }));
  }, [driver?.assignedVehicleId, driver?.assignedVehicleNumber, driver?.id]);

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id]);

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
    if (!form.vehicleId || !form.fuelDate || !form.fuelStationName) {
      toast({
        title: 'Validation Error',
        description: 'Vehicle, date, and fuel station are required.',
        variant: 'destructive',
      });
      return;
    }

    const quantity = Number(form.quantityLiters || 0);
    const rate = Number(form.ratePerUnit || 0);
    const currentOdometer = Number(form.odometerReadingKm || 0);
    const previousOdometer = Number(form.previousOdometerReadingKm || 0);

    if (quantity <= 0 || rate <= 0 || currentOdometer <= 0) {
      toast({
        title: 'Validation Error',
        description: 'Quantity, rate, and odometer must be greater than zero.',
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

      const isOwnVehicle = form.vehicleId === OWN_VEHICLE_OPTION;
      const vehicleId = isOwnVehicle ? '' : String(form.vehicleId);
      const vehicle = selectedVehicle;
      await addDoc(collection(db, VEHICLE_COLLECTIONS.fuel), {
        vehicleId,
        vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
        fuelDate: form.fuelDate,
        fuelType: String(vehicle?.fuelType || 'Other'),
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
        vehicleOwnershipType: isOwnVehicle ? 'Own Vehicle' : 'Company Vehicle',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (vehicleId) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId), {
          currentOdometerKm: currentOdometer,
          updatedAt: serverTimestamp(),
        });
      }

      toast({
        title: 'Fuel Submitted',
        description: 'Your fuel entry has been saved successfully.',
      });

      setForm({
        ...initialForm,
        vehicleId: String(driver.assignedVehicleId || (driver.assignedVehicleNumber ? OWN_VEHICLE_OPTION : '')),
      });
      setBillFile(null);
      await loadLogs();
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
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Driver Fuel Entry</CardTitle>
          <CardDescription>Submit fuel from phone in a few taps.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Vehicle</Label>
            <Select value={form.vehicleId || undefined} onValueChange={(value) => setForm((prev) => ({ ...prev, vehicleId: value }))}>
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
              <SelectContent>
                {vehicleOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={form.fuelDate} onChange={(e) => setForm((prev) => ({ ...prev, fuelDate: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Fuel Type (from Vehicle Master)</Label>
            <Input
              value={String(selectedVehicle?.fuelType || 'Not set')}
              readOnly
              className="bg-slate-100/90"
            />
          </div>

          <div className="space-y-2">
            <Label>Fuel Station</Label>
            <Input value={form.fuelStationName} onChange={(e) => setForm((prev) => ({ ...prev, fuelStationName: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Quantity (L)</Label>
            <Input type="number" value={form.quantityLiters} onChange={(e) => setForm((prev) => ({ ...prev, quantityLiters: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Rate Per Unit</Label>
            <Input type="number" value={form.ratePerUnit} onChange={(e) => setForm((prev) => ({ ...prev, ratePerUnit: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Current Odometer</Label>
            <Input type="number" value={form.odometerReadingKm} onChange={(e) => setForm((prev) => ({ ...prev, odometerReadingKm: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Previous Odometer</Label>
            <Input type="number" value={form.previousOdometerReadingKm} onChange={(e) => setForm((prev) => ({ ...prev, previousOdometerReadingKm: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Bill Number</Label>
            <Input value={form.billNumber} onChange={(e) => setForm((prev) => ({ ...prev, billNumber: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="space-y-2">
            <Label>Bill Upload</Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setBillFile(e.target.files?.[0] || null)}
              className="bg-white/85 file:mr-3 file:rounded-md file:border-0 file:bg-cyan-600 file:px-3 file:py-1 file:text-white"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Remarks</Label>
            <Textarea value={form.remarks} onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))} className="bg-white/85" />
          </div>

          <div className="md:col-span-2">
            <Button
              onClick={onSubmit}
              disabled={!canAdd || isSubmitting}
              className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Fuel Entry'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Recent Fuel Entries</CardTitle>
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
