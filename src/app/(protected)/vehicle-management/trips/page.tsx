'use client';

import { useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Download } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { TripLocationPoint, VEHICLE_COLLECTIONS } from '@/lib/vehicle-management';
import TripMapView from '@/components/vehicle-management/trip-map-view';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type StatusFilter = 'All' | 'In Progress' | 'Completed' | 'Cancelled';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
};

export default function TripManagementPage() {
  const { can } = useAuthorization();
  const canView =
    can('View', 'Driver Management.Trip Management') ||
    can('View', 'Vehicle Management.Trip Management');
  const canExport =
    can('Export', 'Driver Management.Trip Management') ||
    can('Export', 'Vehicle Management.Trip Management') ||
    canView;
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [trips, setTrips] = useState<Record<string, any>[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');
  const [selectedTripPoints, setSelectedTripPoints] = useState<TripLocationPoint[]>([]);

  const loadTrips = async () => {
    setIsLoading(true);
    try {
      const snap = await getDocs(collection(db, VEHICLE_COLLECTIONS.trips));
      const rows: Record<string, any>[] = snap.docs
        .map<Record<string, any>>((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) =>
          String(b.startTimeIso || '').localeCompare(String(a.startTimeIso || ''))
        );
      setTrips(rows);
      if (!selectedTripId && rows.length > 0) {
        setSelectedTripId(String(rows[0].id));
      }
    } catch (error) {
      console.error('Failed to load trip management data', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTripPoints = async (tripId: string) => {
    if (!tripId) {
      setSelectedTripPoints([]);
      return;
    }
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
      setSelectedTripPoints(points);
    } catch (error) {
      console.error('Failed to load trip points', error);
      setSelectedTripPoints([]);
    }
  };

  const filteredTrips = useMemo(() => {
    if (statusFilter === 'All') return trips;
    return trips.filter((trip) => String(trip.tripStatus || '') === statusFilter);
  }, [statusFilter, trips]);

  const selectedTrip = useMemo(
    () => trips.find((trip) => String(trip.id) === selectedTripId) || null,
    [selectedTripId, trips]
  );

  const summary = useMemo(() => {
    const total = trips.length;
    const inProgress = trips.filter((trip) => String(trip.tripStatus || '') === 'In Progress').length;
    const completed = trips.filter((trip) => String(trip.tripStatus || '') === 'Completed').length;
    const distance = trips.reduce((sum, trip) => sum + Number(trip.totalDistanceKm || 0), 0);
    return { total, inProgress, completed, distance };
  }, [trips]);

  const exportTrips = async () => {
    if (!canExport || isExporting) return;
    setIsExporting(true);
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Trips');
      sheet.columns = [
        { header: 'Trip ID', key: 'id', width: 28 },
        { header: 'Status', key: 'tripStatus', width: 16 },
        { header: 'Driver', key: 'driverName', width: 22 },
        { header: 'Vehicle Number', key: 'vehicleNumber', width: 20 },
        { header: 'Start Time', key: 'startTimeIso', width: 24 },
        { header: 'Start Address', key: 'startAddress', width: 42 },
        { header: 'Start Road', key: 'startRoad', width: 24 },
        { header: 'Start Road No', key: 'startRoadNumber', width: 18 },
        { header: 'Start Area', key: 'startArea', width: 24 },
        { header: 'End Time', key: 'endTimeIso', width: 24 },
        { header: 'End Address', key: 'endAddress', width: 42 },
        { header: 'End Road', key: 'endRoad', width: 24 },
        { header: 'End Road No', key: 'endRoadNumber', width: 18 },
        { header: 'End Area', key: 'endArea', width: 24 },
        { header: 'Distance KM', key: 'totalDistanceKm', width: 14 },
        { header: 'Points', key: 'totalPoints', width: 10 },
        { header: 'Tracking Interval Sec', key: 'trackingIntervalSec', width: 18 },
        { header: 'Last Location Lat', key: 'lastLocationLat', width: 16 },
        { header: 'Last Location Lng', key: 'lastLocationLng', width: 16 },
      ];

      filteredTrips.forEach((trip) => {
        sheet.addRow({
          id: String(trip.id || ''),
          tripStatus: String(trip.tripStatus || ''),
          driverName: String(trip.driverName || ''),
          vehicleNumber: String(trip.vehicleNumber || ''),
          startTimeIso: String(trip.startTimeIso || ''),
          startAddress: String(trip.startAddress || ''),
          startRoad: String(trip.startRoad || ''),
          startRoadNumber: String(trip.startRoadNumber || ''),
          startArea: String(trip.startArea || ''),
          endTimeIso: String(trip.endTimeIso || ''),
          endAddress: String(trip.endAddress || ''),
          endRoad: String(trip.endRoad || ''),
          endRoadNumber: String(trip.endRoadNumber || ''),
          endArea: String(trip.endArea || ''),
          totalDistanceKm: Number(trip.totalDistanceKm || 0),
          totalPoints: Number(trip.totalPoints || 0),
          trackingIntervalSec: Number(trip.trackingIntervalSec || 0),
          lastLocationLat: Number(trip.lastLocationLat || 0),
          lastLocationLng: Number(trip.lastLocationLng || 0),
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `trip-management-${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export trips', error);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    loadTrips();
  }, []);

  useEffect(() => {
    loadTripPoints(selectedTripId);
  }, [selectedTripId]);

  useEffect(() => {
    if (!selectedTrip || String(selectedTrip.tripStatus || '') !== 'In Progress') return;
    const timer = window.setInterval(() => {
      loadTrips();
      loadTripPoints(String(selectedTrip.id || ''));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [selectedTrip]);

  if (!canView) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have permission to view trip management.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-blue-500 via-cyan-500 to-emerald-500 animate-bb-gradient" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="tracking-tight">Trip Management</CardTitle>
            <CardDescription>
              Monitor driver trips, live locations, and completed ride history.
            </CardDescription>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="w-full bg-white/85 sm:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All Status</SelectItem>
                <SelectItem value="In Progress">In Progress</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            {canExport && (
              <Button
                variant="outline"
                onClick={exportTrips}
                disabled={isExporting}
                className="w-full bg-white/85 sm:w-auto"
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export Excel'}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={loadTrips}
              className="w-full bg-white/85 sm:w-auto"
            >
              Refresh
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="vm-panel">
          <CardHeader className="pb-2">
            <CardDescription>Total Trips</CardDescription>
            <CardTitle className="text-xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel">
          <CardHeader className="pb-2">
            <CardDescription>In Progress</CardDescription>
            <CardTitle className="text-xl">{summary.inProgress}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel">
          <CardHeader className="pb-2">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="text-xl">{summary.completed}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="vm-panel">
          <CardHeader className="pb-2">
            <CardDescription>Total Distance</CardDescription>
            <CardTitle className="text-xl">{summary.distance.toFixed(2)} km</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="vm-panel">
        <CardHeader>
          <CardTitle className="text-lg">Trip List</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {filteredTrips.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trips found for selected filter.</p>
          ) : (
            filteredTrips.map((trip) => (
              <button
                key={String(trip.id)}
                type="button"
                onClick={() => setSelectedTripId(String(trip.id))}
                className={`w-full rounded-xl border p-3 text-left text-sm shadow-sm transition ${
                  selectedTripId === String(trip.id)
                    ? 'border-cyan-400 bg-cyan-50/70'
                    : 'border-white/70 bg-white/85 hover:border-cyan-300'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold">{trip.vehicleNumber || '-'}</span>
                  <Badge
                    variant={String(trip.tripStatus) === 'In Progress' ? 'default' : 'outline'}
                    className={String(trip.tripStatus) === 'In Progress' ? 'bg-emerald-600 text-white' : ''}
                  >
                    {trip.tripStatus || '-'}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  <div>Driver: {trip.driverName || '-'}</div>
                  <div>Start: {formatDateTime(String(trip.startTimeIso || ''))}</div>
                  <div>End: {formatDateTime(String(trip.endTimeIso || ''))}</div>
                  <div>Distance: {Number(trip.totalDistanceKm || 0).toFixed(2)} km</div>
                  <div className="sm:col-span-2">Start Address: {String(trip.startAddress || '-')}</div>
                  <div className="sm:col-span-2">End Address: {String(trip.endAddress || '-')}</div>
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {selectedTrip && (
        <>
          <Card className="vm-panel">
            <CardHeader>
              <CardTitle className="text-lg">Selected Trip Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                Driver: <span className="font-medium">{selectedTrip.driverName || '-'}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                Vehicle: <span className="font-medium">{selectedTrip.vehicleNumber || '-'}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                Start: <span className="font-medium">{formatDateTime(String(selectedTrip.startTimeIso || ''))}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                End: <span className="font-medium">{formatDateTime(String(selectedTrip.endTimeIso || ''))}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2 sm:col-span-2">
                Start Address: <span className="font-medium">{String(selectedTrip.startAddress || '-')}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2 sm:col-span-2">
                End Address: <span className="font-medium">{String(selectedTrip.endAddress || '-')}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                Points: <span className="font-medium">{selectedTripPoints.length}</span>
              </div>
              <div className="rounded-lg border border-white/70 bg-white/85 px-3 py-2">
                Last GPS: <span className="font-medium">{Number(selectedTrip.lastLocationLat || 0).toFixed(6)}, {Number(selectedTrip.lastLocationLng || 0).toFixed(6)}</span>
              </div>
            </CardContent>
          </Card>

          <TripMapView points={selectedTripPoints} title="Trip Route Map" heightClassName="h-[380px]" />
        </>
      )}
    </div>
  );
}
