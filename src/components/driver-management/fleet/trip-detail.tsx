'use client';

/**
 * One fleet trip, in full: the route on a map, the three distances (GPS, odometer, billed) and
 * which one was billed and why, where the vehicle stopped and arrived, the odometer photos, every
 * flag with what it means, and how a review was settled.
 *
 * The same page serves the driver (their own trip) and whoever manages it (the vehicle's approver,
 * the driver's reporting authority, the fleet office). What the viewer may do — review, close,
 * resolve — comes from the server (`abilities`); nobody is offered an action on their own trip.
 */

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, Clock, Flag, Gauge, Hourglass, Lock, MapPin, Route, ShieldAlert, Siren } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { durationLabel, istDateKey, istTimeLabel, shortDateLabel } from '@/lib/fleet/dates';
import { COST_BASIS_LABELS, GEOFENCE_KIND_LABELS, TRIP_FLAG_HINTS, TRIP_FLAG_LABELS, formatINR, formatKm, type BillableSource, type FleetTrip } from '@/lib/fleet/types';
import type { TripDetail } from '@/lib/fleet/server/trips';
import { useFleetQuery } from '@/components/fleet/use-fleet-query';
import { FleetTripMap } from '@/components/fleet/fleet-maps';
import { FleetPhoto, TripStatusBadge } from '@/components/fleet/fleet-ui';
import { ErrorBlock, LoadingBlock } from '@/components/driver-management/trips/trip-ui';
import { cn } from '@/lib/utils';
import { ForceCloseDialog, ResolveExceptionDialog, ReviewTripDialog } from './review-dialogs';
import { tripRouteLabel } from './start-helpers';

const SOURCE_LABELS: Record<BillableSource, string> = { odometer: 'Odometer', gps: 'GPS', manager: 'Set by the manager' };
const ENDED_BY_LABELS: Record<NonNullable<FleetTrip['endedBy']>, string> = {
  driver: 'Ended by the driver',
  auto_idle: 'Closed by the system — no location for too long',
  auto_max: 'Closed by the system — ran past the longest a trip may run',
  force: 'Closed by a manager',
};

function Section({ title, icon: Icon, children, className }: { title: string; icon: React.ComponentType<{ className?: string }>; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('w-full min-w-0', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-slate-500" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className={cn('min-w-0 rounded-xl border p-2.5', tone === 'warn' ? 'border-amber-200 bg-amber-50' : tone === 'good' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums text-slate-800">{value}</p>
      {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex min-w-0 items-start justify-between gap-3 py-1.5 text-sm">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="min-w-0 break-words text-right text-slate-800">{children}</span>
  </div>
);

export default function TripDetailView({ tripId }: { tripId: string }) {
  const query = useFleetQuery<TripDetail>(tripId ? `trips/${tripId}` : null);
  const [dialog, setDialog] = useState<null | 'review' | 'close' | 'resolve'>(null);

  if (query.loading && !query.data) return <LoadingBlock />;
  if (!query.data) return <ErrorBlock message={query.error ?? 'This trip could not be loaded.'} onRetry={() => void query.reload()} />;

  const { trip, abilities, points, deviceEvents, photos } = query.data;
  const open = trip.status === 'running' || trip.status === 'paused';
  const synced = points.map((point) => ({ lat: point.lat, lng: point.lng, at: point.at }));
  const route = synced.length || trip.startLat === null || trip.startLng === null ? synced : [{ lat: trip.startLat, lng: trip.startLng, at: trip.startedAt }];
  const routeLabel = tripRouteLabel(trip);
  const durationMinutes = trip.endedAt ? (Date.parse(trip.endedAt) - Date.parse(trip.startedAt)) / 60_000 : null;
  const days = Object.entries(trip.kmByDate).sort(([a], [b]) => a.localeCompare(b));
  const events = trip.geofenceEvents.length ? trip.geofenceEvents.map((event) => ({ type: event.type, geofenceName: event.geofenceName, at: event.at, source: 'server' as const })) : deviceEvents.map((event) => ({ ...event, source: 'device' as const }));
  const refreshed = () => {
    setDialog(null);
    query.reload();
  };

  const actions = (
    <>
      {abilities.review && (
        <Button type="button" onClick={() => setDialog('review')}>
          <ClipboardCheck className="mr-2 h-4 w-4" aria-hidden />
          Review
        </Button>
      )}
      {abilities.resolve && (
        <Button type="button" variant="outline" onClick={() => setDialog('resolve')}>
          <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
          Resolve
        </Button>
      )}
      {abilities.forceClose && (
        <Button type="button" variant="outline" onClick={() => setDialog('close')}>
          <Lock className="mr-2 h-4 w-4" aria-hidden />
          Close trip
        </Button>
      )}
      {open && abilities.end && (
        <Button type="button" variant="outline" asChild>
          <Link href="/driver-management/fleet">
            <Route className="mr-2 h-4 w-4" aria-hidden />
            Back to the trip
          </Link>
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${trip.vehicleNumber} · ${shortDateLabel(trip.dateKey)}`}
        description={`${trip.driverName} · ${trip.purposeName}${trip.purposeReason ? ` — ${trip.purposeReason}` : ''}${trip.projectName ? ` · ${trip.projectCode ? `${trip.projectCode} ` : ''}${trip.projectName}` : ''}`}
        icon={Route}
        backHref="/driver-management/fleet"
        badge={<TripStatusBadge status={trip.status} />}
        actions={actions}
      />

      {trip.status === 'pending_review' && trip.review && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">Waiting for a manager to settle the distance</p>
            <p className="break-words text-xs">{trip.review.reason}</p>
          </div>
        </div>
      )}
      {trip.review?.status === 'resolved' && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">
              Reviewed by {trip.review.byName}: {formatKm(trip.review.km)} billed ({trip.review.choice ? SOURCE_LABELS[trip.review.choice] : '—'})
            </p>
            {trip.review.note && <p className="break-words text-xs">{trip.review.note}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Figure label="GPS" value={formatKm(trip.gpsDistanceKm)} hint={`${trip.pointCount} fixes${trip.gapCount ? ` · ${trip.gapCount} gap${trip.gapCount === 1 ? '' : 's'}` : ''}`} />
        <Figure label="Odometer" value={formatKm(trip.odoDistanceKm)} hint={`${Math.round(trip.startOdometer.km).toLocaleString('en-IN')} → ${trip.endOdometer ? Math.round(trip.endOdometer.km).toLocaleString('en-IN') : '…'}`} />
        <Figure
          label="Billed"
          value={formatKm(trip.billableDistanceKm)}
          hint={trip.billableSource ? SOURCE_LABELS[trip.billableSource] : open ? 'when it ends' : 'not settled'}
          tone={trip.billableDistanceKm !== null ? 'good' : trip.status === 'pending_review' ? 'warn' : undefined}
        />
        <Figure
          label="Cost"
          value={trip.costSnapshot ? (trip.costSnapshot.basis === 'per_km' ? formatINR(trip.costSnapshot.amount) : 'Monthly') : '—'}
          hint={trip.costSnapshot ? (trip.costSnapshot.basis === 'per_km' ? `₹${trip.costSnapshot.ratePerKm}/km` : COST_BASIS_LABELS[trip.costSnapshot.basis]) : undefined}
        />
      </div>

      <p className="text-xs text-muted-foreground">Company vehicle trip — billed to {trip.projectName || 'the project'}, not claimable. An own-vehicle trip is recorded on Fleet Trip&apos;s Own vehicle tab and claimed from My Trips.</p>

      <Section title="Route" icon={MapPin}>
        {routeLabel && <p className="mb-2 min-w-0 break-words text-sm font-medium text-slate-800">{routeLabel}</p>}
        <FleetTripMap points={route} live={open} title={open ? 'Route so far' : 'Route'} heightClassName="h-[260px] sm:h-[380px]" />
        {route.length <= 1 && <p className="mt-2 text-xs text-muted-foreground">No GPS track has reached the server{open ? ' yet' : ''}.</p>}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Time" icon={Clock}>
          <Row label="Started">
            {shortDateLabel(trip.dateKey)} {istTimeLabel(trip.startedAt)}
            {trip.startPlace || trip.startGeofenceName ? ` · ${trip.startPlace || trip.startGeofenceName}` : ''}
          </Row>
          <Row label="Ended">
            {trip.endedAt ? `${shortDateLabel(istDateKey(trip.endedAt))} ${istTimeLabel(trip.endedAt)}${trip.endPlace || trip.endGeofenceName ? ` · ${trip.endPlace || trip.endGeofenceName}` : ''}` : open ? 'Still running' : '—'}
          </Row>
          {durationMinutes !== null && <Row label="Duration">{durationLabel(durationMinutes)}</Row>}
          <Row label="Moving / standing">
            {durationLabel(trip.movingMinutes)} / {durationLabel(trip.idleMinutes)}
          </Row>
          {trip.pauses.length > 0 && <Row label="Paused">{trip.pauses.map((pause) => `${istTimeLabel(pause.from)}–${pause.to ? istTimeLabel(pause.to) : '…'}`).join(', ')}</Row>}
          {days.length > 1 && <Row label="Km by day">{days.map(([day, km]) => `${shortDateLabel(day)}: ${formatKm(km)}`).join(' · ')}</Row>}
          <Row label="Expected">{formatKm(trip.expectedKm)}</Row>
          {trip.endedBy && <Row label="Closed">{ENDED_BY_LABELS[trip.endedBy]}</Row>}
          {trip.endRemark && <Row label="Remark">{trip.endRemark}</Row>}
          {trip.cancelReason && <Row label="Cancelled">{trip.cancelReason}</Row>}
        </Section>

        <Section title="Places" icon={Flag}>
          {trip.visits.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {trip.visits.map((visit, index) => (
                <li key={`${visit.geofenceId}-${visit.enterAt}-${index}`} className="flex min-w-0 items-center gap-2 text-sm">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {visit.name} <span className="text-xs text-muted-foreground">· {GEOFENCE_KIND_LABELS[visit.kind]}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {istTimeLabel(visit.enterAt)}–{visit.exitAt ? istTimeLabel(visit.exitAt) : '…'} · {durationLabel(visit.minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {events.length ? (
            <ul className="space-y-1">
              {events.map((event, index) => (
                <li key={`${event.at}-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-slate-600">
                  <span className="shrink-0 tabular-nums">{istTimeLabel(event.at)}</span>
                  <span className="min-w-0 truncate">
                    {event.type === 'enter' ? 'Arrived at' : 'Left'} {event.geofenceName}
                  </span>
                </li>
              ))}
              {events[0]?.source === 'device' && <li className="text-[11px] text-muted-foreground">As the phone saw it; the server recomputes these when the trip ends.</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No arrivals at a known place{open ? ' yet' : ''}.</p>
          )}
        </Section>
      </div>

      <Section title="Odometer photos" icon={Camera}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { key: 'start', label: `Start · ${Math.round(trip.startOdometer.km).toLocaleString('en-IN')} km`, uploadId: photos.start, ocr: trip.startOdometer.ocrKm },
            { key: 'end', label: trip.endOdometer ? `End · ${Math.round(trip.endOdometer.km).toLocaleString('en-IN')} km` : 'End', uploadId: photos.end, ocr: trip.endOdometer?.ocrKm ?? null },
          ].map((photo) => (
            <div key={photo.key} className="min-w-0 space-y-1.5">
              <p className="text-xs font-medium text-slate-700">
                {photo.label}
                {photo.ocr !== null && <span className="ml-1 font-normal text-muted-foreground">(photo read {Math.round(photo.ocr).toLocaleString('en-IN')})</span>}
              </p>
              {photo.uploadId ? <FleetPhoto uploadId={photo.uploadId} alt={photo.label} /> : <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-muted-foreground">{photo.key === 'end' && open ? 'Taken when the trip ends.' : 'No photo.'}</p>}
            </div>
          ))}
        </div>
      </Section>

      {trip.flagCodes.length > 0 && (
        <Section title="Flags" icon={AlertTriangle}>
          <ul className="space-y-2">
            {trip.flagCodes.map((flag) => (
              <li key={flag} className="flex min-w-0 items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{TRIP_FLAG_LABELS[flag]}</span>
                  <span className="block text-xs text-muted-foreground">{TRIP_FLAG_HINTS[flag]}</span>
                </span>
              </li>
            ))}
          </ul>
          {trip.exceptionStatus === 'resolved' && trip.exceptionNote && (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">Resolved: {trip.exceptionNote}</p>
          )}
        </Section>
      )}

      {(trip.approvalId || trip.isEmergency || trip.siteInternal || trip.reportedIn) && (
        <Section title="Limit and payment" icon={Gauge}>
          {trip.approvalId && (
            <p className="flex items-center gap-2 text-sm text-slate-700">
              <ShieldAlert className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              Ran on an over-limit approval: {formatKm(trip.approvedKmCap)} allowed for the vehicle that day.
            </p>
          )}
          {trip.isEmergency && (
            <p className="mt-1 flex items-start gap-2 text-sm text-rose-800">
              <Siren className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">Emergency start: {trip.emergencyReason}</span>
            </p>
          )}
          {trip.siteInternal && <p className="mt-1 text-sm text-slate-700">Stayed inside one project site — not counted toward the daily limit.</p>}
          {trip.reportedIn && <p className="mt-1 text-sm text-slate-700">Paid in the {trip.reportedIn} payment report.</p>}
        </Section>
      )}

      {dialog === 'review' && <ReviewTripDialog trip={trip} open onOpenChange={(next) => !next && setDialog(null)} onDone={refreshed} />}
      {dialog === 'close' && <ForceCloseDialog trip={trip} open onOpenChange={(next) => !next && setDialog(null)} onDone={refreshed} />}
      {dialog === 'resolve' && (
        <ResolveExceptionDialog kind="trip" id={trip.id} label={`${trip.vehicleNumber} · ${shortDateLabel(trip.dateKey)}`} open onOpenChange={(next) => !next && setDialog(null)} onDone={refreshed} />
      )}
    </div>
  );
}
