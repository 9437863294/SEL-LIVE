'use client';

/**
 * Fleet Trip — the one place a trip is recorded, by GPS, in the SEL Driver app and the browser alike.
 * My Trips no longer records anything; it lists the claimable trips and claims them.
 *
 * One Start button, then a prompt — "Which vehicle are you using?" (vehicle-choice-dialog.tsx) —
 * because the two are separate calculations:
 *
 * - **Own vehicle** — the employee's own car or bike, reimbursed per km from the trip-claims rate
 *   card. Recorded with the GPS trip recorder (gps-trip-recorder.tsx, locked to own vehicles here):
 *   Drive & record, Stop & review, and the trip lands in My Trips, ready to put on a claim.
 * - **Company vehicle** — a Vehicle Master vehicle: a fleet trip, billed to the project and never
 *   claimable. Held to the vehicle's daily km limit (over it needs approval, or an emergency start),
 *   with odometer photos at both ends, synced in the background and offline. The start dialog's
 *   vehicle picker shows each vehicle's km today against its limit.
 *
 * Both record the same way — the same live card, the same tiles, the route drawn fix by fix
 * (live-recording-card.tsx) — and only one trip runs at a time: while either is being driven the
 * screen is that trip and nothing else competes with it.
 *
 * The company flow keeps its values between its steps. A start stopped by the daily limit opens the
 * over-limit dialog with them; once the manager approves, "Start now" reopens the start with the
 * same vehicle, purpose, project, reading and the photo already uploaded. While a request waits,
 * the screen asks the server every 30 seconds so the answer shows up on its own.
 *
 * `?kind=choose` opens the prompt (the Overview's Start a trip); `?kind=own|company` skips it (My
 * Trips' "Record a trip" means own).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Navigation, ReceiptText, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';
import type { FleetApproval, FleetTrip } from '@/lib/fleet/types';
import { isClaimable } from '@/lib/employee-trips/trips';
import { formatKm, type TripRecord } from '@/lib/employee-trips/types';
import { sumMoney } from '@/lib/employee-trips/rates';
import { useFleet } from '@/components/fleet/fleet-provider';
import { GpsTripPanel, GpsTripProvider, useGpsTripControls } from '@/components/driver-management/trips/gps-trip-recorder';
import { useTripClaims } from '@/components/driver-management/trips/trip-claims-provider';
import { useTripQuery } from '@/components/driver-management/trips/use-trip-query';
import { ErrorBlock, LoadingBlock, Money } from '@/components/driver-management/trips/trip-ui';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { cn } from '@/lib/utils';
import { ActiveTrip } from './active-trip';
import { MyFleetTrips } from './my-fleet-trips';
import { OverLimitDialog } from './over-limit-dialog';
import { StartTripDialog } from './start-trip-dialog';
import { TodaysRequests } from './todays-requests';
import { VehicleChoiceDialog } from './vehicle-choice-dialog';
import type { EndOutcome } from './end-trip-dialog';
import { emptyStartValues, type OverLimitState, type StartValues } from './start-helpers';

const APPROVAL_POLL_MS = 30_000;

/**
 * Opens the start the URL asked for, once, when it can (inside the recorder's provider, so an
 * own-vehicle start can wait for the trip-claims settings to arrive).
 */
function StartFromUrl({ kind, enabled, onCompany, onChoose }: { kind: string | null; enabled: boolean; onCompany: () => void; onChoose: () => void }) {
  const gps = useGpsTripControls();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !enabled || !kind) return;
    if (kind === 'own' && gps.available) {
      done.current = true;
      gps.start();
    } else if (kind === 'company') {
      done.current = true;
      onCompany();
    } else if (kind === 'choose') {
      // The Overview's Start a trip: ask which vehicle first.
      done.current = true;
      onChoose();
    } else return;
    // Once only: a reload of the page does not start another trip.
    window.history.replaceState(null, '', window.location.pathname);
  }, [kind, enabled, gps, onCompany, onChoose]);
  return null;
}

export default function FleetHome() {
  const params = useSearchParams();
  const { data, loading, error, reload } = useFleet();
  const claims = useTripClaims();
  const tripsQuery = useTripQuery<{ trips: TripRecord[] }>('trips');
  const myTrips = useMemo(() => tripsQuery.data?.trips ?? [], [tripsQuery.data]);

  /** The "Which vehicle?" prompt. */
  const [choosing, setChoosing] = useState(false);
  /** The own-vehicle recorder is driving (told by its provider). */
  const [ownRecording, setOwnRecording] = useState(false);
  /** The own-vehicle trip just saved, to point at My Trips for the claim. */
  const [savedOwn, setSavedOwn] = useState<TripRecord | null>(null);

  /** The company start dialog, open with these values (a fresh key per opening). */
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

  const assigned = useMemo(() => (data?.vehicles ?? []).find((vehicle) => vehicle.assignedToMe && !vehicle.busy) ?? null, [data?.vehicles]);

  if ((loading && !data) || (claims.loading && !claims.data)) return <LoadingBlock />;
  if (!data) return <ErrorBlock message={error ?? 'Fleet Trip could not be loaded.'} onRetry={() => void reload()} />;

  const busy = Boolean(openTrip) || ownRecording;
  const today = claims.data?.today ?? data.today;
  const rules = claims.data?.settings.rules;
  const unclaimed = rules ? myTrips.filter((trip) => isClaimable(trip, today, rules)) : [];
  const ownBlocked = rules && !rules.allowOwnVehicle ? 'Own vehicle: switched off in Trip Settings.' : null;
  const companyBlocked = !data.canDrive ? 'Company vehicle: for Driver Master drivers — ask the fleet office.' : !data.vehicles.length ? 'Company vehicle: none in Vehicle Master yet.' : null;

  const openStart = (initial: Partial<StartValues>) => {
    openings.current += 1;
    setStart({ key: openings.current, initial });
  };
  // A company start opens on the driver's own assigned vehicle when there is one free.
  const startCompany = () => openStart({ ...emptyStartValues(assigned?.id ?? '') });

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

  const onOwnSaved = (trip: TripRecord) => {
    setSavedOwn(trip);
    tripsQuery.setData((current) => ({ trips: [trip, ...(current?.trips ?? []).filter((entry) => entry.id !== trip.id)] }));
    claims.reload();
  };

  const header = (
    <PageHeader
      title="Fleet Trip"
      description="Record every official trip by GPS — your own vehicle or a company vehicle."
      icon={Truck}
      // No actions: My Trips is on the module's own navigation, and Refresh sits on the Recent
      // trips card — a lone button here took a row of its own on a phone.
    />
  );

  const body = (
    <div className="space-y-4">
      {header}

      {/* The own-vehicle recording, full width while it is driven. */}
      <GpsTripPanel />

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
      ) : ownRecording ? null : (
        <>
          {/* A phone gets the one thing it is opened for: a big Start button, thumb-high. */}
          <Button type="button" className={cn(VM_PRIMARY_BUTTON, 'h-14 w-full rounded-2xl text-base font-semibold shadow-sm sm:hidden')} onClick={() => setChoosing(true)}>
            <Navigation className="mr-2 h-5 w-5" aria-hidden />
            Start a trip
          </Button>
          <Card className="hidden w-full overflow-hidden border-primary/20 bg-gradient-to-br from-white to-primary/5 sm:block">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Navigation className="h-5 w-5" aria-hidden />
                </span>
                <p className="text-base font-semibold text-slate-800">Record a trip</p>
              </div>
              <Button type="button" size="lg" className={cn(VM_PRIMARY_BUTTON, 'shrink-0')} onClick={() => setChoosing(true)}>
                <Navigation className="mr-2 h-4 w-4" aria-hidden />
                Start a trip
              </Button>
            </CardContent>
          </Card>

          {data.canDrive && data.approvalsToday.length > 0 && <TodaysRequests approvals={data.approvalsToday} onChanged={() => reload()} onStartNow={startFromApproval} startDisabled={busy} />}

          {(savedOwn || unclaimed.length > 0) && (
            <Card className="w-full">
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-semibold text-slate-800">Own-vehicle trips</p>
                {savedOwn && (
                  <p className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                    <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">
                      Saved: {savedOwn.fromPlace} → {savedOwn.toPlace} · {formatKm(savedOwn.distanceKm)} · <Money value={savedOwn.totalAmount} />
                    </span>
                  </p>
                )}
                {unclaimed.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <p className="text-xs text-slate-700">
                      {unclaimed.length} unclaimed · {formatKm(unclaimed.reduce((total, trip) => total + trip.distanceKm, 0))} · <Money value={sumMoney(unclaimed.map((trip) => trip.totalAmount))} className="font-medium" />
                    </p>
                    <Button type="button" size="sm" asChild>
                      <Link href="/driver-management/my-trips?claim=1">
                        <ReceiptText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        Create claim
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {data.canDrive && data.emergenciesLeft < data.settings.emergencyMonthlyMax && (
            <p className="text-xs text-muted-foreground">
              Company vehicles — emergency starts left this month: {data.emergenciesLeft} of {data.settings.emergencyMonthlyMax}.
            </p>
          )}
        </>
      )}

      {!ownRecording && (data.canDrive || data.recentTrips.length > 0) && <MyFleetTrips recent={data.recentTrips} today={data.today} onRefresh={() => void reload()} refreshing={loading} />}

      <VehicleChoiceDialog open={choosing} onOpenChange={setChoosing} ownBlocked={ownBlocked} companyBlocked={companyBlocked} onCompany={startCompany} />
      <StartFromUrl kind={params.get('kind')} enabled={!busy} onCompany={companyBlocked ? () => setChoosing(true) : startCompany} onChoose={() => setChoosing(true)} />

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

  // The own-vehicle recorder needs the trip-claims settings (rates, rules); until they are in, the
  // page still works for company vehicles, and the prompt says the own choice is loading.
  return claims.data ? (
    <GpsTripProvider data={claims.data} myTrips={myTrips} onSaved={onOwnSaved} onRecordingChange={setOwnRecording} ownership="own">
      {body}
    </GpsTripProvider>
  ) : (
    body
  );
}
