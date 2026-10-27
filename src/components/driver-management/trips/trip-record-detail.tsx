'use client';

/**
 * One claimable trip (almost always an own-vehicle one), in full — what a row on My Trips, All Trips
 * or Fleet Trip's Recent trips opens: the route on a map, the distance claimed beside what the GPS
 * measured, how it was priced, when it ran, and where its claim stands (sent back, decided, on which
 * claim).
 *
 * Read-only, as the registers are: an unclaimed trip is edited, deleted and claimed from My Trips,
 * and a claimed one belongs to its claim's workflow. The page mirrors the company trip's
 * (fleet/trip-detail.tsx) so the two kinds of trip read alike. The server decides who may open it
 * (the employee, Trip Claims · View All, the claim's workflow). `?from=all|fleet` sends the back
 * button to the register the trip was opened from.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Banknote, Clock, MapPin, ReceiptText, Route, Scale, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import { FleetTripMap } from '@/components/fleet/fleet-maps';
import { durationLabel, istTimeLabel } from '@/lib/fleet/dates';
import { FLAG_HINTS, FLAG_LABELS, formatKm, type TripRecord } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { useTripQuery } from './use-trip-query';
import { ErrorBlock, LoadingBlock, Money, TripStatusBadge, VehicleLabel, shortDate } from './trip-ui';

const DECISION_LABELS: Record<NonNullable<TripRecord['decision']>['decision'], string> = { approve: 'Approved', adjust: 'Approved with a change', reject: 'Rejected' };

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

export default function TripRecordDetailView({ tripId }: { tripId: string }) {
  const params = useSearchParams();
  const query = useTripQuery<{ trip: TripRecord; mine: boolean }>(tripId ? `trips/${encodeURIComponent(tripId)}` : null);

  if (query.loading && !query.data) return <LoadingBlock />;
  if (!query.data) return <ErrorBlock message={query.error ?? 'This trip could not be loaded.'} onRetry={() => void query.reload()} />;

  const { trip, mine } = query.data;
  const from = params.get('from');
  const backHref =
    from === 'all' ? '/driver-management/all-trips' : from === 'fleet' ? '/driver-management/fleet' : mine ? '/driver-management/my-trips' : trip.claimId ? `/driver-management/claims/${trip.claimId}` : '/driver-management/all-trips';

  const gps = trip.gps;
  const route = gps?.path ?? [];
  const durationMinutes = gps ? (Date.parse(gps.endedAtIso) - Date.parse(gps.startedAtIso)) / 60_000 : null;
  const odometerKm = trip.startOdometer !== null && trip.endOdometer !== null ? Math.round((trip.endOdometer - trip.startOdometer) * 10) / 10 : null;
  const decided = trip.decision;
  const amount = decided ? decided.approvedAmount : trip.totalAmount;
  // A claimed distance well away from the measured one is what an approver looks at first.
  const measuredGap = gps ? Math.abs(trip.distanceKm - gps.measuredKm) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${trip.vehicleNumber} · ${shortDate(trip.tripDate)}`}
        description={`${trip.employeeName} · ${trip.purpose || 'No purpose'}${trip.projectName ? ` · ${trip.projectName}` : ''}`}
        icon={Route}
        backHref={backHref}
        badge={<TripStatusBadge status={trip.status} />}
        actions={
          trip.claimId && trip.claimNumber ? (
            <Button type="button" variant="outline" asChild>
              <Link href={`/driver-management/claims/${trip.claimId}`}>
                <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
                {trip.claimNumber}
              </Link>
            </Button>
          ) : undefined
        }
      />

      {trip.status === 'draft' && trip.returnNote && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Undo2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">
              Sent back from {trip.returnNote.claimNumber} by {trip.returnNote.byName}
            </p>
            <p className="break-words text-xs">{trip.returnNote.remarks}</p>
          </div>
        </div>
      )}
      {decided && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-xl border p-3 text-sm',
            decided.decision === 'reject' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900',
          )}
        >
          <Scale className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-semibold">
              {DECISION_LABELS[decided.decision]} by {decided.byName} ({decided.stageName}): {formatKm(decided.approvedKm)} · <Money value={decided.approvedAmount} />
            </p>
            {decided.remarks && <p className="break-words text-xs">{decided.remarks}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Figure label="Claimed" value={formatKm(trip.distanceKm)} hint={trip.source === 'gps' ? 'from the GPS recording' : 'typed in'} />
        <Figure
          label="GPS"
          value={gps ? formatKm(gps.measuredKm) : '—'}
          hint={gps ? `${gps.fixes} fixes${gps.droppedFixes ? ` · ${gps.droppedFixes} dropped` : ''}` : 'not recorded'}
          tone={gps && measuredGap > Math.max(1, gps.measuredKm * 0.1) ? 'warn' : undefined}
        />
        <Figure label="Odometer" value={formatKm(odometerKm)} hint={trip.startOdometer !== null && trip.endOdometer !== null ? `${trip.startOdometer.toLocaleString('en-IN')} → ${trip.endOdometer.toLocaleString('en-IN')}` : 'not entered'} />
        <Figure
          label={decided ? 'Approved' : 'Amount'}
          value={<Money value={amount} />}
          hint={decided && decided.approvedAmount !== trip.totalAmount ? <>of <Money value={trip.totalAmount} /> claimed</> : trip.ratePerKm !== null ? `@ ₹${trip.ratePerKm}/km` : 'no rate'}
          tone={trip.status === 'paid' ? 'good' : undefined}
        />
      </div>

      <Section title="Route" icon={MapPin}>
        <p className="mb-2 min-w-0 break-words text-sm font-medium text-slate-800">
          {trip.fromPlace} → {trip.toPlace}
        </p>
        {route.length > 0 ? (
          <FleetTripMap points={route} title="Route" heightClassName="h-[260px] sm:h-[380px]" />
        ) : (
          <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-muted-foreground">{trip.source === 'gps' ? 'No route was kept with this recording.' : 'Typed in — there is no GPS route.'}</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Time" icon={Clock}>
          <Row label="Date">{shortDate(trip.tripDate)}</Row>
          {gps && (
            <>
              <Row label="Started">{istTimeLabel(gps.startedAtIso)}</Row>
              <Row label="Ended">{istTimeLabel(gps.endedAtIso)}</Row>
              {durationMinutes !== null && Number.isFinite(durationMinutes) && <Row label="Duration">{durationLabel(durationMinutes)}</Row>}
              <Row label="Moving / standing">
                {durationLabel(gps.movingMinutes)} / {durationLabel(gps.idleMinutes)}
              </Row>
              <Row label="Stops">{gps.stopCount}</Row>
            </>
          )}
          <Row label="Vehicle">
            <VehicleLabel inline ownership={trip.ownership} vehicleNumber={trip.vehicleNumber} vehicleType={trip.vehicleType} />
          </Row>
          {trip.departmentName && <Row label="Department">{trip.departmentName}</Row>}
          {trip.notes && <Row label="Notes">{trip.notes}</Row>}
          <Row label="Recorded">{trip.createdAt ? `${shortDate(trip.createdAt)} ${istTimeLabel(trip.createdAt)}` : '—'}</Row>
        </Section>

        <Section title="Money" icon={Banknote}>
          <Row label="Rate">{trip.ratePerKm !== null ? `₹${trip.ratePerKm}/km` : 'No rate on the trip date'}</Row>
          <Row label="Distance">
            <Money value={trip.distanceAmount} />
          </Row>
          {trip.tollAmount > 0 && (
            <Row label="Toll">
              <Money value={trip.tollAmount} />
            </Row>
          )}
          {trip.parkingAmount > 0 && (
            <Row label="Parking">
              <Money value={trip.parkingAmount} />
            </Row>
          )}
          <Row label="Claimed">
            <Money value={trip.totalAmount} className="font-semibold" />
          </Row>
          {decided && (
            <Row label="Approved">
              <Money value={decided.approvedAmount} className="font-semibold" />
            </Row>
          )}
          <Row label="Claim">
            {trip.claimId && trip.claimNumber ? (
              <Link href={`/driver-management/claims/${trip.claimId}`} className="font-medium text-primary hover:underline">
                {trip.claimNumber}
              </Link>
            ) : (
              'Not claimed yet'
            )}
          </Row>
          {trip.previousClaims.length > 0 && <Row label="Earlier claims">{trip.previousClaims.join(', ')}</Row>}
        </Section>
      </div>

      {trip.flags.length > 0 && (
        <Section title="Flags" icon={AlertTriangle}>
          <ul className="space-y-2">
            {trip.flags.map((flag) => (
              <li key={flag} className="flex min-w-0 items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{FLAG_LABELS[flag]}</span>
                  <span className="block text-xs text-muted-foreground">{FLAG_HINTS[flag]}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
