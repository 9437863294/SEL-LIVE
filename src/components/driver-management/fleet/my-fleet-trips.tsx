'use client';

/**
 * The driver's own trips on Fleet Trip, newest first — company-vehicle (fleet) trips and own-vehicle
 * trips in one register, since Fleet Trip records both: the last few at once, everything (GET
 * trips?scope=mine for the fleet ones; the own ones are all loaded already) on request. One trip per
 * row, every figure in its own column — when and how long, the vehicle, where from and to, what for
 * and for which project, the status, and the three distances side by side (GPS, odometer, and what
 * was billed or claimed), so a trip waiting for a manager shows at a glance why. A row opens the
 * trip's page: the route on the map and the photos (a company trip), or the route, the money and
 * its claim (an own trip — trip-record-detail.tsx).
 *
 * The two kinds are turned into one row shape (`RecentRow`) so the columns read the same; what only
 * one kind has (flags, an amount) comes from the trip kept on the row.
 *
 * A DataList: the table from `sm` up, and on a phone one compact card per trip — the route in
 * short place names, when and on what, purpose and project, with the status and the km on the
 * right. The phone columns are their own (hidden in the table) so the card reads as a line of a
 * list rather than a form of labelled fields. Every cell is plain text and badges, which is what
 * DataList's double mounting (a card and a row per trip) is safe with.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, History, Loader2, RefreshCw, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataList, type ListColumn } from '@/components/shared/data-list';
import { durationLabel, istTimeLabel, minutesBetween, shortDateLabel } from '@/lib/fleet/dates';
import { TRIP_FLAG_LABELS, formatKm, type FleetTrip } from '@/lib/fleet/types';
import type { TripRecord } from '@/lib/employee-trips/types';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { EmptyBlock, FlagChips, Money, TripStatusBadge as ClaimTripStatusBadge } from '@/components/driver-management/trips/trip-ui';
import { shortPlace } from '@/lib/fleet/places';
import { cn } from '@/lib/utils';

/** How many trips "Recent" shows, of both kinds together. */
const RECENT_COUNT = 10;

/** One trip of either kind, in the register's terms. */
interface RecentRow {
  id: string;
  href: string;
  /** When it started (ms), for the order. */
  at: number;
  dateKey: string;
  /** "09:31–09:58", or '' for a typed own trip. */
  times: string;
  durationMinutes: number | null;
  vehicleNumber: string;
  from: string;
  to: string;
  purpose: string;
  purposeTitle: string;
  project: string;
  gpsKm: number | null;
  odoKm: number | null;
  /** Billed (company) or claimed (own); null until a company trip is settled. */
  km: number | null;
  kmLabel: string;
  fleet: FleetTrip | null;
  own: TripRecord | null;
}

const IST_MIDNIGHT = 'T00:00:00+05:30';

function fromFleet(trip: FleetTrip): RecentRow {
  const open = trip.status === 'running' || trip.status === 'paused';
  return {
    id: `company-${trip.id}`,
    href: `/driver-management/fleet/trips/${trip.id}`,
    at: Date.parse(trip.startedAt),
    dateKey: trip.dateKey,
    times: `${istTimeLabel(trip.startedAt)}${trip.endedAt ? `–${istTimeLabel(trip.endedAt)}` : ''}`,
    durationMinutes: trip.endedAt ? minutesBetween(trip.startedAt, trip.endedAt) : null,
    vehicleNumber: trip.vehicleNumber,
    from: trip.startPlace || trip.startGeofenceName || '—',
    to: trip.endPlace || trip.endGeofenceName || (open ? 'On the way' : '—'),
    purpose: trip.purposeName,
    purposeTitle: trip.purposeReason ? `${trip.purposeName} — ${trip.purposeReason}` : trip.purposeName,
    project: trip.projectName ? `${trip.projectCode ? `${trip.projectCode} · ` : ''}${trip.projectName}` : '',
    gpsKm: trip.status === 'cancelled' ? null : trip.gpsDistanceKm,
    odoKm: trip.odoDistanceKm,
    km: trip.billableDistanceKm ?? (trip.status === 'cancelled' ? null : trip.gpsDistanceKm),
    kmLabel: trip.billableDistanceKm !== null ? 'billed' : trip.status === 'cancelled' ? 'cancelled' : 'GPS',
    fleet: trip,
    own: null,
  };
}

function fromOwn(trip: TripRecord): RecentRow {
  const gps = trip.gps;
  const startedAt = gps ? Date.parse(gps.startedAtIso) : NaN;
  return {
    id: `own-${trip.id}`,
    href: `/driver-management/trips/${trip.id}?from=fleet`,
    at: Number.isFinite(startedAt) ? startedAt : Date.parse(`${trip.tripDate}${IST_MIDNIGHT}`),
    dateKey: trip.tripDate,
    times: gps ? `${istTimeLabel(gps.startedAtIso)}–${istTimeLabel(gps.endedAtIso)}` : '',
    durationMinutes: gps ? minutesBetween(gps.startedAtIso, gps.endedAtIso) : null,
    vehicleNumber: trip.vehicleNumber,
    from: trip.fromPlace || '—',
    to: trip.toPlace || '—',
    purpose: trip.purpose,
    purposeTitle: trip.purpose,
    project: trip.projectName ?? '',
    gpsKm: gps ? gps.measuredKm : null,
    odoKm: trip.startOdometer !== null && trip.endOdometer !== null ? Math.round((trip.endOdometer - trip.startOdometer) * 10) / 10 : null,
    km: trip.distanceKm,
    kmLabel: 'claimed',
    fleet: null,
    own: trip,
  };
}

const newestFirst = (a: RecentRow, b: RecentRow) => (b.at || 0) - (a.at || 0);

/** An address in the table: the short name, in full on hover. */
function Place({ value, muted }: { value: string; muted?: boolean }) {
  return (
    <span className={muted ? 'block max-w-[13rem] truncate text-xs text-muted-foreground' : 'block max-w-[13rem] truncate'} title={value}>
      {muted ? '→ ' : ''}
      {shortPlace(value) || value}
    </span>
  );
}

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

/** The status of either kind of trip: the fleet's states, or where an own trip's claim stands. */
const StatusOf = ({ row }: { row: RecentRow }) => (row.fleet ? <TripStatusBadge status={row.fleet.status} /> : row.own ? <ClaimTripStatusBadge status={row.own.status} /> : null);

// A trip-claims record can be on a company vehicle too (one claimed before fleet trips existed).
const isOwnVehicle = (row: RecentRow) => row.own?.ownership === 'own';
const kindLabel = (row: RecentRow) => (isOwnVehicle(row) ? 'Own vehicle' : 'Company');

export function MyFleetTrips({
  recent,
  ownTrips = [],
  today,
  onRefresh,
  refreshing = false,
}: {
  recent: FleetTrip[];
  /** The employee's own-vehicle trips (all of them — My Trips' list). */
  ownTrips?: TripRecord[];
  today: string;
  /** Reloads the Fleet Trip screen — its refresh lives here, beside the trips it updates. */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const all = useFleetQuery<{ trips: FleetTrip[] }>(showAll ? 'trips?scope=mine' : null);
  const fleetTrips = showAll && all.data ? all.data.trips : recent;
  const busy = refreshing || (showAll && all.loading);

  const rows = useMemo(() => {
    const merged = [...fleetTrips.map(fromFleet), ...ownTrips.map(fromOwn)].sort(newestFirst);
    return showAll ? merged : merged.slice(0, RECENT_COUNT);
  }, [fleetTrips, ownTrips, showAll]);
  // The bootstrap has only the last few fleet trips; the own ones are all here already.
  const hasMore = recent.length > 0 || ownTrips.length > RECENT_COUNT;

  const whenLabel = (row: RecentRow) => `${shortDateLabel(row.dateKey, today)}${row.times ? ` · ${row.times}` : ''}`;

  const columns: ListColumn<RecentRow>[] = [
    // The phone card, in columns of its own that the table hides: the route, then when and on
    // what, then what for — with the status and the km on the right.
    {
      // DataList keys cells by header: this phone-only title must not share the table's 'Route'.
      header: 'Trip',
      mobile: 'title',
      className: 'hidden',
      cell: (row) => (
        <span className="line-clamp-2">
          {shortPlace(row.from, 1) || row.from} → {shortPlace(row.to, 1) || row.to}
        </span>
      ),
    },
    { header: 'When', mobile: 'title', className: 'hidden', cell: (row) => `${whenLabel(row)} · ${row.vehicleNumber}${isOwnVehicle(row) ? ' · Own' : ''}` },
    {
      header: 'For',
      mobile: 'title',
      className: 'hidden',
      cell: (row) => (
        <span className="block">
          {row.purpose || '—'}
          {row.project ? ` · ${row.fleet?.projectCode || row.project}` : ''}
          {row.fleet && row.fleet.flagCodes.length > 0 && <TripFlagChips flags={row.fleet.flagCodes} className="mt-1" />}
          {row.own && row.own.flags.length > 0 && (
            <span className="mt-1 block">
              <FlagChips flags={row.own.flags} />
            </span>
          )}
        </span>
      ),
    },
    { header: 'State', mobile: 'aside', className: 'hidden', cell: (row) => <StatusOf row={row} /> },
    {
      header: 'Km',
      mobile: 'aside',
      className: 'hidden',
      cell: (row) => (
        <span className="block leading-tight">
          <span className="block text-base font-semibold tabular-nums text-slate-800">{formatKm(row.km)}</span>
          <span className="block text-[10px] text-muted-foreground">{row.own ? <Money value={row.own.totalAmount} /> : row.kmLabel}</span>
        </span>
      ),
    },
    {
      // Date, times and the vehicle in one column (two lines), and how long it ran on hover: the
      // table must fit the page beside the module sidebar with every distance in its own column.
      header: 'Date · vehicle',
      mobile: 'omit',
      cell: (row) => (
        <span className="block whitespace-nowrap" title={row.durationMinutes !== null ? durationLabel(row.durationMinutes) : undefined}>
          <span className="font-medium text-slate-800">{shortDateLabel(row.dateKey, today)}</span>
          {row.times && <span className="text-xs text-muted-foreground"> · {row.times}</span>}
          <span className="block text-xs font-medium text-slate-600">
            {row.vehicleNumber}
            <span className="font-normal text-muted-foreground"> · {kindLabel(row)}</span>
          </span>
        </span>
      ),
    },
    // From and To share a column (two lines), as do purpose and project: the table has to fit the
    // page beside the module sidebar on a laptop, with every distance still in a column of its own.
    {
      header: 'Route',
      mobile: 'omit',
      cell: (row) => (
        <span className="block">
          <Place value={row.from} />
          <Place value={row.to} muted />
        </span>
      ),
    },
    {
      header: 'Purpose',
      mobile: 'omit',
      cell: (row) => (
        <span className="block max-w-[10rem]">
          <span className="block truncate" title={row.purposeTitle || undefined}>
            {row.purpose || '—'}
          </span>
          <span className="block truncate text-xs text-muted-foreground" title={row.project || undefined}>
            {row.project || 'No project'}
          </span>
        </span>
      ),
    },
    {
      header: 'Status',
      mobile: 'omit',
      cell: (row) => (
        // One line of flags (or the claim) under the status, so the column (and the row) stays narrow.
        <span className="flex flex-col items-start gap-1">
          <StatusOf row={row} />
          {row.fleet && <FlagSummary flags={row.fleet.flagCodes} />}
          {row.own?.claimNumber && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{row.own.claimNumber}</span>}
        </span>
      ),
    },
    { header: 'GPS', align: 'right', mobile: 'omit', cell: (row) => <Distance km={row.gpsKm} /> },
    { header: 'Odo', align: 'right', mobile: 'omit', cell: (row) => <Distance km={row.odoKm} /> },
    {
      // Billed for a company trip; for an own trip, the distance claimed (and its amount on hover).
      header: 'Billed',
      align: 'right',
      mobile: 'omit',
      cell: (row) =>
        row.own ? (
          <span className="block leading-tight" title="Claimed — an own-vehicle trip is paid per km on a claim">
            <Distance km={row.km} strong />
            <Money value={row.own.totalAmount} className="block text-[11px] text-muted-foreground" />
          </span>
        ) : (
          <Distance km={row.fleet?.billableDistanceKm ?? null} strong />
        ),
    },
  ];

  return (
    <Card className="w-full" id="my-fleet-trips">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-slate-500" aria-hidden />
          {showAll ? 'All my trips' : 'Recent trips'}
          {rows.length > 0 && <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>}
        </CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          {onRefresh && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                onRefresh();
                if (showAll) void all.reload();
              }}
              disabled={busy}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} aria-hidden />
            </Button>
          )}
          {hasMore && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll((current) => !current)}>
              {showAll ? 'Show recent' : 'Show all'}
            </Button>
          )}
        </div>
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
            rows={rows}
            columns={columns}
            dense
            cardHref={(row) => row.href}
            onRowClick={(row) => router.push(row.href)}
            empty={
              <EmptyBlock icon={Route} title="No trips yet">
                Start a trip and it appears here once it ends.
              </EmptyBlock>
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
