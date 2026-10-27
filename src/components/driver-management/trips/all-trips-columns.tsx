'use client';

/**
 * All Trips' register columns: the desktop table, and a phone card of its own (as My Trips has —
 * my-trips-columns.tsx).
 *
 * The phone card reads like a line of a list: the employee, the route in short place names, then
 * when and on what, then what for — with the amount, its km and the status on the right. The
 * labelled-field card it replaced printed two postal addresses in full and squeezed the purpose into
 * a one-letter column. The phone columns are hidden in the table, and the table's are omitted from
 * the card. Every header is distinct (DataList keys cells by header).
 */

import { LocateFixed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ListColumn } from '@/components/shared/data-list';
import { shortPlace } from '@/lib/fleet/places';
import { formatKm, type TripRecord } from '@/lib/employee-trips/types';
import { Km, Money, TripStatusBadge, VehicleLabel, shortDate } from './trip-ui';

/** The place in a word or two ("Bhambra filling station"), the full address kept for the tooltip. */
const placeOf = (address: string) => shortPlace(address, 1) || address;

/** "Measured by GPS", with the measurement on hover. */
export function GpsTag({ trip }: { trip: TripRecord }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-sky-200 bg-sky-50 px-1.5 py-0 text-[10px] text-sky-700"
      title={trip.gps ? `Measured by GPS: ${trip.gps.measuredKm} km over ${trip.gps.fixes} fixes.` : 'Measured by GPS.'}
    >
      <LocateFixed className="h-3 w-3" aria-hidden />
      GPS
    </Badge>
  );
}

export function allTripColumns(): ListColumn<TripRecord>[] {
  return [
    /* ── the phone card ── */
    { header: 'Who', mobile: 'title', className: 'hidden', cell: (trip) => <span className="font-semibold text-slate-800">{trip.employeeName || trip.employeeId}</span> },
    {
      header: 'Route',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="line-clamp-2 text-sm text-slate-700" title={`${trip.fromPlace} → ${trip.toPlace}`}>
          {placeOf(trip.fromPlace)} → {placeOf(trip.toPlace)}
        </span>
      ),
    },
    {
      header: 'When',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        // One run of text (date and vehicle number) so a narrow card never ends a line on a "·".
        <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{`${shortDate(trip.tripDate)} · ${trip.vehicleNumber}`}</span>
          {trip.source === 'gps' && <GpsTag trip={trip} />}
        </span>
      ),
    },
    {
      header: 'For',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => <span className="block text-xs text-muted-foreground">{[trip.purpose, trip.projectName, trip.claimNumber].filter(Boolean).join(' · ') || '—'}</span>,
    },
    {
      header: 'Money',
      mobile: 'aside',
      className: 'hidden',
      cell: (trip) => (
        <span className="block text-right leading-tight">
          <Money value={trip.totalAmount} className="block text-base font-semibold tabular-nums text-slate-800" />
          <span className="block text-[11px] text-muted-foreground">{formatKm(trip.distanceKm)}</span>
        </span>
      ),
    },
    { header: 'State', mobile: 'aside', className: 'hidden', cell: (trip) => <TripStatusBadge status={trip.status} /> },

    /* ── the desktop table ── */
    { header: 'Employee', mobile: 'omit', cell: (trip) => <span className="font-medium text-slate-800">{trip.employeeName || trip.employeeId}</span> },
    {
      header: 'Trip',
      mobile: 'omit',
      // Two lines — the route, then what for (purpose · project) — so the table fits beside the
      // module sidebar without a Project column of its own.
      cell: (trip) => (
        <span className="block min-w-0 max-w-[18rem]" title={`${trip.fromPlace} → ${trip.toPlace}`}>
          <span className="block truncate text-slate-700">
            {placeOf(trip.fromPlace)} → {placeOf(trip.toPlace)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{[trip.purpose, trip.projectName].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    { header: 'Date', mobile: 'omit', cell: (trip) => <span className="whitespace-nowrap">{shortDate(trip.tripDate)}</span> },
    {
      header: 'Vehicle',
      mobile: 'omit',
      cell: (trip) => <VehicleLabel ownership={trip.ownership} vehicleNumber={trip.vehicleNumber} vehicleType={trip.vehicleType} />,
    },
    {
      header: 'Distance',
      mobile: 'omit',
      align: 'right',
      cell: (trip) => (
        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
          <Km value={trip.distanceKm} />
          {trip.source === 'gps' && <GpsTag trip={trip} />}
        </span>
      ),
    },
    { header: 'Amount', mobile: 'omit', align: 'right', cell: (trip) => <Money value={trip.totalAmount} /> },
    // The claim number under the status, as My Trips shows it — one column fewer, so the table fits
    // beside the module sidebar.
    {
      header: 'Status',
      mobile: 'omit',
      cell: (trip) => (
        <span className="flex flex-col items-start gap-0.5">
          <TripStatusBadge status={trip.status} />
          {trip.claimNumber && <span className="whitespace-nowrap text-[11px] text-muted-foreground">{trip.claimNumber}</span>}
        </span>
      ),
    },
  ];
}
