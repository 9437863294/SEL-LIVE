'use client';

/**
 * The trip being driven, shown exactly as a My Trips GPS trip is while it records: the same card
 * (`LiveRecordingCard`), the same four tiles — distance, moving, stopped, fixes, worked out the same
 * way from the route — the starting place, and the route drawn live on the map, fix by fix. "Stop &
 * review" ends it, as it does a GPS trip.
 *
 * What a company vehicle adds sits under the tiles: pause and resume, the day's km against the
 * vehicle's limit, whether everything has reached the server, arrivals at sites, flags, and cancel
 * while the trip is young. The badge says what kind of trip it is — a company vehicle, billed to the
 * project, not claimable.
 *
 * The map draws this phone's own route. A phone that joined the trip late (a reinstall, another
 * phone) has none, so it falls back to the route the server has received, refreshed every minute.
 *
 * An end saved offline (`endedLocally`) stops the tracker at once and turns the card into a
 * "waiting to sync" notice: the trip is over for the driver even though the server has not heard.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Ban, CloudUpload, Flag, Loader2, LocateFixed, MapPin, Pause, Play, RefreshCw, Square, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useToast } from '@/hooks/use-toast';
import { istTimeLabel } from '@/lib/fleet/dates';
import type { FleetTrip } from '@/lib/fleet/types';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import type { TripDetail } from '@/lib/fleet/server/trips';
import { cleanTripPath, summariseTrip, type TripLocationPoint } from '@/lib/vehicle-management';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { flushQueue, useQueueStatus } from '@/components/fleet/offline-queue';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { useTripTracker } from '@/components/fleet/use-trip-tracker';
import { SyncingLabel, TripTrackingChip } from '@/components/driver-management/tracking/tracking-status-chip';
import { useTrackingReadiness } from '@/components/driver-management/tracking/tracking-readiness';
import { KmLimitMeter, TripFlagChips, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { cn } from '@/lib/utils';
import { LiveRecordingCard, type LiveRecordingFigures } from '../live-recording-card';
import { EndTripDialog, type EndOutcome } from './end-trip-dialog';
import { useNowMs, vehicleOf } from './start-helpers';

/** A trip may be withdrawn in its first quarter of an hour (the server has the last word). */
const CANCEL_WINDOW_MINUTES = 15;
const ROUTE_REFRESH_MS = 60_000;

export function ActiveTrip({
  trip,
  bootstrap,
  endedLocally,
  onChanged,
  onEnded,
}: {
  trip: FleetTrip;
  bootstrap: FleetBootstrap;
  /** The driver ended it on this phone and the end is waiting in the queue. */
  endedLocally: boolean;
  onChanged: () => void;
  onEnded: (outcome: EndOutcome) => void;
}) {
  const { toast } = useToast();
  const readiness = useTrackingReadiness();
  const tracker = useTripTracker(endedLocally ? null : trip, bootstrap.geofences, { onLongGap: readiness.showGuideAfterGap });
  const queue = useQueueStatus();
  /** Stop & review was pressed: the native recorder's buffer is being moved to the outbox first. */
  const [syncing, setSyncing] = useState(false);
  const hasLocalRoute = tracker.path.length > 0;
  // The server's copy of the route, only when this phone has none of its own.
  const route = useFleetQuery<TripDetail>(hasLocalRoute || endedLocally ? null : `trips/${trip.id}`);
  const nowMs = useNowMs(30_000);
  const [endOpen, setEndOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'cancel' | 'sync'>(null);

  // The fallback route, refreshed while the trip runs. The reload happens in the timer's callback.
  const reloadRoute = route.reload;
  useEffect(() => {
    if (hasLocalRoute || endedLocally) return undefined;
    const timer = window.setInterval(() => void reloadRoute(), ROUTE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reloadRoute, hasLocalRoute, endedLocally]);

  const serverPoints = useMemo<TripLocationPoint[]>(
    () =>
      (route.data?.points ?? []).map((point) => ({
        lat: point.lat,
        lng: point.lng,
        accuracyMeters: point.accuracyM ?? undefined,
        speedKmph: point.speedKmph ?? undefined,
        recordedAtIso: point.at,
      })),
    [route.data],
  );
  const serverSummary = useMemo(() => (serverPoints.length ? summariseTrip(cleanTripPath(serverPoints).points) : null), [serverPoints]);

  const vehicle = vehicleOf(bootstrap, trip.vehicleId);
  const paused = trip.status === 'paused';
  const elapsedMinutes = Math.max(0, (nowMs - Date.parse(trip.startedAt)) / 60_000);
  const canCancel = !endedLocally && elapsedMinutes <= CANCEL_WINDOW_MINUTES;

  // The GPS trip's tiles. Distance is the larger of this phone's figure and the server's, so a phone
  // that joined late does not show less than has been driven.
  const measured = hasLocalRoute ? tracker.summary : serverSummary;
  const figures: LiveRecordingFigures = {
    distanceKm: Math.max(measured?.distanceKm ?? 0, trip.gpsDistanceKm),
    movingMinutes: measured?.movingMinutes ?? 0,
    idleMinutes: measured?.idleMinutes ?? 0,
    fixes: Math.max(tracker.fixes, trip.pointCount, hasLocalRoute ? tracker.path.length : serverPoints.length),
  };
  const startPoint: TripLocationPoint[] = trip.startLat !== null && trip.startLng !== null ? [{ lat: trip.startLat, lng: trip.startLng, recordedAtIso: trip.startedAt }] : [];
  const points = hasLocalRoute ? tracker.path : serverPoints.length ? serverPoints : startPoint;
  const last = points[points.length - 1];
  const lastPoint = last ? { lat: last.lat, lng: last.lng } : trip.lastPointLat !== null && trip.lastPointLng !== null ? { lat: trip.lastPointLat, lng: trip.lastPointLng } : null;

  async function change(action: 'pause' | 'resume' | 'cancel') {
    setBusy(action);
    try {
      await fleetFetch<{ trip: FleetTrip }>(`trips/${trip.id}/state`, { method: 'POST', body: { action, reason: action === 'cancel' ? cancelReason.trim() || 'Started by mistake' : '', at: new Date().toISOString() } });
      // A cancelled trip records nothing more (pausing stops the recorder in the tracker itself).
      if (action === 'cancel') void tracker.finish();
      toast({ title: action === 'pause' ? 'Trip paused' : action === 'resume' ? 'Recording again' : 'Trip cancelled', description: action === 'cancel' ? 'The vehicle is free again.' : undefined });
      onChanged();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not changed', description: fleetErrorMessage(error) });
      throw error;
    } finally {
      setBusy(null);
    }
  }

  /** The end is reviewed only once everything the phone recorded is in the outbox. */
  async function openEnd() {
    if (tracker.native) {
      setSyncing(true);
      try {
        await tracker.flush();
      } finally {
        setSyncing(false);
      }
    }
    setEndOpen(true);
  }

  async function syncNow() {
    setBusy('sync');
    try {
      await flushQueue();
      onChanged();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not synced yet', description: fleetErrorMessage(error, 'Still no connection — it will keep trying.') });
    } finally {
      setBusy(null);
    }
  }

  if (endedLocally) {
    return (
      <Card className="w-full border-amber-200 bg-amber-50/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-amber-900">
            <CloudUpload className="h-4 w-4" aria-hidden />
            Finishing trip — waiting for network
          </CardTitle>
          <CardDescription className="text-amber-900/80">
            {trip.vehicleNumber}: the end, its photo and {queue.pending ? `${queue.pending} queued item${queue.pending === 1 ? '' : 's'}` : 'the route'} are saved on this phone and go to the server when there is a connection.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void syncNow()} disabled={busy === 'sync'}>
            {busy === 'sync' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
            Sync now
          </Button>
          {!queue.online && (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-900">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Offline
            </span>
          )}
          {queue.lastError && <span className="min-w-0 break-words text-xs text-rose-700">{queue.lastError}</span>}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <LiveRecordingCard
        title={paused ? 'Paused' : 'Recording'}
        paused={paused}
        startedAt={trip.startedAt}
        description={
          <>
            {trip.vehicleNumber} · {trip.purposeName}
            {trip.purposeReason ? ` — ${trip.purposeReason}` : ''}
            {trip.projectName ? ` · ${trip.projectCode ? `${trip.projectCode} ` : ''}${trip.projectName}` : ''}
          </>
        }
        action={
          // A compact pill beside the title (the card's layout), not a full-width bar.
          <Button type="button" variant="destructive" size="sm" className="rounded-full px-4" onClick={() => void openEnd()} disabled={Boolean(busy) || syncing}>
            {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Square className="mr-1.5 h-4 w-4" aria-hidden />}
            <SyncingLabel tripId={tracker.native ? trip.id : null} active={syncing} idle="Stop & review" />
          </Button>
        }
        figures={figures}
        badges={
          <>
            <Badge variant="outline">Company vehicle · not claimable</Badge>
            {paused && <TripStatusBadge status={trip.status} />}
            <TripTrackingChip
              tripId={tracker.native ? trip.id : null}
              paused={paused}
              outboxPending={queue.pending}
              fallback={{ tracking: tracker.tracking, error: tracker.error, lastFixAt: tracker.lastFixAt ? Date.parse(tracker.lastFixAt) : null, accuracyM: tracker.accuracyM, startedAt: Date.parse(trip.startedAt) || null }}
              onFix={readiness.openGate}
            />
          </>
        }
        fromPlace={trip.startPlace || trip.startGeofenceName || null}
        points={points}
        mapTitle={hasLocalRoute ? 'Live route' : 'Route received'}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/driver-management/fleet/trips/${trip.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <LocateFixed className="h-3.5 w-3.5" aria-hidden />
              Trip details
            </Link>
            {canCancel && (
              <Button type="button" variant="ghost" size="sm" className="text-rose-700 hover:text-rose-800" onClick={() => setCancelOpen(true)} disabled={Boolean(busy)}>
                <Ban className="mr-1.5 h-4 w-4" aria-hidden />
                Cancel trip
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void change(paused ? 'resume' : 'pause').catch(() => undefined)} disabled={Boolean(busy)}>
            {busy === 'pause' || busy === 'resume' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : paused ? <Play className="mr-1.5 h-4 w-4" aria-hidden /> : <Pause className="mr-1.5 h-4 w-4" aria-hidden />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <span className="text-xs text-muted-foreground">
            since {istTimeLabel(trip.startedAt)}
            {tracker.accuracyM ? ` · ±${Math.round(tracker.accuracyM)} m` : ''}
          </span>
        </div>

        {paused && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            Paused since {istTimeLabel(trip.pausedAt)}. The trip stays open on {trip.vehicleNumber}; resume when you drive on, or stop and review it.
          </p>
        )}
        {tracker.error && (
          <p className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              {tracker.error} Keep location set to “Allow all the time” and battery optimisation off for the SEL Driver app, or the route will have gaps.
            </span>
          </p>
        )}

        {vehicle && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <KmLimitMeter usedKm={vehicle.usedTodayKm} allowedKm={vehicle.allowedTodayKm} limitKm={vehicle.dailyKmLimit} compact />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={cn('inline-flex items-center gap-1.5', queue.online ? 'text-slate-600' : 'font-medium text-amber-700')}>
            {queue.online ? <CloudUpload className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
            {queue.online ? (queue.pending ? `${queue.pending} waiting to send${queue.flushing ? ' — sending…' : ''}` : 'All sent') : `Offline — ${queue.pending} saved on the phone`}
          </span>
          {queue.lastError && queue.online && <span className="min-w-0 break-words text-rose-700">{queue.lastError}</span>}
          {trip.flagCodes.length > 0 && <TripFlagChips flags={trip.flagCodes} />}
        </div>

        {Boolean(tracker.insideNames.length || tracker.arrivals.length) && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
            {tracker.insideNames.length ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-800">
                <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">At {tracker.insideNames.join(', ')}</span>
              </p>
            ) : null}
            {tracker.arrivals.length ? (
              <ul className="mt-1.5 space-y-1">
                {tracker.arrivals
                  .slice(-6)
                  .reverse()
                  .map((event, index) => (
                    <li key={`${event.geofenceId}-${event.at}-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
                      <Flag className={cn('h-3 w-3 shrink-0', event.type === 'enter' ? 'text-emerald-600' : 'text-slate-400')} aria-hidden />
                      <span className="shrink-0 tabular-nums">{istTimeLabel(event.at)}</span>
                      <span className="min-w-0 truncate">
                        {event.type === 'enter' ? 'Arrived at' : 'Left'} {event.geofenceName}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        )}
      </LiveRecordingCard>

      {endOpen && (
        <EndTripDialog
          open
          onOpenChange={setEndOpen}
          trip={trip}
          figures={figures}
          lastPoint={lastPoint}
          // Before the end goes: everything the native recorder holds, into the outbox ahead of it.
          prepareEnd={tracker.flush}
          onEnded={(outcome) => {
            // Ended, queued or already over: the recorder stops (a refused end leaves it recording).
            void tracker.finish();
            setEndOpen(false);
            onEnded(outcome);
          }}
        />
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this trip?"
        description="Only for a trip started by mistake. It is withdrawn, the vehicle is freed, and an approval it used is good again today."
        confirmLabel="Cancel trip"
        cancelLabel="Keep it"
        destructive
        loading={busy === 'cancel'}
        onConfirm={() => change('cancel')}
      >
        <Input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={300} placeholder="Why? (optional)" className="bg-white" aria-label="Why the trip is cancelled" />
      </ConfirmDialog>
    </>
  );
}
