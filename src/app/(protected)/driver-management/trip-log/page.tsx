'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDocs, limit, orderBy,
  query, QueryDocumentSnapshot, serverTimestamp,
  startAfter, updateDoc, where,
} from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import {
  computeTripDistanceKmFromPoints,
  TripLocationPoint,
  VEHICLE_COLLECTIONS,
} from '@/lib/vehicle-management';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type TripStatusFilter = 'All' | 'In Progress' | 'Completed' | 'Cancelled';

const formatDateTime = (iso?: string) => {
  if (!iso) return '-';
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleString();
};

export default function DriverTripLogPage() {
  const { can } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canView =
    can('View', 'Driver Management.Driver Trips') ||
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Vehicle Management.Driver Mobile Trip') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;

  const PAGE_SIZE = 30;

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [trips, setTrips] = useState<Record<string, any>[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<Record<string, any> | null>(null);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TripStatusFilter>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const hydrateTripDistance = async (trip: Record<string, any>) => {
    const tripId = String(trip.id || '');
    if (!tripId) return;
    try {
      const pointsSnap = await getDocs(
        query(collection(db, VEHICLE_COLLECTIONS.tripLocations), where('tripId', '==', tripId))
      );
      const points = pointsSnap.docs
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
      const correctedDistanceKm = computeTripDistanceKmFromPoints(points);
      const currentDistanceKm = Number(trip.totalDistanceKm || 0);
      if (Math.abs(correctedDistanceKm - currentDistanceKm) >= 0.05) {
        await updateDoc(doc(db, VEHICLE_COLLECTIONS.trips, tripId), {
          totalDistanceKm: correctedDistanceKm,
          totalPoints: points.length,
          updatedAt: serverTimestamp(),
        });
      }
      setTrips((prev) =>
        prev.map((row) =>
          String(row.id) === tripId ? { ...row, totalDistanceKm: correctedDistanceKm, totalPoints: points.length } : row
        )
      );
      setSelectedTrip((prev) =>
        prev && String(prev.id) === tripId
          ? { ...prev, totalDistanceKm: correctedDistanceKm, totalPoints: points.length }
          : prev
      );
    } catch (error) {
      console.error('Failed to hydrate trip distance from route points', error);
    }
  };

  const loadTrips = async () => {
    if (!driver?.id) {
      setTrips([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const q = query(
        collection(db, VEHICLE_COLLECTIONS.trips),
        where('driverId', '==', String(driver.id)),
        orderBy('startTimeIso', 'desc'),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }));
      setTrips(rows);
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load driver trip log', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMoreTrips = async () => {
    if (!driver?.id || !lastDoc || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const q = query(
        collection(db, VEHICLE_COLLECTIONS.trips),
        where('driverId', '==', String(driver.id)),
        orderBy('startTimeIso', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const rows = snap.docs.map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }));
      setTrips((prev) => [...prev, ...rows]);
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null);
      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (error) {
      console.error('Failed to load more trips', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    void loadTrips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.id]);

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const status = String(trip.tripStatus || '');
      if (statusFilter !== 'All' && status !== statusFilter) return false;

      const startDate = String(trip.startDate || String(trip.startTimeIso || '').slice(0, 10));
      if (dateFrom && startDate < dateFrom) return false;
      if (dateTo && startDate > dateTo) return false;

      return true;
    });
  }, [dateFrom, dateTo, trips, statusFilter]);

  const tripSummary = useMemo(() => {
    const totalTrips = filteredTrips.length;
    const completedTrips = filteredTrips.filter((trip) => String(trip.tripStatus || '') === 'Completed').length;
    const inProgressTrips = filteredTrips.filter((trip) => String(trip.tripStatus || '') === 'In Progress').length;
    const cancelledTrips = filteredTrips.filter((trip) => String(trip.tripStatus || '') === 'Cancelled').length;
    const totalDistance = filteredTrips.reduce((sum, trip) => sum + Number(trip.totalDistanceKm || 0), 0);
    const totalPoints = filteredTrips.reduce((sum, trip) => sum + Number(trip.totalPoints || 0), 0);
    return {
      totalTrips,
      completedTrips,
      inProgressTrips,
      cancelledTrips,
      totalDistance,
      totalPoints,
    };
  }, [filteredTrips]);

  const tripDetailRows = useMemo(() => {
    if (!selectedTrip) return [];
    const startLat = selectedTrip.startLat ?? selectedTrip.lastLocationLat ?? '';
    const startLng = selectedTrip.startLng ?? selectedTrip.lastLocationLng ?? '';
    const endLat = selectedTrip.endLat ?? '';
    const endLng = selectedTrip.endLng ?? '';
    return [
      { label: 'Start Time', value: formatDateTime(String(selectedTrip.startTimeIso || '')) },
      { label: 'End Time', value: formatDateTime(String(selectedTrip.endTimeIso || '')) },
      { label: 'Distance (KM)', value: Number(selectedTrip.totalDistanceKm || 0).toFixed(2) },
      { label: 'Route Points', value: String(selectedTrip.totalPoints || 0) },
      { label: 'Tracking Interval (Sec)', value: String(selectedTrip.trackingIntervalSec || '-') },
      { label: 'Start Address', value: String(selectedTrip.startAddress || '-') },
      { label: 'Start Area', value: String(selectedTrip.startArea || '-') },
      { label: 'Start Coordinates', value: startLat && startLng ? `${startLat}, ${startLng}` : '-' },
      { label: 'End Address', value: String(selectedTrip.endAddress || '-') },
      { label: 'End Area', value: String(selectedTrip.endArea || '-') },
      { label: 'End Coordinates', value: endLat && endLng ? `${endLat}, ${endLng}` : '-' },
    ];
  }, [selectedTrip]);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to access driver trip log.</CardDescription>
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
        <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-sky-500 to-blue-600 animate-bb-gradient" />
        <CardHeader>
          <CardTitle className="tracking-tight">Driver Trip Log</CardTitle>
          <CardDescription>All trips with summary and filters. Click row for complete details.</CardDescription>
        </CardHeader>
      </Card>

      <Card className="vm-panel">
        <CardContent className="grid grid-cols-2 gap-3 pt-6 md:grid-cols-4">
          <div className="rounded-xl border border-cyan-100/70 bg-white/85 px-3 py-2">
            <p className="text-xs text-muted-foreground">Trips</p>
            <p className="text-xl font-semibold">{tripSummary.totalTrips}</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/85 px-3 py-2">
            <p className="text-xs text-muted-foreground">Distance</p>
            <p className="text-xl font-semibold">{tripSummary.totalDistance.toFixed(2)} km</p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/85 px-3 py-2">
            <p className="text-xs text-muted-foreground">In Progress / Completed</p>
            <p className="text-xl font-semibold">
              {tripSummary.inProgressTrips} / {tripSummary.completedTrips}
            </p>
          </div>
          <div className="rounded-xl border border-cyan-100/70 bg-white/85 px-3 py-2">
            <p className="text-xs text-muted-foreground">Points / Cancelled</p>
            <p className="text-xl font-semibold">
              {tripSummary.totalPoints} / {tripSummary.cancelledTrips}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TripStatusFilter)}>
              <SelectTrigger className="bg-white/85">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-white/85" />
          </div>
          <div className="space-y-2">
            <Label>Date To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-white/85" />
          </div>
        </CardContent>
      </Card>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Trip Table</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-20 w-full rounded-xl" />)}
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No trips found.</div>
          ) : (
            <>
              {/* Mobile card view */}
              <div className="space-y-2 p-4 sm:hidden">
                {filteredTrips.map((trip) => (
                  <div
                    key={String(trip.id)}
                    className="rounded-xl border border-white/70 bg-white/85 p-4 shadow-sm active:scale-[0.99] transition-transform cursor-pointer"
                    onClick={() => {
                      setSelectedTrip(trip);
                      setTripDialogOpen(true);
                      void hydrateTripDistance(trip);
                    }}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <Badge
                        variant={String(trip.tripStatus) === 'In Progress' ? 'default' : 'outline'}
                        className={String(trip.tripStatus) === 'In Progress' ? 'bg-emerald-600 text-white' : ''}
                      >
                        {trip.tripStatus || '-'}
                      </Badge>
                      <span className="text-sm font-semibold">{Number(trip.totalDistanceKm || 0).toFixed(2)} km</span>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex justify-between gap-2">
                        <span>Start</span>
                        <span className="font-medium text-slate-700">{formatDateTime(String(trip.startTimeIso || ''))}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span>End</span>
                        <span className="font-medium text-slate-700">{formatDateTime(String(trip.endTimeIso || ''))}</span>
                      </div>
                      {trip.startAddress && (
                        <div className="flex justify-between gap-2">
                          <span>From</span>
                          <span className="max-w-[60%] truncate text-right">{String(trip.startAddress)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <span>Points</span>
                        <span>{Number(trip.totalPoints || 0)}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-right text-xs text-muted-foreground">Tap for details →</p>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-auto rounded-xl border border-white/70 bg-white/85 h-[calc(100vh-420px)]">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-slate-50 [&_th]:shadow-sm">
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Start</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead>Distance</TableHead>
                      <TableHead>Points</TableHead>
                      <TableHead>Start Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTrips.map((trip) => (
                      <TableRow
                        key={String(trip.id)}
                        className="cursor-pointer hover:bg-cyan-50/70 transition-colors"
                        onClick={() => {
                          setSelectedTrip(trip);
                          setTripDialogOpen(true);
                          void hydrateTripDistance(trip);
                        }}
                      >
                        <TableCell>
                          <Badge
                            variant={String(trip.tripStatus) === 'In Progress' ? 'default' : 'outline'}
                            className={String(trip.tripStatus) === 'In Progress' ? 'bg-emerald-600 text-white' : ''}
                          >
                            {trip.tripStatus || '-'}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDateTime(String(trip.startTimeIso || ''))}</TableCell>
                        <TableCell>{formatDateTime(String(trip.endTimeIso || ''))}</TableCell>
                        <TableCell>{Number(trip.totalDistanceKm || 0).toFixed(2)} km</TableCell>
                        <TableCell>{Number(trip.totalPoints || 0)}</TableCell>
                        <TableCell className="max-w-[280px] truncate">{String(trip.startAddress || '-')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </table>
              </div>
            </>
          )}
          {/* Load More + count */}
          {!isLoading && trips.length > 0 && (
            <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-2">
              <p className="text-xs text-muted-foreground">
                Showing {trips.length} trip{trips.length !== 1 ? 's' : ''}
                {hasMore ? ' · more available' : ' · all loaded'}
              </p>
              {hasMore && (
                <Button variant="outline" size="sm" onClick={loadMoreTrips} disabled={isLoadingMore} className="w-full sm:w-auto">
                  {isLoadingMore && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  {isLoadingMore ? 'Loading…' : `Load ${PAGE_SIZE} More`}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={tripDialogOpen}
        onOpenChange={(open) => {
          setTripDialogOpen(open);
          if (!open) setSelectedTrip(null);
        }}
      >
        <DialogContent className="max-h-[88vh] w-[calc(100vw-1rem)] sm:max-w-xl lg:max-w-3xl overflow-y-auto vm-panel-strong">
          <DialogHeader>
            <DialogTitle>Trip Details</DialogTitle>
            <DialogDescription>Complete information in tabular format.</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border rounded-xl border border-white/70 bg-white/85">
            {tripDetailRows.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-xs font-semibold text-muted-foreground sm:w-48 sm:shrink-0">{row.label}</dt>
                <dd className="break-words text-sm font-medium text-slate-800">{row.value || '-'}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
