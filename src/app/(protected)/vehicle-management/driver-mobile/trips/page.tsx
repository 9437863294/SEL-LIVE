'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile, useVehicleOptions } from '@/components/vehicle-management/hooks';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import {
  DEFAULT_TRACKING_SETTINGS,
  haversineDistanceKm,
  toKmph,
  TripLocationPoint,
  VEHICLE_COLLECTIONS,
  VEHICLE_SETTINGS_DOC_ID,
} from '@/lib/vehicle-management';
import {
  clearDriverPositionWatch,
  ensureAndroidAlwaysLocationSetup,
  ensureDriverGeolocation,
  getCurrentDriverPosition,
  type DriverGeoPosition,
  type DriverGeoWatchId,
  watchDriverPosition,
} from '@/lib/driver-mobile-geolocation';
import TripMapView from '@/components/vehicle-management/trip-map-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const toIsoNow = () => new Date().toISOString();

const formatDateTime = (iso?: string) => {
  if (!iso) return '-';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString();
};

type TripAddress = {
  formattedAddress: string;
  area: string;
  road: string;
  roadNumber: string;
  locality: string;
  city: string;
  district: string;
  state: string;
  postalCode: string;
  country: string;
};

const emptyAddress: TripAddress = {
  formattedAddress: '',
  area: '',
  road: '',
  roadNumber: '',
  locality: '',
  city: '',
  district: '',
  state: '',
  postalCode: '',
  country: '',
};

const OWN_VEHICLE_OPTION = '__OWN_VEHICLE__';

export default function DriverMobileTripsPage() {
  const { can } = useAuthorization();
  const { user } = useAuth();
  const { toast } = useToast();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { map: vehicleMap } = useVehicleOptions();
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canView =
    can('View', 'Driver Management.Driver Trips') ||
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Vehicle Management.Driver Mobile Trip') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;
  const canStartStop =
    can('Add', 'Driver Management.Driver Trips') ||
    can('Add', 'Vehicle Management.Driver Mobile Trip') ||
    can('Add', 'Vehicle Management.Driver Mobile') ||
    can('Add', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;

  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [settingsIntervalSec, setSettingsIntervalSec] = useState(
    DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec
  );
  const [activeTrip, setActiveTrip] = useState<Record<string, any> | null>(null);
  const [latestPosition, setLatestPosition] = useState<DriverGeoPosition | null>(null);
  const [activeTripPoints, setActiveTripPoints] = useState<TripLocationPoint[]>([]);

  const watchIdRef = useRef<DriverGeoWatchId | null>(null);
  const lastSentMsRef = useRef(0);
  const lastSentPointRef = useRef<{ lat: number; lng: number } | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const assignedVehicleIdRaw = String(driver?.assignedVehicleId || '');
  const isOwnAssignedVehicle =
    assignedVehicleIdRaw === OWN_VEHICLE_OPTION ||
    (!assignedVehicleIdRaw && Boolean(driver?.assignedVehicleNumber));
  const assignedVehicleId = isOwnAssignedVehicle ? '' : assignedVehicleIdRaw;
  const assignedVehicle = vehicleMap[assignedVehicleId];
  const assignedVehicleNumber = String(
    assignedVehicle?.vehicleNumber || assignedVehicle?.registrationNo || driver?.assignedVehicleNumber || ''
  );
  const assignedFuelType = String(
    assignedVehicle?.fuelType || driver?.assignedFuelType || driver?.ownFuelType || ''
  );
  const assignedVehicleType = String(
    assignedVehicle?.vehicleType || driver?.assignedVehicleType || driver?.ownVehicleType || ''
  );

  const resolveAddress = async (lat: number, lng: number): Promise<TripAddress> => {
    try {
      const response = await fetch('/api/maps/reverse-geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng }),
      });
      if (!response.ok) return emptyAddress;
      const data = (await response.json()) as Partial<TripAddress>;
      return {
        formattedAddress: String(data.formattedAddress || ''),
        area: String(data.area || ''),
        road: String(data.road || ''),
        roadNumber: String(data.roadNumber || ''),
        locality: String(data.locality || ''),
        city: String(data.city || ''),
        district: String(data.district || ''),
        state: String(data.state || ''),
        postalCode: String(data.postalCode || ''),
        country: String(data.country || ''),
      };
    } catch (error) {
      return emptyAddress;
    }
  };

  const loadSettings = async () => {
    try {
      const snap = await getDoc(doc(db, VEHICLE_COLLECTIONS.settings, VEHICLE_SETTINGS_DOC_ID));
      if (!snap.exists()) {
        const fallback = DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec;
        setSettingsIntervalSec(fallback);
        return fallback;
      }
      const data = snap.data() as Record<string, any>;
      const interval = Number(data.driverLocationUpdateIntervalSec || 0);
      const resolved = interval > 0 ? interval : DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec;
      setSettingsIntervalSec(resolved);
      return resolved;
    } catch (error) {
      console.error('Failed to load tracking settings', error);
      const fallback = DEFAULT_TRACKING_SETTINGS.driverLocationUpdateIntervalSec;
      setSettingsIntervalSec(fallback);
      return fallback;
    }
  };

  const loadTrips = async () => {
    if (!driver?.id) {
      setActiveTrip(null);
      setActiveTripPoints([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.trips), where('driverId', '==', String(driver.id)))
      );
      const rows: Record<string, any>[] = snap.docs
        .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          String(b.startTimeIso || b.createdAt?.toDate?.()?.toISOString?.() || '').localeCompare(
            String(a.startTimeIso || a.createdAt?.toDate?.()?.toISOString?.() || '')
          )
      );
      const active = rows.find((row) => String(row.tripStatus || '') === 'In Progress') || null;
      setActiveTrip(active);
    } catch (error) {
      console.error('Failed to load driver trips', error);
      toast({
        title: 'Error',
        description: 'Unable to load trip history.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadActiveTripPoints = async (tripId: string) => {
    try {
      const snap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.tripLocations), where('tripId', '==', tripId))
      );
      const points = snap.docs
        .map((d) => d.data() as Record<string, any>)
        .sort((a, b) => String(a.recordedAtIso || '').localeCompare(String(b.recordedAtIso || '')))
        .map<TripLocationPoint>((row) => ({
          lat: Number(row.lat),
          lng: Number(row.lng),
          accuracyMeters: Number(row.accuracyMeters || 0),
          speedKmph: Number(row.speedKmph || 0),
          headingDeg: Number(row.headingDeg || 0),
          recordedAtIso: String(row.recordedAtIso || ''),
        }))
        .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
      setActiveTripPoints(points);
      if (points.length > 0) {
        const last = points[points.length - 1];
        lastSentPointRef.current = { lat: last.lat, lng: last.lng };
      }
    } catch (error) {
      console.error('Failed to load active trip points', error);
    }
  };

  const clearWatcher = async () => {
    await clearDriverPositionWatch(watchIdRef.current);
    watchIdRef.current = null;
  };

  const pushPosition = async (
    tripId: string,
    position: DriverGeoPosition,
    intervalSec: number
  ) => {
    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracyMeters = Number(position.coords.accuracy || 0);
    const speedKmph = toKmph(position.coords.speed ?? 0);
    const headingDeg = Number(position.coords.heading || 0);
    const nowIso = toIsoNow();

    const previous = lastSentPointRef.current;
    const deltaDistanceKm =
      previous && Number.isFinite(previous.lat) && Number.isFinite(previous.lng)
        ? haversineDistanceKm(previous, { lat, lng })
        : 0;

    await addDoc(collection(db, VEHICLE_COLLECTIONS.tripLocations), {
      tripId,
      driverId: String(driver?.id || ''),
      vehicleId: assignedVehicleId,
      lat,
      lng,
      accuracyMeters,
      speedKmph,
      headingDeg,
      recordedAtIso: nowIso,
      createdAt: serverTimestamp(),
    });

    await updateDoc(doc(db, VEHICLE_COLLECTIONS.trips, tripId), {
      lastLocationLat: lat,
      lastLocationLng: lng,
      lastLocationAtIso: nowIso,
      lastAccuracyMeters: accuracyMeters,
      lastSpeedKmph: speedKmph,
      trackingIntervalSec: intervalSec,
      totalPoints: increment(1),
      totalDistanceKm: increment(deltaDistanceKm),
      updatedAt: serverTimestamp(),
    });

      if (assignedVehicleId && !isOwnAssignedVehicle) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, assignedVehicleId), {
          currentLatitude: lat,
          currentLongitude: lng,
        currentLocationAtIso: nowIso,
        currentStatus: 'On Trip',
        updatedAt: serverTimestamp(),
      });
    }

    lastSentPointRef.current = { lat, lng };
    setActiveTripPoints((prev) => [
      ...prev,
      { lat, lng, accuracyMeters, speedKmph, headingDeg, recordedAtIso: nowIso },
    ]);
  };

  const startTrip = async () => {
    if (!canStartStop || isStarting) return;
    if (!driver?.id) {
      toast({
        title: 'Driver Profile Missing',
        description: 'Your login is not linked to a driver record.',
        variant: 'destructive',
      });
      return;
    }
    if (!assignedVehicleNumber) {
      toast({
        title: 'No Vehicle Assigned',
        description: 'Assign a company vehicle or own vehicle in Driver Management before starting a trip.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await ensureDriverGeolocation();
      await ensureAndroidAlwaysLocationSetup();
    } catch (error: any) {
      toast({
        title: 'Location Not Available',
        description: error?.message || 'Unable to access location.',
        variant: 'destructive',
      });
      return;
    }

    setIsStarting(true);
    try {
      const intervalSec = await loadSettings();

      const startPosition = await getCurrentDriverPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });

      const startLat = Number(startPosition.coords.latitude);
      const startLng = Number(startPosition.coords.longitude);
      const nowIso = toIsoNow();
      const startAddress = await resolveAddress(startLat, startLng);

      const newTrip = await addDoc(collection(db, VEHICLE_COLLECTIONS.trips), {
        tripStatus: 'In Progress',
        driverId: String(driver.id),
        driverName: String(driver.driverName || ''),
        linkedUserId: String(user?.id || ''),
        linkedUserName: String(user?.name || ''),
        vehicleId: assignedVehicleId,
        vehicleNumber: assignedVehicleNumber,
        vehicleType: assignedVehicleType,
        fuelType: assignedFuelType,
        vehicleOwnershipType: assignedVehicleId ? 'Company Vehicle' : 'Own Vehicle',
        startTimeIso: nowIso,
        startDate: nowIso.slice(0, 10),
        startLat,
        startLng,
        startAddress: startAddress.formattedAddress,
        startArea: startAddress.area,
        startRoad: startAddress.road,
        startRoadNumber: startAddress.roadNumber,
        startLocality: startAddress.locality,
        startCity: startAddress.city,
        startDistrict: startAddress.district,
        startState: startAddress.state,
        startPostalCode: startAddress.postalCode,
        startCountry: startAddress.country,
        lastLocationLat: startLat,
        lastLocationLng: startLng,
        lastLocationAtIso: nowIso,
        lastAccuracyMeters: Number(startPosition.coords.accuracy || 0),
        lastSpeedKmph: toKmph(startPosition.coords.speed || 0),
        trackingIntervalSec: settingsIntervalSec,
        totalPoints: 0,
        totalDistanceKm: 0,
        sourceApp: 'Driver Mobile',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await pushPosition(newTrip.id, startPosition, intervalSec);

      const trip = {
        id: newTrip.id,
        tripStatus: 'In Progress',
        driverId: String(driver.id),
        driverName: String(driver.driverName || ''),
        vehicleId: assignedVehicleId,
        vehicleNumber: assignedVehicleNumber,
        vehicleType: assignedVehicleType,
        fuelType: assignedFuelType,
        vehicleOwnershipType: assignedVehicleId ? 'Company Vehicle' : 'Own Vehicle',
        startTimeIso: nowIso,
        trackingIntervalSec: intervalSec,
        totalPoints: 1,
        totalDistanceKm: 0,
        lastLocationLat: startLat,
        lastLocationLng: startLng,
        lastLocationAtIso: nowIso,
        startAddress: startAddress.formattedAddress,
        startArea: startAddress.area,
        startRoad: startAddress.road,
        startRoadNumber: startAddress.roadNumber,
        startCity: startAddress.city,
        startState: startAddress.state,
        startPostalCode: startAddress.postalCode,
      };

      setActiveTrip(trip);
      setLatestPosition(startPosition);
      lastSentMsRef.current = Date.now();

      toast({
        title: 'Trip Started',
        description: `Live tracking started at ${intervalSec}s interval.`,
      });

      await loadTrips();
    } catch (error: any) {
      console.error('Failed to start trip', error);
      toast({
        title: 'Unable to Start Trip',
        description: error?.message || 'Please allow location permission and try again.',
        variant: 'destructive',
      });
    } finally {
      setIsStarting(false);
    }
  };

  const stopTrip = async () => {
    if (!activeTrip?.id || isStopping) return;
    setIsStopping(true);
    try {
      await clearWatcher();
      const endIso = toIsoNow();
      const statusPayload: Record<string, any> = {
        tripStatus: 'Completed',
        endTimeIso: endIso,
        updatedAt: serverTimestamp(),
      };
      let endLat = 0;
      let endLng = 0;
      let hasEndCoordinates = false;

      if (latestPosition) {
        endLat = Number(latestPosition.coords.latitude);
        endLng = Number(latestPosition.coords.longitude);
        hasEndCoordinates = true;
      } else if (activeTrip.lastLocationLat && activeTrip.lastLocationLng) {
        endLat = Number(activeTrip.lastLocationLat);
        endLng = Number(activeTrip.lastLocationLng);
        hasEndCoordinates = true;
      }

      if (hasEndCoordinates) {
        statusPayload.endLat = endLat;
        statusPayload.endLng = endLng;
        const endAddress = await resolveAddress(endLat, endLng);
        statusPayload.endAddress = endAddress.formattedAddress;
        statusPayload.endArea = endAddress.area;
        statusPayload.endRoad = endAddress.road;
        statusPayload.endRoadNumber = endAddress.roadNumber;
        statusPayload.endLocality = endAddress.locality;
        statusPayload.endCity = endAddress.city;
        statusPayload.endDistrict = endAddress.district;
        statusPayload.endState = endAddress.state;
        statusPayload.endPostalCode = endAddress.postalCode;
        statusPayload.endCountry = endAddress.country;
      }

      await updateDoc(doc(db, VEHICLE_COLLECTIONS.trips, String(activeTrip.id)), statusPayload);

      if (assignedVehicleId && !isOwnAssignedVehicle) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.vehicleMaster, assignedVehicleId), {
          currentStatus: 'In Operation',
          updatedAt: serverTimestamp(),
        });
      }

      setActiveTrip(null);
      setActiveTripPoints([]);
      lastSentPointRef.current = null;

      toast({
        title: 'Trip Completed',
        description: 'Trip closed and live tracking stopped.',
      });

      await loadTrips();
    } catch (error) {
      console.error('Failed to stop trip', error);
      toast({
        title: 'Unable to Stop Trip',
        description: 'Trip could not be closed right now.',
        variant: 'destructive',
      });
    } finally {
      setIsStopping(false);
    }
  };

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id]);

  useEffect(() => {
    if (!activeTrip?.id) {
      void clearWatcher();
      return;
    }

    let disposed = false;

    const runWatcher = async () => {
      await loadActiveTripPoints(String(activeTrip.id));

      try {
        await ensureDriverGeolocation();
      } catch (error) {
        return;
      }

      await clearWatcher();

      const watchId = await watchDriverPosition(
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        },
        async (position) => {
          setLatestPosition(position);
          const nowMs = Date.now();
          const intervalMs = Math.max(5, Number(settingsIntervalSec || 10)) * 1000;
          if (nowMs - lastSentMsRef.current < intervalMs) return;

          lastSentMsRef.current = nowMs;
          try {
            await pushPosition(String(activeTrip.id), position, settingsIntervalSec);
          } catch (error) {
            console.error('Failed to push trip location', error);
          }
        },
        (error) => {
          console.error('Trip geolocation watcher error', error);
        }
      );

      if (disposed) {
        await clearDriverPositionWatch(watchId);
        return;
      }
      watchIdRef.current = watchId;
    };

    void runWatcher();

    return () => {
      disposed = true;
      void clearWatcher();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id, settingsIntervalSec]);

  useEffect(() => {
    if (!activeTrip?.id) return;
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setInterval(() => {
      loadTrips();
    }, 15000);
    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id]);

  const latestPositionText = useMemo(() => {
    if (latestPosition) {
      return `${latestPosition.coords.latitude.toFixed(6)}, ${latestPosition.coords.longitude.toFixed(6)}`;
    }
    if (activeTrip?.lastLocationLat && activeTrip?.lastLocationLng) {
      return `${Number(activeTrip.lastLocationLat).toFixed(6)}, ${Number(activeTrip.lastLocationLng).toFixed(6)}`;
    }
    return '-';
  }, [activeTrip?.lastLocationLat, activeTrip?.lastLocationLng, latestPosition]);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to access driver trip tracking.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isDriverLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!driver) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Driver Profile Not Linked</CardTitle>
          <CardDescription>Ask admin to link your app user in Driver Management.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Driver Trip Tracking</CardTitle>
          <CardDescription>
            Start trip when driving begins and stop trip when ride is completed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className="bg-cyan-600 text-white">{String(driver.driverName || 'Driver')}</Badge>
            <Badge variant="outline">Vehicle: {assignedVehicleNumber || 'Not assigned'}</Badge>
            <Badge variant="outline">Tracking: {settingsIntervalSec}s</Badge>
            <Badge variant="outline">
              Status: {activeTrip ? 'In Progress' : 'Idle'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
              Start Time: <span className="font-medium">{formatDateTime(String(activeTrip?.startTimeIso || ''))}</span>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
              Last Location: <span className="font-medium">{latestPositionText}</span>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2 sm:col-span-2">
              Start Address: <span className="font-medium">{String(activeTrip?.startAddress || '-')}</span>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
              Start Area: <span className="font-medium">{String(activeTrip?.startArea || '-')}</span>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
              Route Points: <span className="font-medium">{activeTripPoints.length}</span>
            </div>
            <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
              Distance: <span className="font-medium">{Number(activeTrip?.totalDistanceKm || 0).toFixed(2)} km</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              onClick={startTrip}
              disabled={!canStartStop || isStarting || Boolean(activeTrip)}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
            >
              {isStarting ? 'Starting Trip...' : 'Start Trip'}
            </Button>
            <Button
              onClick={stopTrip}
              disabled={!canStartStop || isStopping || !activeTrip}
              className="bg-gradient-to-r from-rose-500 to-orange-600 text-white"
            >
              {isStopping ? 'Closing Trip...' : 'Stop Trip'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeTrip && (
        <TripMapView points={activeTripPoints} title="Live Trip Route" heightClassName="h-[360px]" />
      )}

    </div>
  );
}
