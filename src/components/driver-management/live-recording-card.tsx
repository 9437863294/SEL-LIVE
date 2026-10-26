'use client';

/**
 * The card a trip shows while it is being driven — one card for both kinds of trip, so they cannot
 * drift apart:
 *
 * - **Fleet Trip › Own vehicle** (gps-trip-recorder.tsx): an employee's own-vehicle journey,
 *   reviewed when it stops and claimed from My Trips.
 * - **Fleet Trip** (driver-management/fleet/active-trip.tsx): a company vehicle, billed to the
 *   project and not claimable, with the daily limit and the odometer photos on top.
 *
 * Both measure the route the same way (the cleaned path through `summariseTrip`), so the four tiles
 * mean the same thing on either screen, and both draw the route live, fix by fix.
 *
 * Layout: title and description, the primary action (full width on a phone, where a button beside
 * the title leaves neither room), the tiles (two across on a phone — four columns of 90 px wrap
 * every number), badges and the starting place, anything the caller adds, then the live map.
 */

import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import TripMapView from '@/components/vehicle-management/trip-map-view';
import type { TripLocationPoint } from '@/lib/vehicle-management';
import { cn } from '@/lib/utils';

export interface LiveRecordingFigures {
  distanceKm: number;
  movingMinutes: number;
  idleMinutes: number;
  fixes: number;
}

export function LiveRecordingCard({
  title = 'Recording a trip',
  description,
  paused = false,
  action,
  figures,
  badges,
  fromPlace,
  points,
  mapTitle = 'Live route',
  children,
  footer,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** A paused trip: the dot stops pulsing and turns amber. */
  paused?: boolean;
  /** The primary action — Stop & review. */
  action: ReactNode;
  figures: LiveRecordingFigures;
  /** Badges beside the starting place (ownership, status). */
  badges?: ReactNode;
  fromPlace?: string | null;
  points: TripLocationPoint[];
  mapTitle?: string;
  /** Extra content under the tiles and above the map (controls, limit, arrivals). */
  children?: ReactNode;
  /** Below the map (links, a secondary action). */
  footer?: ReactNode;
  className?: string;
}) {
  const tiles = [
    { label: 'Distance', value: `${figures.distanceKm.toFixed(1)} km` },
    { label: 'Moving', value: `${Math.round(figures.movingMinutes)} min` },
    { label: 'Stopped', value: `${Math.round(figures.idleMinutes)} min` },
    { label: 'Fixes', value: String(figures.fixes) },
  ];
  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="gap-2 pb-2 sm:flex sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-1.5 text-base">
            <span className="relative flex h-2 w-2 shrink-0">
              {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', paused ? 'bg-amber-500' : 'bg-emerald-500')} />
            </span>
            <span className="min-w-0 break-words">{title}</span>
          </CardTitle>
          {description && <CardDescription className="break-words">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="rounded-xl border border-white/70 bg-white/80 p-2.5">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-800">{tile.value}</p>
            </div>
          ))}
        </div>

        {(badges || fromPlace) && (
          <div className="flex flex-wrap items-start gap-1.5 text-xs text-muted-foreground">
            {badges}
            {fromPlace && (
              // `min-w-0` with the wrap above: a full street address is long, and without it the
              // address forced the card wider than the phone.
              <span className="min-w-0 break-words">from {fromPlace}</span>
            )}
          </div>
        )}

        {children}

        <TripMapView points={points} title={mapTitle} heightClassName="h-[260px] sm:h-[300px]" live />

        {footer}
      </CardContent>
    </Card>
  );
}
