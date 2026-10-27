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
 * Both measure the route the same way (the cleaned path through `summariseTrip`), so the figures
 * mean the same thing on either screen, and both draw the route live, fix by fix.
 *
 * Layout, phone first: a status line — the pulsing dot, the title, the time since the start — with
 * the purpose under it and the primary action (Stop & review) as a compact pill on the right, rather
 * than a full-width red bar that dominated the screen; then one panel with the distance large and
 * moving / stopped / fixes beside it; the badges and the short starting place; anything the caller
 * adds; and the live map, edge to edge in the card (no card inside the card).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import TripMapView from '@/components/vehicle-management/trip-map-view';
import { shortPlace } from '@/lib/fleet/places';
import type { TripLocationPoint } from '@/lib/vehicle-management';
import { cn } from '@/lib/utils';

export interface LiveRecordingFigures {
  distanceKm: number;
  movingMinutes: number;
  idleMinutes: number;
  fixes: number;
}

/** "42:10" or "1:42:10" since the start, ticking each second; its own component so only it re-renders. */
function Elapsed({ since }: { since: string }) {
  const start = Date.parse(since);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(start)) return null;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return <span className="tabular-nums text-muted-foreground">{h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-right">
      <p className="truncate text-sm font-semibold tabular-nums text-slate-800">{value}</p>
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

export function LiveRecordingCard({
  title = 'Recording',
  description,
  paused = false,
  startedAt,
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
  /** When the trip began (ISO), for the running time beside the title. */
  startedAt?: string | null;
  /** The primary action — Stop & review — drawn as a compact pill beside the title. */
  action: ReactNode;
  figures: LiveRecordingFigures;
  /** Badges beside the starting place (ownership, status, the tracking chip). */
  badges?: ReactNode;
  fromPlace?: string | null;
  points: TripLocationPoint[];
  mapTitle?: string;
  /** Extra content under the figures and above the map (controls, limit, arrivals). */
  children?: ReactNode;
  /** Below the map (links, a secondary action). */
  footer?: ReactNode;
  className?: string;
}) {
  const from = fromPlace ? shortPlace(fromPlace) || fromPlace : null;
  return (
    <Card className={cn('w-full overflow-hidden', className)}>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {!paused && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', paused ? 'bg-amber-500' : 'bg-emerald-500')} />
              </span>
              <span className="min-w-0 truncate">{title}</span>
              {startedAt && <Elapsed since={startedAt} />}
            </p>
            {description && <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">{description}</p>}
          </div>
          <div className="shrink-0">{action}</div>
        </div>

        <div className="flex items-end justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Distance</p>
            <p className="text-3xl font-semibold leading-none tabular-nums text-slate-900">
              {figures.distanceKm.toFixed(1)}
              <span className="ml-1 text-sm font-medium text-muted-foreground">km</span>
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-3 sm:gap-5">
            <Stat label="Moving" value={`${Math.round(figures.movingMinutes)} min`} />
            <Stat label="Stopped" value={`${Math.round(figures.idleMinutes)} min`} />
            <Stat label="Fixes" value={String(figures.fixes)} />
          </div>
        </div>

        {(badges || from) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {badges}
            {from && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={fromPlace ?? undefined}>
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">from {from}</span>
              </span>
            )}
          </div>
        )}

        {children}

        <TripMapView points={points} title={mapTitle} heightClassName="h-[240px] sm:h-[300px]" live bare />

        {footer}
      </CardContent>
    </Card>
  );
}
