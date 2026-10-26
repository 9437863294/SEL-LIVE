'use client';

/**
 * The driver's own fleet trips, newest first, as a register: the last few from the bootstrap at
 * once, everything (GET trips?scope=mine) on request. One trip per row, every figure in its own
 * column — when and how long, the vehicle, where from and to, what for and for which project, the
 * status, and the three distances side by side (GPS, odometer, billed), so a trip waiting for a
 * manager shows at a glance why. A row opens the trip's detail: the route on the map and the photos.
 *
 * A DataList: the table from `sm` up, and on a phone one compact card per trip — the route in
 * short place names, when and on what, purpose and project, with the status and the billed km on
 * the right. The phone columns are their own (hidden in the table) so the card reads as a line of a
 * list rather than a form of labelled fields. Every cell is plain text and badges, which is what
 * DataList's double mounting (a card and a row per trip) is safe with.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, History, Loader2, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { durationLabel, istTimeLabel, minutesBetween, shortDateLabel } from '@/lib/fleet/dates';
import { TRIP_FLAG_LABELS, formatKm, type FleetTrip } from '@/lib/fleet/types';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { EmptyBlock } from '@/components/driver-management/trips/trip-ui';
import { shortPlace } from '@/lib/fleet/places';

const detailHref = (trip: FleetTrip) => `/driver-management/fleet/trips/${trip.id}`;
const fromOf = (trip: FleetTrip) => trip.startPlace || trip.startGeofenceName || '—';
const toOf = (trip: FleetTrip) => trip.endPlace || trip.endGeofenceName || (trip.status === 'running' || trip.status === 'paused' ? 'On the way' : '—');

/** An address in the table: the short name, in full on hover. */
function Place({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span className={muted ? 'block max-w-[13rem] truncate text-xs text-muted-foreground' : 'block max-w-[13rem] truncate'} title={value}>
      {muted ? '→ ' : ''}
      {shortPlace(value) || value}
    </span>
  );
}

const whenLabel = (trip: FleetTrip, today: string) =>
  `${shortDateLabel(trip.dateKey, today)} · ${istTimeLabel(trip.startedAt)}${trip.endedAt ? `–${istTimeLabel(trip.endedAt)}` : ''}`;

/** The table's flags on one line — the first, and how many more; every one on hover. */
function FlagSummary({ flags }: { flags: FleetTrip['flagCodes'] }) {
  if (!flags.length) return null;
  const labels = flags.map((flag) => TRIP_FLAG_LABELS[flag]);
  return (
    <span className="flex max-w-[9rem] items-center gap-1 text-[11px] font-medium text-rose-700" title={labels.join(', ')}>
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{labels[0]}</span>
      {labels.length > 1 && <span className="shrink-0">+{labels.length - 1}</span>}
    </span>
  );
}

function Distance({ km, strong }: { km: number | null; strong?: boolean }) {
  return <span className={strong ? 'whitespace-nowrap font-semibold tabular-nums text-slate-800' : 'whitespace-nowrap tabular-nums text-slate-600'}>{km === null || km === undefined ? '—' : formatKm(km)}</span>;
}

export function MyFleetTrips({ recent, today }: { recent: FleetTrip[]; today: string }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const all = useFleetQuery<{ trips: FleetTrip[] }>(showAll ? 'trips?scope=mine' : null);
  const trips = showAll && all.data ? all.data.trips : recent;

  const columns: ListColumn<FleetTrip>[] = [
    // The phone card, in columns of its own that the table hides: the route, then when and on
    // what, then what for — with the status and the billed km on the right.
    {
      // DataList keys cells by header: this phone-only title must not share the table's 'Route'.
      header: 'Trip',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="line-clamp-2">
          {shortPlace(fromOf(trip), 1) || fromOf(trip)} → {shortPlace(toOf(trip), 1) || toOf(trip)}
        </span>
      ),
    },
    { header: 'When', mobile: 'title', className: 'hidden', cell: (trip) => `${whenLabel(trip, today)} · ${trip.vehicleNumber}` },
    {
      header: 'For',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="block">
          {trip.purposeName || '—'}
          {trip.projectName ? ` · ${trip.projectCode || trip.projectName}` : ''}
          {trip.flagCodes.length > 0 && <TripFlagChips flags={trip.flagCodes} className="mt-1" />}
        </span>
      ),
    },
    { header: 'State', mobile: 'aside', className: 'hidden', cell: (trip) => <TripStatusBadge status={trip.status} /> },
    {
      header: 'Km',
      mobile: 'aside',
      className: 'hidden',
      cell: (trip) => (
        <span className="block leading-tight">
          <span className="block text-base font-semibold tabular-nums text-slate-800">{formatKm(trip.billableDistanceKm ?? (trip.status === 'cancelled' ? null : trip.gpsDistanceKm))}</span>
          <span className="block text-[10px] text-muted-foreground">{trip.billableDistanceKm !== null ? 'billed' : trip.status === 'cancelled' ? 'cancelled' : 'GPS'}</span>
        </span>
      ),
    },
    {
      // Date, times and the vehicle in one column (two lines), and how long it ran on hover: the
      // table must fit the page beside the module sidebar with every distance in its own column.
      header: 'Date · vehicle',
      mobile: 'omit',
      cell: (trip) => (
        <span className="block whitespace-nowrap" title={trip.endedAt ? durationLabel(minutesBetween(trip.startedAt, trip.endedAt)) : undefined}>
          <span className="font-medium text-slate-800">{shortDateLabel(trip.dateKey, today)}</span>
          <span className="text-xs text-muted-foreground">
            {' · '}
            {istTimeLabel(trip.startedAt)}
            {trip.endedAt ? `–${istTimeLabel(trip.endedAt)}` : ''}
          </span>
          <span className="block text-xs font-medium text-slate-600">{trip.vehicleNumber}</span>
        </span>
      ),
    },
    // From and To share a column (two lines), as do purpose and project: the table has to fit the
    // page beside the module sidebar on a laptop, with every distance still in a column of its own.
    {
      header: 'Route',
      mobile: 'omit',
      cell: (trip) => (
        <span className="block">
          <Place value={fromOf(trip)} />
          <Place value={toOf(trip)} muted />
        </span>
      ),
    },
    {
      header: 'Purpose',
      mobile: 'omit',
      cell: (trip) => (
        <span className="block max-w-[10rem]">
          <span className="block truncate" title={trip.purposeReason ? `${trip.purposeName} — ${trip.purposeReason}` : trip.purposeName}>
            {trip.purposeName || '—'}
          </span>
          <span className="block truncate text-xs text-muted-foreground" title={trip.projectName || undefined}>
            {trip.projectName ? `${trip.projectCode ? `${trip.projectCode} · ` : ''}${trip.projectName}` : 'No project'}
          </span>
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'omit',
      cell: (trip) => (
        // One line of flags under the status, so the column (and the row) stays narrow.
        <span className="flex flex-col items-start gap-1">
          <TripStatusBadge status={trip.status} />
          <FlagSummary flags={trip.flagCodes} />
        </span>
      ),
    },
    { header: 'GPS', align: 'right', mobile: 'omit', cell: (trip) => <Distance km={trip.status === 'cancelled' ? null : trip.gpsDistanceKm} /> },
    { header: 'Odo', align: 'right', mobile: 'omit', cell: (trip) => <Distance km={trip.odoDistanceKm} /> },
    { header: 'Billed', align: 'right', mobile: 'omit', cell: (trip) => <Distance km={trip.billableDistanceKm} strong /> },
  ];

  return (
    <Card className="w-full" id="my-fleet-trips">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-slate-500" aria-hidden />
          {showAll ? 'All my fleet trips' : 'Recent trips'}
          {trips.length > 0 && <span className="text-xs font-normal text-muted-foreground">({trips.length})</span>}
        </CardTitle>
        {recent.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)}>
            {showAll ? 'Show recent' : 'Show all'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4">
        {showAll && all.loading && !all.data ? (
          <p className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading your trips…
          </p>
        ) : showAll && all.error && !all.data ? (
          <div className="flex flex-wrap items-center gap-2 px-1 py-4 text-sm text-rose-700">
            {all.error ?? 'Your trips could not be loaded.'}
            <Button type="button" size="sm" variant="outline" onClick={() => void all.reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <DataList
            rows={trips}
            columns={columns}
            dense
            cardHref={detailHref}
            onRowClick={(trip) => router.push(detailHref(trip))}
            empty={
              <EmptyBlock icon={Route} title="No fleet trips yet">
                Start a trip on a company vehicle and it appears here once it ends.
              </EmptyBlock>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
