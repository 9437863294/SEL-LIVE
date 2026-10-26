'use client';

/**
 * My Trips' register columns: the desktop table, and a phone card of its own.
 *
 * On a desktop each trip is one line — route and purpose, date, vehicle, distance, amount, status,
 * actions. On a phone the same trip is a card that reads like a line of a list rather than a form of
 * labelled fields: the route in short place names, then when and on what, then what for (with any
 * flags); on the right the amount with its km, and the status with the claim number. The phone
 * columns are their own and the table hides them, as the table's columns are omitted from the card —
 * the two layouts want different things from the same trip.
 *
 * DataList keys cells by header, so every header here is distinct. Every cell is plain text, badges
 * and buttons, which DataList's double mounting (a card and a row per trip) is safe with.
 */

import { LocateFixed, Pencil, ReceiptText, Trash2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CellLink, type ListColumn } from '@/components/shared/data-list';
import { shortPlace } from '@/lib/fleet/places';
import { daysLeftToClaim } from '@/lib/employee-trips/trips';
import { formatKm, type TripRecord, type TripRules } from '@/lib/employee-trips/types';
import { FlagChips, Km, Money, TripStatusBadge, VehicleLabel, shortDate } from './trip-ui';

export interface MyTripColumnsArgs {
  rules: TripRules | undefined;
  today: string;
  claimable: (trip: TripRecord) => boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string, on: boolean) => void;
  openClaim: (tripIds: string[]) => void;
  onEdit: (trip: TripRecord) => void;
  onDelete: (trip: TripRecord) => void;
}

/** What the trip is worth now: the approved amount once decided, else the claimed one. */
const amountOf = (trip: TripRecord) => (trip.decision ? trip.decision.approvedAmount : trip.totalAmount);

/** The claim-window warning for an unclaimed trip, or null. */
function windowNote(trip: TripRecord, rules: TripRules | undefined, today: string) {
  const left = rules && trip.status === 'draft' ? daysLeftToClaim(trip.tripDate, today, rules) : null;
  if (left === null) return null;
  if (left < 0) return <span className="text-[11px] font-medium text-rose-700">Claim window closed</span>;
  if (left <= 7) return <span className="text-[11px] font-medium text-amber-700">Claim within {left} day{left === 1 ? '' : 's'}</span>;
  return null;
}

export function myTripColumns({ rules, today, claimable, selected, toggle, openClaim, onEdit, onDelete }: MyTripColumnsArgs): ListColumn<TripRecord>[] {
  return [
    {
      header: 'Select',
      mobile: 'omit',
      className: 'w-10',
      cell: (trip) => (claimable(trip) ? <Checkbox checked={selected.has(trip.id)} onCheckedChange={(value) => toggle(trip.id, value === true)} aria-label={`Select trip on ${shortDate(trip.tripDate)}`} /> : null),
    },

    /* ── the phone card (hidden in the table) ── */
    {
      header: 'Route',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="block">
          <span className="line-clamp-2">
            {shortPlace(trip.fromPlace, 1) || trip.fromPlace} → {shortPlace(trip.toPlace, 1) || trip.toPlace}
          </span>
          {trip.status === 'draft' && trip.returnNote && (
            <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <Undo2 className="h-3 w-3" aria-hidden />
              Sent back: {trip.returnNote.remarks}
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'When',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <span>{shortDate(trip.tripDate)}</span>
          <span aria-hidden>·</span>
          <span>{trip.vehicleNumber}</span>
          {trip.source === 'gps' && (
            <span className="inline-flex items-center gap-0.5 text-sky-700" title="Measured by GPS">
              <LocateFixed className="h-3 w-3" aria-hidden />
              GPS
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'For',
      mobile: 'title',
      className: 'hidden',
      cell: (trip) => (
        <span className="block">
          {trip.purpose || '—'}
          {trip.projectName ? ` · ${trip.projectName}` : ''}
          {trip.flags.length > 0 && (
            <span className="mt-1 block">
              <FlagChips flags={trip.flags} />
            </span>
          )}
        </span>
      ),
    },
    {
      header: 'Money',
      mobile: 'aside',
      className: 'hidden',
      cell: (trip) => (
        <span className="block leading-tight">
          <Money value={amountOf(trip)} className="block text-base font-semibold tabular-nums text-slate-800" />
          <span className="block text-[11px] text-muted-foreground">{formatKm(trip.distanceKm)}</span>
        </span>
      ),
    },
    {
      header: 'State',
      mobile: 'aside',
      className: 'hidden',
      cell: (trip) => (
        <span className="flex flex-col items-end gap-1">
          <TripStatusBadge status={trip.status} />
          {trip.claimId && trip.claimNumber && (
            <CellLink href={`/driver-management/claims/${trip.claimId}`} className="text-[11px] font-medium text-primary">
              {trip.claimNumber}
            </CellLink>
          )}
          {windowNote(trip, rules, today)}
        </span>
      ),
    },

    /* ── the desktop table (omitted from the card) ── */
    {
      header: 'Trip',
      mobile: 'omit',
      cell: (trip) => (
        // Short place names (the full addresses on hover): a reverse-geocoded address is a line on its
        // own, and two of them pushed Status and the actions off the side of the table.
        <span className="flex min-w-0 max-w-[24rem] items-center gap-1.5 sm:whitespace-nowrap" title={`${trip.fromPlace} → ${trip.toPlace} · ${trip.purpose}`}>
          <span className="truncate font-medium text-slate-800">
            {shortPlace(trip.fromPlace) || trip.fromPlace} → {shortPlace(trip.toPlace) || trip.toPlace}
          </span>
          {trip.purpose && <span className="truncate text-xs text-muted-foreground">· {trip.purpose}</span>}
          {trip.status === 'draft' && trip.returnNote && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700" title={`Sent back: ${trip.returnNote.remarks}`}>
              <Undo2 className="h-3 w-3" aria-hidden />
              Sent back
            </span>
          )}
        </span>
      ),
    },
    { header: 'Date', mobile: 'omit', cell: (trip) => <span className="whitespace-nowrap">{shortDate(trip.tripDate)}</span> },
    { header: 'Vehicle', mobile: 'omit', cell: (trip) => <VehicleLabel inline ownership={trip.ownership} vehicleNumber={trip.vehicleNumber} vehicleType={trip.vehicleType} /> },
    {
      header: 'Distance',
      align: 'right',
      mobile: 'omit',
      /*
        A measured distance and a typed one are both just a number in this column, and they are
        not the same evidence — which is the whole reason `source` and the GPS block are stored.
        Shown here rather than only to the approver: the employee should see which of their trips
        carry a measurement before they put them on a claim.
      */
      cell: (trip) => (
        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
          <Km value={trip.distanceKm} className="whitespace-nowrap" />
          {trip.source === 'gps' && (
            <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-[10px] text-sky-700" title={trip.gps ? `Measured by GPS: ${trip.gps.measuredKm} km from ${trip.gps.fixes} fixes.` : 'Measured by GPS.'}>
              <LocateFixed className="h-3 w-3" aria-hidden />
              GPS
            </Badge>
          )}
        </span>
      ),
    },
    {
      header: 'Amount',
      align: 'right',
      mobile: 'omit',
      cell: (trip) => {
        const cut = trip.decision && trip.decision.approvedAmount !== trip.totalAmount;
        return (
          <span className="inline-flex items-baseline justify-end gap-1.5 whitespace-nowrap">
            <Money value={amountOf(trip)} className="font-medium" />
            <span className="text-[11px] text-muted-foreground">
              {cut ? (
                <>
                  of <Money value={trip.totalAmount} />
                </>
              ) : trip.ratePerKm !== null ? (
                `@ ₹${trip.ratePerKm}/km`
              ) : (
                'no rate'
              )}
            </span>
          </span>
        );
      },
    },
    {
      header: 'Status',
      mobile: 'omit',
      cell: (trip) => (
        <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
          <TripStatusBadge status={trip.status} />
          {trip.claimId && trip.claimNumber && (
            <CellLink href={`/driver-management/claims/${trip.claimId}`} className="text-[11px] font-medium text-primary hover:underline">
              {trip.claimNumber}
            </CellLink>
          )}
          {windowNote(trip, rules, today)}
          <FlagChips flags={trip.flags} className="flex-nowrap" />
        </div>
      ),
    },

    /* ── both: what can still be done with an unclaimed trip ── */
    {
      header: 'Actions',
      mobile: 'footer',
      cell: (trip) =>
        trip.status === 'draft' ? (
          <div className="flex items-center gap-1.5">
            {claimable(trip) && (
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm sm:hidden">
                <Checkbox checked={selected.has(trip.id)} onCheckedChange={(value) => toggle(trip.id, value === true)} aria-label={`Select trip on ${shortDate(trip.tripDate)}`} />
                Select
              </label>
            )}
            {claimable(trip) && (
              <Button type="button" variant="outline" size="sm" onClick={() => openClaim([trip.id])} title="Create a claim for this trip" className="border-primary/40 text-primary hover:text-primary">
                <ReceiptText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Claim
              </Button>
            )}
            {/* Icons only, phone and desktop alike: with Select and Claim beside them, labelled Edit and
                Delete wrapped a phone card's actions onto a second row. */}
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(trip)} aria-label="Edit trip" title="Edit trip">
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onDelete(trip)} aria-label="Delete trip" title="Delete trip" className="text-rose-600 hover:text-rose-700">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        ) : null,
    },
  ];
}
