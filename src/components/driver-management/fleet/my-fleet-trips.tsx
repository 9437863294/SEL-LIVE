'use client';

/**
 * The driver's own fleet trips, newest first: the last few from the bootstrap at once, everything
 * (GET trips?scope=mine) on request. A row is a link to the trip's detail — the route, the figures
 * and, when it waits for a manager, why.
 *
 * A plain list rather than a DataList: it is read on a phone, one trip per line, and a DataList
 * would mount every row twice for the desktop table nobody uses here.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, History, Loader2, Route } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { formatKm, type FleetTrip } from '@/lib/fleet/types';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { EmptyBlock } from '@/components/driver-management/trips/trip-ui';
import { tripRouteLabel } from './start-helpers';

function TripRow({ trip, today }: { trip: FleetTrip; today: string }) {
  const km = trip.billableDistanceKm ?? (trip.gpsDistanceKm || null);
  const route = tripRouteLabel(trip);
  return (
    <li>
      <Link href={`/driver-management/fleet/trips/${trip.id}`} className="flex min-w-0 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800">{route || trip.vehicleNumber}</span>
            <TripStatusBadge status={trip.status} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {route ? `${trip.vehicleNumber} · ` : ''}
            {shortDateLabel(trip.dateKey, today)} · {istTimeLabel(trip.startedAt)}
            {trip.endedAt ? `–${istTimeLabel(trip.endedAt)}` : ''} · {trip.purposeName}
            {trip.projectName ? ` · ${trip.projectName}` : ''}
          </span>
          {trip.flagCodes.length > 0 && <TripFlagChips flags={trip.flagCodes} className="mt-1" />}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-slate-800">{formatKm(km)}</span>
          <span className="block text-[10px] text-muted-foreground">{trip.billableDistanceKm !== null ? 'billed' : trip.status === 'cancelled' ? 'cancelled' : 'GPS'}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />
      </Link>
    </li>
  );
}

export function MyFleetTrips({ recent, today }: { recent: FleetTrip[]; today: string }) {
  const [showAll, setShowAll] = useState(false);
  const all = useFleetQuery<{ trips: FleetTrip[] }>(showAll ? 'trips?scope=mine' : null);
  const trips = showAll && all.data ? all.data.trips : recent;

  return (
    <Card className="w-full" id="my-fleet-trips">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-slate-500" aria-hidden />
          {showAll ? 'All my fleet trips' : 'Recent trips'}
        </CardTitle>
        {!showAll && recent.length > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show all
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {showAll && all.loading && !all.data ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading your trips…
          </p>
        ) : showAll && all.error && !all.data ? (
          <div className="flex flex-wrap items-center gap-2 px-4 py-4 text-sm text-rose-700">
            {all.error ?? 'Your trips could not be loaded.'}
            <Button type="button" size="sm" variant="outline" onClick={() => void all.reload()}>
              Try again
            </Button>
          </div>
        ) : trips.length ? (
          <ul className="divide-y divide-slate-100">
            {trips.map((trip) => (
              <TripRow key={trip.id} trip={trip} today={today} />
            ))}
          </ul>
        ) : (
          <div className="px-3 pb-2">
            <EmptyBlock icon={Route} title="No fleet trips yet">
              Drive & record a trip on a company vehicle and it appears here once it ends.
            </EmptyBlock>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
