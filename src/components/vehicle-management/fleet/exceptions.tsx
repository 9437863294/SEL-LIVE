'use client';

/**
 * Fleet Exceptions: every fleet trip and fuel entry with something open on it.
 *
 * - **Trips** — waiting for review (GPS and odometer disagree, closed without a reading, ran past
 *   an approved cap) come first and are settled by reviewing them; the rest carry flags (a GPS gap,
 *   a long idle, unlogged running before the trip…) and are resolved with a note of what was found.
 * - **Fuel** — fill-ups flagged for low mileage, more than the tank holds, an unusual price per
 *   litre, no trip since the last fill, or a reading below the last one. The bill and odometer
 *   photos are a tap away.
 *
 * Resolving keeps the flags on the record; it says someone looked. The list is everything with
 * Fleet Trips · View (or Review, or on the escalation list), otherwise the vehicles and drivers the
 * person manages. Nobody resolves their own trip or fill-up.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Fuel, Images, Route, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogClose } from '@/components/ui/dialog';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { FormDialog } from '@/components/shared/form-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { FleetPhoto, FuelFlagChips, TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { ReviewTripDialog, ResolveExceptionDialog } from '@/components/driver-management/fleet/review-dialogs';
import { EmptyBlock, ErrorBlock, LoadingBlock, SegmentTabs } from '@/components/driver-management/trips/trip-ui';
import { shortDateLabel } from '@/lib/fleet/dates';
import { TRIP_FLAG_HINTS, formatINR, formatKm, type FleetTrip } from '@/lib/fleet/types';
import type { FuelEntryView } from '@/lib/fleet/server/fuel';

type Tab = 'trips' | 'fuel';

interface ExceptionsPayload {
  trips: FleetTrip[];
  fuel: FuelEntryView[];
  scope: 'all' | 'managed';
}

interface ResolveTarget {
  kind: 'trip' | 'fuel';
  id: string;
  label: string;
}

const tripLabel = (trip: FleetTrip) => `${trip.vehicleNumber} · ${trip.driverName} · ${shortDateLabel(trip.dateKey)}`;
const fuelLabel = (entry: FuelEntryView) => `${entry.vehicleNumber} · ${entry.litres} L · ${shortDateLabel(entry.fuelDate)}`;

export default function FleetExceptions() {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const query = useFleetQuery<ExceptionsPayload>('exceptions');
  const [tab, setTab] = useState<Tab>('trips');
  const [reviewing, setReviewing] = useState<FleetTrip | null>(null);
  const [resolving, setResolving] = useState<ResolveTarget | null>(null);
  const [photos, setPhotos] = useState<FuelEntryView | null>(null);

  const trips = useMemo(() => query.data?.trips ?? [], [query.data]);
  const fuel = useMemo(() => query.data?.fuel ?? [], [query.data]);
  const reviewCount = trips.filter((trip) => trip.status === 'pending_review').length;

  const reload = () => void query.reload();

  const tripColumns: ListColumn<FleetTrip>[] = [
    {
      header: 'Trip',
      mobile: 'title',
      cell: (trip) => (
        <div className="min-w-0">
          <Link href={`/driver-management/fleet/trips/${trip.id}`} className="font-medium text-slate-800 hover:underline">
            {trip.vehicleNumber}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {trip.driverName} · {shortDateLabel(trip.dateKey)}
          </p>
          {trip.projectName && <p className="truncate text-[11px] text-muted-foreground">{trip.projectName}</p>}
        </div>
      ),
    },
    {
      header: 'Km',
      align: 'right',
      cell: (trip) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          <span className="block">GPS {formatKm(trip.gpsDistanceKm > 0 ? trip.gpsDistanceKm : null)}</span>
          <span className="block">Odo {formatKm(trip.odoDistanceKm)}</span>
          <span className="block font-medium text-slate-800">Billed {formatKm(trip.billableDistanceKm)}</span>
        </span>
      ),
    },
    {
      header: 'What is open',
      cell: (trip) => (
        <div className="max-w-[24rem] space-y-1">
          <TripFlagChips flags={trip.flagCodes} />
          <p className="text-xs text-slate-600">{trip.status === 'pending_review' ? trip.review?.reason ?? 'Waiting for a manager to pick the km to bill.' : trip.flagCodes[0] ? TRIP_FLAG_HINTS[trip.flagCodes[0]] : 'Needs a look.'}</p>
        </div>
      ),
    },
    { header: 'Status', mobile: 'aside', cell: (trip) => <TripStatusBadge status={trip.status} /> },
    {
      header: '',
      mobile: 'footer',
      align: 'right',
      cell: (trip) =>
        trip.driverUserId === userId ? (
          <span className="text-xs text-muted-foreground">Your trip</span>
        ) : trip.status === 'pending_review' ? (
          <Button type="button" size="sm" onClick={() => setReviewing(trip)}>
            Review
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setResolving({ kind: 'trip', id: trip.id, label: tripLabel(trip) })}>
            Resolve
          </Button>
        ),
    },
  ];

  const fuelColumns: ListColumn<FuelEntryView>[] = [
    {
      header: 'Fill-up',
      mobile: 'title',
      cell: (entry) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{entry.vehicleNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.driverName || 'Unknown driver'} · {shortDateLabel(entry.fuelDate)}
          </p>
          {entry.stationName && <p className="truncate text-[11px] text-muted-foreground">{entry.stationName}</p>}
        </div>
      ),
    },
    {
      header: 'Fuel',
      align: 'right',
      cell: (entry) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          <span className="block font-medium text-slate-800">
            {entry.litres} L · {formatINR(entry.amount)}
          </span>
          <span className="block text-muted-foreground">
            {formatINR(entry.ratePerL)}/L · {entry.fullTank ? 'Full tank' : 'Partial'}
          </span>
        </span>
      ),
    },
    {
      header: 'Mileage',
      align: 'right',
      cell: (entry) => (
        <span className="whitespace-nowrap text-xs tabular-nums">
          <span className="block">{entry.mileageKmpl !== null ? `${entry.mileageKmpl} km/L` : '—'}</span>
          {entry.distanceSincePreviousKm !== null && <span className="block text-muted-foreground">{formatKm(entry.distanceSincePreviousKm)} since last fill</span>}
          {entry.expectedLitres !== null && <span className="block text-muted-foreground">{entry.expectedLitres} L expected</span>}
        </span>
      ),
    },
    { header: 'Flags', cell: (entry) => <FuelFlagChips flags={entry.flagCodes} /> },
    {
      header: '',
      mobile: 'footer',
      align: 'right',
      cell: (entry) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {(entry.billUploadId || entry.odometerUploadId) && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setPhotos(entry)}>
              <Images className="mr-1.5 h-4 w-4" aria-hidden />
              Photos
            </Button>
          )}
          {entry.driverUserId !== userId && (
            <Button type="button" size="sm" variant="outline" onClick={() => setResolving({ kind: 'fuel', id: entry.id, label: fuelLabel(entry) })}>
              Resolve
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fleet Exceptions"
        icon={ShieldAlert}
        description="Fleet trips and fuel entries with something open — review the trips waiting for a figure, and resolve the rest with a note."
        meta={query.data ? [{ label: 'To review', value: String(reviewCount) }, { label: 'Trips', value: String(trips.length) }, { label: 'Fuel', value: String(fuel.length) }] : undefined}
      />

      {query.data?.scope === 'managed' && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">Showing the vehicles and drivers you manage. Vehicle Management · Fleet Trips · View shows the whole fleet.</p>
      )}

      <SegmentTabs<Tab>
        label="Exceptions"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'trips', label: 'Trips', count: query.data ? trips.length : undefined },
          { value: 'fuel', label: 'Fuel', count: query.data ? fuel.length : undefined },
        ]}
      />

      {query.error && !query.data ? (
        <ErrorBlock message={query.error} onRetry={reload} />
      ) : !query.data ? (
        <LoadingBlock />
      ) : tab === 'trips' ? (
        <DataList
          rows={trips}
          columns={tripColumns}
          dense
          rowClassName={(trip) => (trip.status === 'pending_review' ? 'bg-amber-50/40' : undefined)}
          empty={
            <EmptyBlock icon={Route} title="No trip exceptions">
              Trips with a GPS gap, a long idle, running past the limit or a disagreement between GPS and the odometer appear here.
            </EmptyBlock>
          }
        />
      ) : (
        <DataList
          rows={fuel}
          columns={fuelColumns}
          dense
          empty={
            <EmptyBlock icon={Fuel} title="No fuel exceptions">
              Fill-ups with low mileage, more than the tank holds, an unusual price, or no trip since the last fill appear here.
            </EmptyBlock>
          }
        />
      )}

      {/* Overlays live here, once per page, not in the list's cells (which mount twice). */}
      {reviewing && (
        <ReviewTripDialog
          trip={reviewing}
          open
          onOpenChange={(open) => {
            if (!open) setReviewing(null);
          }}
          onDone={() => {
            setReviewing(null);
            reload();
          }}
        />
      )}
      <ResolveExceptionDialog
        kind={resolving?.kind ?? 'trip'}
        id={resolving?.id ?? ''}
        label={resolving?.label ?? ''}
        open={Boolean(resolving)}
        onOpenChange={(open) => {
          if (!open) setResolving(null);
        }}
        onDone={() => {
          setResolving(null);
          reload();
        }}
      />
      <FormDialog
        open={Boolean(photos)}
        onOpenChange={(open) => {
          if (!open) setPhotos(null);
        }}
        size="lg"
        title={photos ? `Fuel photos · ${photos.vehicleNumber}` : 'Fuel photos'}
        description={photos ? `${photos.litres} L for ${formatINR(photos.amount)} on ${shortDateLabel(photos.fuelDate)}${photos.billNumber ? ` · bill ${photos.billNumber}` : ''}` : undefined}
        footer={
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Close
            </Button>
          </DialogClose>
        }
      >
        {photos && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <figure className="min-w-0 space-y-1.5">
              <figcaption className="text-xs font-medium text-slate-700">Bill</figcaption>
              {photos.billUploadId ? <FleetPhoto uploadId={photos.billUploadId} alt={`Fuel bill for ${photos.vehicleNumber}`} /> : <p className="text-xs text-muted-foreground">No bill photo.</p>}
            </figure>
            <figure className="min-w-0 space-y-1.5">
              <figcaption className="text-xs font-medium text-slate-700">Odometer{photos.odometerKm !== null ? ` · ${photos.odometerKm.toLocaleString('en-IN')} km` : ''}</figcaption>
              {photos.odometerUploadId ? <FleetPhoto uploadId={photos.odometerUploadId} alt={`Odometer of ${photos.vehicleNumber}`} /> : <p className="text-xs text-muted-foreground">No odometer photo.</p>}
            </figure>
          </div>
        )}
      </FormDialog>
    </div>
  );
}
