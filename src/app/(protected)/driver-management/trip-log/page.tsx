'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
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

  const [isLoading, setIsLoading] = useState(true);
  const [trips, setTrips] = useState<Record<string, any>[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Record<string, any> | null>(null);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TripStatusFilter>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const loadTrips = async () => {
    if (!driver?.id) {
      setTrips([]);
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
          String(b.startTimeIso || '').localeCompare(String(a.startTimeIso || ''))
        );
      setTrips(rows);
    } catch (error) {
      console.error('Failed to load driver trip log', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
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
      { label: 'Trip ID', value: String(selectedTrip.id || '-') },
      { label: 'Vehicle Number', value: String(selectedTrip.vehicleNumber || '-') },
      { label: 'Status', value: String(selectedTrip.tripStatus || '-') },
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
        <CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-2 xl:grid-cols-4">
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
        <CardContent>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="mb-2 h-20 w-full rounded-xl" />)
          ) : filteredTrips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trips found.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/70 bg-white/85">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead>Vehicle</TableHead>
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
                      }}
                    >
                      <TableCell className="font-medium">{trip.vehicleNumber || '-'}</TableCell>
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
                      <TableCell className="max-w-[340px] truncate">
                        {String(trip.startAddress || '-')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
        <DialogContent className="max-h-[88vh] w-[calc(100vw-1rem)] max-w-4xl overflow-y-auto vm-panel-strong">
          <DialogHeader>
            <DialogTitle>Trip Details</DialogTitle>
            <DialogDescription>Complete information in tabular format.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-xl border border-white/70 bg-white/85">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="w-[220px]">Field</TableHead>
                  <TableHead>Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tripDetailRows.map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="break-words">{row.value || '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
