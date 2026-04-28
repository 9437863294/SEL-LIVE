'use client';

import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

type DailyStatusForm = {
  statusDate: string;
  vehicleId: string;
  shiftStartTime: string;
  shiftEndTime: string;
  openingOdometerKm: string;
  closingOdometerKm: string;
  openingFuelLiters: string;
  closingFuelLiters: string;
  totalTrips: string;
  runningStatus: string;
  routeSummary: string;
  issuesReported: string;
  remarks: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const initialForm: DailyStatusForm = {
  statusDate: today(),
  vehicleId: '',
  shiftStartTime: '',
  shiftEndTime: '',
  openingOdometerKm: '',
  closingOdometerKm: '',
  openingFuelLiters: '',
  closingFuelLiters: '',
  totalTrips: '',
  runningStatus: 'Running',
  routeSummary: '',
  issuesReported: '',
  remarks: '',
};

const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

export default function DriverDailyStatusPage() {
  const { can } = useAuthorization();
  const { toast } = useToast();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { options: allVehicleOptions, map: vehicleMap } = useVehicleOptions();
  const [form, setForm] = useState<DailyStatusForm>(initialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(true);
  const [logs, setLogs] = useState<Record<string, any>[]>([]);
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canView =
    can('View', 'Driver Management.Driver Daily Status') ||
    can('View', 'Vehicle Management.Driver Daily Status') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;
  const canAdd =
    can('Add', 'Driver Management.Driver Daily Status') ||
    can('Add', 'Vehicle Management.Driver Daily Status') ||
    can('Add', 'Vehicle Management.Driver Management') ||
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
      };
    }
    return vehicleMap[String(form.vehicleId)];
  }, [driver?.assignedVehicleNumber, form.vehicleId, vehicleMap]);

  const loadLogs = async () => {
    if (!driver?.id) {
      setLogs([]);
      setIsLoadingLogs(false);
      return;
    }
    setIsLoadingLogs(true);
    try {
      const snap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.driverDailyStatus), where('driverId', '==', String(driver.id)))
      );
      const rows: Record<string, any>[] = snap.docs
        .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.statusDate || '').localeCompare(String(a.statusDate || '')))
        .slice(0, 30);
      setLogs(rows);
    } catch (error) {
      console.error('Failed to load daily status logs', error);
      toast({
        title: 'Error',
        description: 'Unable to load daily status history.',
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
    if (!form.vehicleId || !form.statusDate || !form.runningStatus) {
      toast({
        title: 'Validation Error',
        description: 'Date, vehicle, and running status are required.',
        variant: 'destructive',
      });
      return;
    }

    const openingOdo = Number(form.openingOdometerKm || 0);
    const closingOdo = Number(form.closingOdometerKm || 0);
    const openingFuel = Number(form.openingFuelLiters || 0);
    const closingFuel = Number(form.closingFuelLiters || 0);
    const trips = Number(form.totalTrips || 0);

    if (openingOdo < 0 || closingOdo < 0) {
      toast({
        title: 'Validation Error',
        description: 'Odometer values must be positive.',
        variant: 'destructive',
      });
      return;
    }

    const totalDistanceKm = closingOdo > openingOdo ? closingOdo - openingOdo : 0;
    const fuelConsumed = openingFuel >= closingFuel ? openingFuel - closingFuel : 0;
    const mileageKmPerLiter = fuelConsumed > 0 ? Number((totalDistanceKm / fuelConsumed).toFixed(2)) : '';

    setIsSubmitting(true);
    try {
      const isOwnVehicle = form.vehicleId === OWN_VEHICLE_OPTION;
      const vehicleId = isOwnVehicle ? '' : String(form.vehicleId);
      const vehicle = selectedVehicle;
      await addDoc(collection(db, VEHICLE_COLLECTIONS.driverDailyStatus), {
        driverId: String(driver.id),
        driverName: String(driver.driverName || ''),
        vehicleId,
        vehicleNumber: vehicle?.vehicleNumber || vehicle?.registrationNo || '',
        statusDate: form.statusDate,
        shiftStartTime: form.shiftStartTime || '',
        shiftEndTime: form.shiftEndTime || '',
        openingOdometerKm: openingOdo || '',
        closingOdometerKm: closingOdo || '',
        totalDistanceKm,
        openingFuelLiters: openingFuel || '',
        closingFuelLiters: closingFuel || '',
        fuelConsumedLiters: fuelConsumed || '',
        mileageKmPerLiter,
        totalTrips: trips || '',
        runningStatus: form.runningStatus,
        routeSummary: form.routeSummary.trim(),
        issuesReported: form.issuesReported.trim(),
        remarks: form.remarks.trim(),
        sourceApp: 'Driver Mobile',
        vehicleOwnershipType: isOwnVehicle ? 'Own Vehicle' : 'Company Vehicle',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      if (vehicleId) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, vehicleId), {
          currentOdometerKm: closingOdo || openingOdo || '',
          vehicleStatus: form.runningStatus === 'Breakdown' ? 'Under Maintenance' : 'Active',
          updatedAt: serverTimestamp(),
        });
      }

      toast({
        title: 'Daily Status Submitted',
        description: 'Your daily running status has been saved.',
      });

      setForm({
        ...initialForm,
        vehicleId: String(driver.assignedVehicleId || (driver.assignedVehicleNumber ? OWN_VEHICLE_OPTION : '')),
      });
      await loadLogs();
    } catch (error) {
      console.error('Failed to submit daily status', error);
      toast({
        title: 'Error',
        description: 'Unable to submit daily status.',
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
          <CardDescription>You do not have permission to use daily running status.</CardDescription>
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
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Driver Daily Running Status</CardTitle>
          <CardDescription>Submit your daily movement, odometer, and status report.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={form.statusDate} onChange={(e) => setForm((prev) => ({ ...prev, statusDate: e.target.value }))} className="bg-white/85" />
          </div>
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
            <Label>Shift Start</Label>
            <Input type="time" value={form.shiftStartTime} onChange={(e) => setForm((prev) => ({ ...prev, shiftStartTime: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Shift End</Label>
            <Input type="time" value={form.shiftEndTime} onChange={(e) => setForm((prev) => ({ ...prev, shiftEndTime: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Opening Odometer (KM)</Label>
            <Input type="number" value={form.openingOdometerKm} onChange={(e) => setForm((prev) => ({ ...prev, openingOdometerKm: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Closing Odometer (KM)</Label>
            <Input type="number" value={form.closingOdometerKm} onChange={(e) => setForm((prev) => ({ ...prev, closingOdometerKm: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Opening Fuel (L)</Label>
            <Input type="number" value={form.openingFuelLiters} onChange={(e) => setForm((prev) => ({ ...prev, openingFuelLiters: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Closing Fuel (L)</Label>
            <Input type="number" value={form.closingFuelLiters} onChange={(e) => setForm((prev) => ({ ...prev, closingFuelLiters: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Total Trips</Label>
            <Input type="number" value={form.totalTrips} onChange={(e) => setForm((prev) => ({ ...prev, totalTrips: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Running Status</Label>
            <Select value={form.runningStatus} onValueChange={(value) => setForm((prev) => ({ ...prev, runningStatus: value }))}>
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {['Running', 'Idle', 'Breakdown', 'Off Duty', 'Leave'].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Route Summary</Label>
            <Textarea value={form.routeSummary} onChange={(e) => setForm((prev) => ({ ...prev, routeSummary: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Issues Reported</Label>
            <Textarea value={form.issuesReported} onChange={(e) => setForm((prev) => ({ ...prev, issuesReported: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Remarks</Label>
            <Textarea value={form.remarks} onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))} className="bg-white/85" />
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={onSubmit}
              disabled={!canAdd || isSubmitting}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Daily Status'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Recent Daily Status Logs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoadingLogs ? (
            Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-20 w-full rounded-xl" />)
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No daily status logs found.</p>
          ) : (
            logs.map((row) => (
              <div key={row.id as string} className="rounded-xl border border-white/70 bg-white/85 p-3 text-sm shadow-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{row.statusDate || '-'}</span>
                  <span className="text-muted-foreground">{row.runningStatus || '-'}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>Vehicle: {row.vehicleNumber || '-'}</div>
                  <div>Trips: {row.totalTrips || 0}</div>
                  <div>Distance: {row.totalDistanceKm || 0} km</div>
                  <div>Mileage: {row.mileageKmPerLiter || 'N/A'}</div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
