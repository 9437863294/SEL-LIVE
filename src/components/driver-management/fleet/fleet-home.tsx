'use client';

/**
 * Fleet Trip — the driver's screen for company vehicles (SEL Driver app and browser alike).
 *
 * One question decides the screen: is a trip running? If so, it is the running trip and nothing
 * else competes with it — the end button is the one a driver is looking for. If not, it is the
 * vehicles with how much of today's limit each has left, a Start button on each, today's
 * over-limit requests with their answers, and the recent trips.
 *
 * The start flow keeps its values between its steps. A start stopped by the daily limit opens the
 * over-limit dialog with them; once the manager approves, "Start now" reopens the start with the
 * same vehicle, purpose, project, reading and the photo already uploaded. While a request waits,
 * the screen asks the server every 30 seconds so the answer shows up on its own.
 *
 * A trip here is recorded exactly as a My Trips GPS trip ("Drive & record"): the same start, the
 * same live card, the same Stop & review. What differs is what it is for. Company-vehicle running is
 * billed to projects and is not claimable; personal-vehicle travel stays in My Trips and claims
 * (docs/fleet/ASSUMPTIONS.md, D1), and the screen says so where a driver decides which to use.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Building2, CarFront, LocateFixed, Lock, RefreshCw, Route, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import type { FleetApproval, FleetTrip } from '@/lib/fleet/types';
import { useFleet } from '@/components/fleet/fleet-provider';
import { KmLimitMeter } from '@/components/fleet/fleet-ui';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/driver-management/trips/trip-ui';
import { cn } from '@/lib/utils';
import { ActiveTrip } from './active-trip';
import { MyFleetTrips } from './my-fleet-trips';
import { OverLimitDialog } from './over-limit-dialog';
import { StartTripDialog } from './start-trip-dialog';
import { TodaysRequests } from './todays-requests';
import type { EndOutcome } from './end-trip-dialog';
import { emptyStartValues, type OverLimitState, type StartValues } from './start-helpers';

const APPROVAL_POLL_MS = 30_000;

export default function FleetHome() {
  const { data, loading, error, reload } = useFleet();
  /** The start dialog, open with these values (a fresh key per opening). */
  const [start, setStart] = useState<{ key: number; initial: Partial<StartValues> } | null>(null);
  const [overLimit, setOverLimit] = useState<OverLimitState | null>(null);
  /** The last start the limit stopped, to reopen once approved. */
  const [saved, setSaved] = useState<StartValues | null>(null);
  /** Trips ended on this phone whose end is still in the queue. */
  const [endedLocally, setEndedLocally] = useState<string[]>([]);
  /** A trip just started, shown before the bootstrap has reloaded. */
  const [justStarted, setJustStarted] = useState<FleetTrip | null>(null);
  /** Each opening of the start dialog mounts it afresh. */
  const openings = useRef(0);

  const openTrip = data?.openTrip ?? (justStarted && !endedLocally.includes(justStarted.id) ? justStarted : null);
  const waiting = Boolean(data?.approvalsToday.some((approval) => approval.status === 'pending'));

  // While a request waits for an answer, ask again every half minute (in the timer's callback).
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(() => void reload(), APPROVAL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, reload]);

  const vehicles = useMemo(
    () => [...(data?.vehicles ?? [])].sort((a, b) => Number(b.assignedToMe) - Number(a.assignedToMe) || Number(a.busy) - Number(b.busy) || a.vehicleNumber.localeCompare(b.vehicleNumber)),
    [data?.vehicles],
  );
  const mine = vehicles.filter((vehicle) => vehicle.assignedToMe);
  const others = vehicles.filter((vehicle) => !vehicle.assignedToMe);
  const [showOthers, setShowOthers] = useState(false);

  if (loading && !data) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={error ?? 'Fleet Trip could not be loaded.'} onRetry={() => void reload()} />;

  const openStart = (initial: Partial<StartValues>) => {
    openings.current += 1;
    setStart({ key: openings.current, initial });
  };

  const startFromApproval = (approval: FleetApproval) => {
    const vehicle = data.vehicles.find((entry) => entry.id === approval.vehicleId);
    const room = vehicle && approval.allowedKm !== null ? Math.max(0, Math.round(approval.allowedKm - vehicle.usedTodayKm)) : null;
    const base = saved && saved.vehicleId === approval.vehicleId ? saved : { ...emptyStartValues(approval.vehicleId), purposeId: approval.purposeId, projectId: approval.projectId, expectedKm: String(approval.requestedKm) };
    const expected = Number(base.expectedKm);
    openStart({ ...base, expectedKm: room !== null && Number.isFinite(expected) && expected > room ? String(room) : base.expectedKm });
  };

  const started = (trip: FleetTrip) => {
    setStart(null);
    setOverLimit(null);
    setSaved(null);
    setJustStarted(trip);
    reload();
  };

  const ended = (outcome: EndOutcome) => {
    if (outcome.kind === 'queued' && openTrip) setEndedLocally((current) => [...current, openTrip.id]);
    setJustStarted(null);
    reload();
  };

  const header = (
    <PageHeader
      title="Fleet Trip"
      description="Company vehicles: drive & record the route by GPS, as a My Trips GPS trip, with the odometer at both ends. Billed to the project."
      icon={Truck}
      actions={
        <>
          <Button type="button" variant="outline" onClick={() => reload()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="#my-fleet-trips">
              <Route className="mr-2 h-4 w-4" aria-hidden />
              My trips
            </Link>
          </Button>
        </>
      }
    />
  );

  if (!data.canDrive && !openTrip) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyBlock icon={Lock} title="Company vehicles are driven by Driver Master drivers">
          Ask the fleet office to add you as a driver. Travel in your own vehicle goes in{' '}
          <Link href="/driver-management/my-trips" className="font-medium text-primary hover:underline">
            My Trips
          </Link>
          .
        </EmptyBlock>
      </div>
    );
  }

  const notClaimable = (
    <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
      <Building2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        Company vehicle trips are recorded here and billed to the project — they are not claimable. For your own vehicle use{' '}
        <Link href="/driver-management/my-trips" className="font-medium underline underline-offset-2">
          My Trips
        </Link>
        .
      </span>
    </p>
  );

  const vehicleCard = (vehicle: (typeof vehicles)[number]) => {
    const left = Math.max(0, vehicle.allowedTodayKm - vehicle.usedTodayKm);
    return (
      <li key={vehicle.id} className="min-w-0">
        <div className={cn('flex h-full min-w-0 flex-col gap-3 rounded-xl border bg-white p-3', vehicle.busy ? 'border-slate-200 opacity-70' : 'border-slate-200')}>
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{vehicle.vehicleNumber}</p>
              <p className="truncate text-xs text-muted-foreground">
                {vehicle.vehicleType}
                {vehicle.fuelType ? ` · ${vehicle.fuelType}` : ''}
                {vehicle.currentOdometerKm ? ` · ${Math.round(vehicle.currentOdometerKm).toLocaleString('en-IN')} km` : ''}
              </p>
            </div>
            {vehicle.assignedToMe && <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">Yours</span>}
          </div>
          <KmLimitMeter usedKm={vehicle.usedTodayKm} allowedKm={vehicle.allowedTodayKm} limitKm={vehicle.dailyKmLimit} compact />
          <Button type="button" className="mt-auto w-full" onClick={() => openStart({ ...emptyStartValues(vehicle.id) })} disabled={vehicle.busy}>
            <LocateFixed className="mr-2 h-4 w-4" aria-hidden />
            {vehicle.busy ? 'On a trip' : left <= 0 ? 'Drive & record (needs approval)' : 'Drive & record'}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {header}
      {notClaimable}

      {openTrip ? (
        <ActiveTrip
          trip={openTrip}
          bootstrap={data}
          endedLocally={endedLocally.includes(openTrip.id)}
          onChanged={() => {
            // A pause, resume or cancel: the server's copy is the one to show from here on.
            setJustStarted(null);
            reload();
          }}
          onEnded={ended}
        />
      ) : (
        <>
          <TodaysRequests approvals={data.approvalsToday} onChanged={() => reload()} onStartNow={startFromApproval} startDisabled={Boolean(openTrip)} />

          <Card className="w-full">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CarFront className="h-4 w-4 text-slate-500" aria-hidden />
                {mine.length ? 'Your vehicles' : 'Vehicles'}
              </CardTitle>
              <span className="text-xs text-muted-foreground">km today against each vehicle&apos;s limit</span>
            </CardHeader>
            <CardContent>
              {!vehicles.length ? (
                <EmptyBlock icon={CarFront} title="No company vehicles">
                  Vehicle Master has no active vehicles yet.
                </EmptyBlock>
              ) : (
                <div className="space-y-3">
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{(mine.length ? mine : others.slice(0, showOthers ? others.length : 6)).map(vehicleCard)}</ul>
                  {mine.length > 0 && showOthers && <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{others.map(vehicleCard)}</ul>}
                  {(mine.length ? others.length > 0 : others.length > 6) && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowOthers((current) => !current)}>
                      {showOthers ? 'Show fewer' : `Another vehicle (${others.length}${mine.length ? '' : ' in all'})`}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => openStart({ ...emptyStartValues(mine[0]?.id ?? '') })}>
                    <LocateFixed className="mr-2 h-4 w-4" aria-hidden />
                    Drive &amp; record — choose any vehicle
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {data.emergenciesLeft < data.settings.emergencyMonthlyMax && (
            <p className="text-xs text-muted-foreground">
              Emergency starts left this month: {data.emergenciesLeft} of {data.settings.emergencyMonthlyMax}.
            </p>
          )}
        </>
      )}

      <MyFleetTrips recent={data.recentTrips} today={data.today} />

      {start && (
        <StartTripDialog
          key={start.key}
          open
          onOpenChange={(open) => !open && setStart(null)}
          bootstrap={data}
          initial={start.initial}
          onStarted={started}
          onOverLimit={(state) => {
            setStart(null);
            setSaved(state.values);
            setOverLimit(state);
          }}
        />
      )}
      {overLimit && (
        <OverLimitDialog
          open
          onOpenChange={(open) => !open && setOverLimit(null)}
          bootstrap={data}
          state={overLimit}
          onRequested={() => {
            setOverLimit(null);
            reload();
          }}
          onStarted={started}
        />
      )}
    </div>
  );
}
