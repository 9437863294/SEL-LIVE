'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const thisMonthPrefix = () => new Date().toISOString().slice(0, 7);

export default function DriverMobileHubPage() {
  const { can } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const [isLoading, setIsLoading] = useState(true);
  const [fuelCount, setFuelCount] = useState(0);
  const [statusCount, setStatusCount] = useState(0);
  const [tripCount, setTripCount] = useState(0);
  const [activeTrip, setActiveTrip] = useState<Record<string, any> | null>(null);
  const [latestStatus, setLatestStatus] = useState<Record<string, any> | null>(null);
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canViewFuel =
    can('View', 'Driver Management.Driver Fuel') ||
    can('View', 'Vehicle Management.Driver Mobile Fuel') ||
    can('View', 'Vehicle Management.Fuel Management');
  const canViewDaily =
    can('View', 'Driver Management.Driver Daily Status') ||
    can('View', 'Vehicle Management.Driver Daily Status') ||
    can('View', 'Vehicle Management.Driver Management');
  const canViewTrips =
    can('View', 'Driver Management.Driver Trips') ||
    can('View', 'Vehicle Management.Driver Mobile Trip') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Driver Management');
  const canViewHub =
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    canViewFuel ||
    canViewDaily ||
    canViewTrips ||
    isAssignedDriver;

  useEffect(() => {
    const load = async () => {
      if (!driver?.id) {
        setFuelCount(0);
        setStatusCount(0);
        setTripCount(0);
        setActiveTrip(null);
        setLatestStatus(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const [fuelSnap, statusSnap, tripSnap] = await Promise.all([
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.fuel), where('driverId', '==', driver.id))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.driverDailyStatus), where('driverId', '==', driver.id))),
          getDocs(query(collection(db, VEHICLE_COLLECTIONS.trips), where('driverId', '==', driver.id))),
        ]);

        const month = thisMonthPrefix();
        const allFuel: Record<string, any>[] = fuelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const allStatuses: Record<string, any>[] = statusSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const allTrips: Record<string, any>[] = tripSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const statusesSorted = [...allStatuses].sort((a, b) =>
          String(b.statusDate || '').localeCompare(String(a.statusDate || ''))
        );
        const tripsSorted = [...allTrips].sort((a, b) =>
          String(b.startTimeIso || '').localeCompare(String(a.startTimeIso || ''))
        );

        setFuelCount(allFuel.filter((row) => String(row.fuelDate || '').startsWith(month)).length);
        setStatusCount(allStatuses.filter((row) => String(row.statusDate || '').startsWith(month)).length);
        setTripCount(allTrips.filter((row) => String(row.startDate || '').startsWith(month)).length);
        setActiveTrip(tripsSorted.find((row) => String(row.tripStatus || '') === 'In Progress') || null);
        setLatestStatus(statusesSorted[0] || null);
      } catch (error) {
        console.error('Failed to load driver mobile dashboard', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [driver?.id]);

  const driverName = useMemo(
    () => String(driver?.driverName || driver?.name || 'Driver'),
    [driver?.driverName, driver?.name]
  );

  if (!canViewHub) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to use driver mobile features.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isDriverLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!driver) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Driver Profile Not Linked</CardTitle>
          <CardDescription>
            Your login is not linked to a driver record yet. Ask admin to set `Linked App User ID` in Driver Management.
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
          <CardTitle className="tracking-tight">Driver Mobile</CardTitle>
          <CardDescription>Quick mobile workflow for fuel updates and daily running status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge className="bg-cyan-600 text-white">{driverName}</Badge>
          <Badge variant="outline">Mobile: {driver.mobileNumber || '-'}</Badge>
          <Badge variant="outline">Assigned Vehicle: {driver.assignedVehicleNumber || 'Not assigned'}</Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="vm-panel sm:col-span-2">
          <CardHeader>
            <CardDescription>Assigned Vehicle</CardDescription>
            <CardTitle className="text-2xl">{driver.assignedVehicleNumber || 'Not assigned'}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/driver-management/vehicle-details">
              <Button className="w-full bg-gradient-to-r from-indigo-500 to-blue-600 text-white">
                View Full Vehicle Details
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="vm-panel sm:col-span-2">
          <CardHeader>
            <CardDescription>Driver Trip Tracking</CardDescription>
            <CardTitle className="text-2xl">
              {activeTrip ? 'Trip In Progress' : 'No Active Trip'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 text-sm text-muted-foreground">
              Trips this month: {isLoading ? '...' : tripCount}
            </div>
            <Link href="/driver-management/trips">
              <Button className="w-full bg-gradient-to-r from-emerald-500 to-cyan-600 text-white">
                Open Trip Tracking
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="vm-panel">
          <CardHeader>
            <CardDescription>Fuel Entries (This Month)</CardDescription>
            <CardTitle className="text-2xl">{isLoading ? '...' : fuelCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/driver-management/fuel">
              <Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white">Open Fuel Entry</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="vm-panel">
          <CardHeader>
            <CardDescription>Daily Status Logs (This Month)</CardDescription>
            <CardTitle className="text-2xl">{isLoading ? '...' : statusCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/driver-management/daily-status">
              <Button className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
                Open Daily Status
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Latest Daily Status</CardTitle>
        </CardHeader>
        <CardContent>
          {latestStatus ? (
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-white/60 bg-white/80 px-3 py-2">
                Date: <span className="font-medium">{latestStatus.statusDate || '-'}</span>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/80 px-3 py-2">
                Running Status: <span className="font-medium">{latestStatus.runningStatus || '-'}</span>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/80 px-3 py-2">
                Distance: <span className="font-medium">{latestStatus.totalDistanceKm || 0} km</span>
              </div>
              <div className="rounded-lg border border-white/60 bg-white/80 px-3 py-2">
                Vehicle: <span className="font-medium">{latestStatus.vehicleNumber || '-'}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No daily status logs submitted yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
