'use client';

/**
 * Starting a fleet trip: which vehicle, what for, which project, how far, and the odometer — read
 * and photographed.
 *
 * It starts the way a My Trips GPS trip starts ("Drive & record"): the date is today and not
 * editable (a trip is dated by when it is driven), the starting place fills itself from the phone's
 * position and stays editable, and once started the route records live on the same card. Unlike a
 * GPS trip, a company-vehicle trip is not claimable — it is billed to the project.
 *
 * The server decides everything that matters (the vehicle's lock, the odometer against its last
 * reading, the day's km against the limit), so this dialog asks for what only the driver knows and
 * says plainly what the server answered. Starting needs a connection; once started, the trip
 * records offline.
 *
 * - The photo is uploaded once and reused if the start has to be retried (see start-helpers).
 * - When OCR is on and reads a different number off the photo, the driver is asked once — "the
 *   photo reads 45,312 — use it?" — before anything is sent. A slip on the keypad is the commonest
 *   odometer error, and it is cheapest to catch here.
 * - The start id is fixed for this opening of the dialog, so a retry after a dropped connection
 *   returns the trip that was already started instead of failing on the vehicle's lock.
 * - Over the daily limit, the dialog hands its values to the over-limit dialog; approved later,
 *   it reopens with the same values.
 */

import { useEffect, useMemo, useState } from 'react';
import { Camera, Gauge, Loader2, LocateFixed, ScanLine, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { shortDateLabel } from '@/lib/fleet/dates';
import { formatKm, type FleetTrip } from '@/lib/fleet/types';
import type { FleetBootstrap } from '@/lib/fleet/server/overview';
import { fleetErrorMessage, newClientId } from '@/components/fleet/fleet-api';
import { KmLimitMeter, PhotoCapture } from '@/components/fleet/fleet-ui';
import { Field, SearchSelect } from '@/components/driver-management/trips/trip-ui';
import {
  emptyStartValues,
  ensureUploaded,
  fieldErrors,
  ocrDiffers,
  overLimitFrom,
  placeName,
  postStart,
  prepareLocation,
  refusalCode,
  startBody,
  toNumber,
  vehicleOf,
  type OverLimitState,
  type StartValues,
} from './start-helpers';

type Errors = Partial<Record<'vehicleId' | 'purposeId' | 'purposeReason' | 'projectId' | 'expectedKm' | 'startOdometerKm' | 'photo', string>>;

function validate(values: StartValues, bootstrap: FleetBootstrap): Errors {
  const errors: Errors = {};
  const vehicle = vehicleOf(bootstrap, values.vehicleId);
  const purpose = bootstrap.purposes.find((entry) => entry.id === values.purposeId);
  if (!vehicle) errors.vehicleId = 'Choose the vehicle.';
  else if (vehicle.busy) errors.vehicleId = `${vehicle.vehicleNumber} is on another trip.`;
  if (!purpose) errors.purposeId = 'Choose what the trip is for.';
  if (purpose?.requiresReason && values.purposeReason.trim().length < 3) errors.purposeReason = 'Say what the trip is for.';
  if (purpose?.requiresProject && !values.projectId) errors.projectId = `A ${purpose.name.toLowerCase()} is billed to a project.`;
  const expected = toNumber(values.expectedKm);
  if (expected === null || expected <= 0) errors.expectedKm = 'Roughly how far will you go?';
  else if (expected > 2000) errors.expectedKm = 'At most 2,000 km.';
  const reading = toNumber(values.startOdometerKm);
  if (reading === null || reading < 0) errors.startOdometerKm = 'Read the odometer.';
  else if (vehicle?.currentOdometerKm !== null && vehicle?.currentOdometerKm !== undefined && reading < vehicle.currentOdometerKm) {
    errors.startOdometerKm = `Last recorded ${Math.round(vehicle.currentOdometerKm).toLocaleString('en-IN')} km — the reading cannot go down. If the meter was replaced, ask the fleet admin.`;
  }
  if (!values.photo) errors.photo = 'Photograph the odometer.';
  return errors;
}

export function StartTripDialog({
  open,
  onOpenChange,
  bootstrap,
  initial,
  onStarted,
  onOverLimit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bootstrap: FleetBootstrap;
  /** Values to open with — a vehicle chosen on the home screen, or a start the limit stopped. */
  initial: Partial<StartValues> | null;
  onStarted: (trip: FleetTrip) => void;
  onOverLimit: (state: OverLimitState) => void;
}) {
  const { toast } = useToast();
  // Mounted fresh for each opening (the caller renders it only while open), so these start clean.
  const [values, setValues] = useState<StartValues>(() => ({ ...emptyStartValues(), ...initial }));
  const [clientStartId] = useState(() => newClientId('start'));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  /** OCR read a different number; the driver has not chosen yet. */
  const [ocrPrompt, setOcrPrompt] = useState<number | null>(null);
  /** The driver has chosen for this photo and reading; asking again would nag. */
  const [ocrSettled, setOcrSettled] = useState(false);
  /** Looking up the starting place — at once on opening, unless the values already carry one. */
  const [locatingPlace, setLocatingPlace] = useState(() => !initial?.startPlace);

  // The starting place, from the phone's position, once per opening — as a GPS trip's From fills
  // itself. Typing wins: an answer that arrives after the driver typed is dropped.
  useEffect(() => {
    if (initial?.startPlace) return undefined;
    let cancelled = false;
    void (async () => {
      const place = await placeName();
      if (cancelled) return;
      setValues((current) => (current.startPlace.trim() ? current : { ...current, startPlace: place }));
      setLocatingPlace(false);
    })();
    return () => {
      cancelled = true;
    };
    // Once per mount: the dialog is mounted afresh for each opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function locateHere() {
    setLocatingPlace(true);
    try {
      const place = await placeName();
      if (place) setValues((current) => ({ ...current, startPlace: place }));
    } finally {
      setLocatingPlace(false);
    }
  }

  const set = <K extends keyof StartValues>(key: K, value: StartValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => ({ ...current, [key]: '' }));
    if (key === 'startOdometerKm' || key === 'photo') {
      setOcrSettled(false);
      setOcrPrompt(null);
    }
  };

  const vehicle = vehicleOf(bootstrap, values.vehicleId);
  const purpose = bootstrap.purposes.find((entry) => entry.id === values.purposeId) ?? null;
  const errors = validate(values, bootstrap);
  const shown: Errors = attempted ? errors : {};
  const fieldError = (key: keyof Errors) => shown[key] || serverErrors[key] || undefined;

  const vehicleOptions = useMemo(
    () =>
      [...bootstrap.vehicles]
        .filter((entry) => !entry.busy || entry.id === values.vehicleId)
        .sort((a, b) => Number(b.assignedToMe) - Number(a.assignedToMe) || a.vehicleNumber.localeCompare(b.vehicleNumber))
        .map((entry) => ({
          value: entry.id,
          label: `${entry.vehicleNumber} · ${entry.vehicleType}`,
          hint: `${formatKm(entry.usedTodayKm)} of ${formatKm(entry.allowedTodayKm)} today${entry.assignedToMe ? ' · assigned to you' : ''}`,
        })),
    [bootstrap.vehicles, values.vehicleId],
  );
  const purposeOptions = bootstrap.purposes.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.requiresProject ? 'Billed to a project' : undefined }));
  const projectOptions = bootstrap.projects.map((project) => ({ value: project.id, label: project.code ? `${project.code} · ${project.name}` : project.name }));

  async function submit(choice?: { useOcr?: boolean }) {
    setAttempted(true);
    setFailure(null);
    let current = values;
    if (choice?.useOcr && ocrPrompt !== null) {
      current = { ...values, startOdometerKm: String(ocrPrompt) };
      setValues(current);
    }
    if (Object.keys(validate(current, bootstrap)).length) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailure('Starting a trip needs a connection — the vehicle is locked to you on the server. Once started, the trip records without one.');
      return;
    }
    setSubmitting(true);
    try {
      setStep('Checking location…');
      const located = await prepareLocation({ background: true });
      if (located.warning) toast({ title: 'Location', description: located.warning });

      if (!current.startPlace.trim() && located.position) {
        const place = await placeName(located.position);
        if (place) {
          current = { ...current, startPlace: place };
          setValues(current);
        }
      }

      setStep('Uploading the photo…');
      const uploaded = await ensureUploaded(current.photo as Blob, current.uploaded, current.vehicleId);
      current = { ...current, uploaded };
      setValues(current);

      const settled = ocrSettled || Boolean(choice);
      if (!settled && ocrDiffers(toNumber(current.startOdometerKm), uploaded.ocrKm)) {
        setOcrPrompt(uploaded.ocrKm);
        return;
      }
      setOcrPrompt(null);
      setOcrSettled(true);

      setStep('Starting…');
      const { trip } = await postStart(startBody(current, clientStartId, located.position, uploaded));
      toast({ title: 'Recording', description: `${trip.vehicleNumber} — keep the SEL Driver app open while you drive. The route records even without signal.` });
      onStarted(trip);
    } catch (error) {
      const over = overLimitFrom(error);
      if (over) {
        onOverLimit({ values: current, limit: over.limit, pendingApprovalId: over.pendingApprovalId, vehicleNumber: vehicle?.vehicleNumber ?? '' });
        return;
      }
      const code = refusalCode(error);
      const message =
        code === 'vehicle_busy'
          ? `${fleetErrorMessage(error)} Choose another vehicle, or ask the driver to end their trip.`
          : code === 'driver_busy'
            ? `${fleetErrorMessage(error)} Your running trip is on the Fleet Trip screen.`
            : fleetErrorMessage(error, 'The trip could not be started.');
      setServerErrors(fieldErrors(error));
      setFailure(message);
      toast({ variant: 'destructive', title: 'Trip not started', description: message });
    } finally {
      setSubmitting(false);
      setStep(null);
    }
  }

  const reading = toNumber(values.startOdometerKm);

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
      size="lg"
      title="Start a GPS trip"
      description="Company vehicle: choose it, say what the trip is for and photograph the odometer. The route records as you drive — billed to the project, not claimable."
      onSubmit={() => submit()}
      submitting={submitting}
      submitLabel={step ?? 'Start recording'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vehicle" required error={fieldError('vehicleId')} className="sm:col-span-2">
          <SearchSelect options={vehicleOptions} value={values.vehicleId || null} onChange={(value) => set('vehicleId', value ?? '')} placeholder="Choose the vehicle" invalid={Boolean(fieldError('vehicleId'))} />
        </Field>
        {vehicle && (
          <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <KmLimitMeter usedKm={vehicle.usedTodayKm} allowedKm={vehicle.allowedTodayKm} limitKm={vehicle.dailyKmLimit} expectedKm={toNumber(values.expectedKm) ?? undefined} compact />
          </div>
        )}

        <Field label="Date" htmlFor="fleet-start-date" hint="A GPS trip is dated by when it is driven.">
          <Input id="fleet-start-date" value={`Today, ${shortDateLabel(bootstrap.today, bootstrap.today)}`} disabled readOnly className="bg-white" />
        </Field>
        <Field label="Starting from" htmlFor="fleet-start-place" hint={locatingPlace ? 'Finding where you are…' : 'Filled from your location — change it if it is wrong.'}>
          <div className="flex min-w-0 gap-2">
            <Input id="fleet-start-place" value={values.startPlace} onChange={(event) => set('startPlace', event.target.value)} maxLength={200} placeholder={locatingPlace ? 'Locating…' : 'Where the trip starts'} className="min-w-0 flex-1 bg-white" />
            <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => void locateHere()} disabled={locatingPlace || submitting} aria-label="Use my current location" title="Use my current location">
              {locatingPlace ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </Field>

        <Field label="Purpose" required error={fieldError('purposeId')}>
          <SearchSelect options={purposeOptions} value={values.purposeId || null} onChange={(value) => set('purposeId', value ?? '')} placeholder="What is the trip for?" invalid={Boolean(fieldError('purposeId'))} />
        </Field>
        <Field label="Project" required={Boolean(purpose?.requiresProject)} error={fieldError('projectId')} hint={purpose?.requiresProject ? undefined : 'Leave empty for office or general running.'}>
          <SearchSelect options={projectOptions} value={values.projectId} onChange={(value) => set('projectId', value)} placeholder={purpose?.requiresProject ? 'Choose the project' : 'No project'} allowClear invalid={Boolean(fieldError('projectId'))} />
        </Field>
        {purpose?.requiresReason && (
          <Field label="What for" required error={fieldError('purposeReason')} htmlFor="fleet-start-reason" className="sm:col-span-2">
            <Input id="fleet-start-reason" value={values.purposeReason} onChange={(event) => set('purposeReason', event.target.value)} maxLength={300} placeholder="Say what the trip is for" className="bg-white" />
          </Field>
        )}

        <Field label="Expected distance (km)" required error={fieldError('expectedKm')} htmlFor="fleet-start-expected" hint="There and back, roughly — the daily limit is checked against it.">
          <Input id="fleet-start-expected" type="number" inputMode="decimal" min="0" step="1" value={values.expectedKm} onChange={(event) => set('expectedKm', event.target.value)} className="bg-white" />
        </Field>
        <Field
          label="Odometer now (km)"
          required
          error={fieldError('startOdometerKm')}
          htmlFor="fleet-start-odometer"
          hint={vehicle?.currentOdometerKm ? `Last recorded ${Math.round(vehicle.currentOdometerKm).toLocaleString('en-IN')} km` : 'Read it off the dashboard.'}
        >
          <Input id="fleet-start-odometer" type="number" inputMode="decimal" min="0" step="0.1" value={values.startOdometerKm} onChange={(event) => set('startOdometerKm', event.target.value)} className="bg-white" />
        </Field>

        <div className="min-w-0 sm:col-span-2">
          <PhotoCapture
            label="Odometer photo"
            value={values.photo}
            onChange={(blob) => set('photo', blob)}
            required
            disabled={submitting}
            hint={bootstrap.settings.ocrEnabled ? 'The whole odometer, sharp and readable — the reading is checked against it.' : 'The whole odometer, sharp and readable.'}
          />
          {fieldError('photo') && <p className="mt-1 text-xs text-destructive">{fieldError('photo')}</p>}
        </div>
      </div>

      {ocrPrompt !== null && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <ScanLine className="h-4 w-4" aria-hidden />
            The photo reads {ocrPrompt.toLocaleString('en-IN')} km
          </p>
          <p className="mt-0.5 text-xs">You typed {reading !== null ? reading.toLocaleString('en-IN') : '—'} km. Which is right?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void submit({ useOcr: true })} disabled={submitting}>
              Use {ocrPrompt.toLocaleString('en-IN')} km
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void submit({ useOcr: false })} disabled={submitting}>
              Keep {reading !== null ? reading.toLocaleString('en-IN') : 'mine'}
            </Button>
          </div>
        </div>
      )}

      {failure && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</p>}

      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Camera className="h-3 w-3 shrink-0" aria-hidden />
          The photo is kept with the trip; the reading is checked against GPS at the end.
        </span>
        <span className="flex items-center gap-1.5">
          <WifiOff className="h-3 w-3 shrink-0" aria-hidden />
          Starting needs a connection. After that the route records offline and syncs later.
        </span>
        {vehicle && (
          <span className="flex items-center gap-1.5">
            <Gauge className="h-3 w-3 shrink-0" aria-hidden />
            {vehicle.vehicleNumber}: {formatKm(Math.max(0, vehicle.allowedTodayKm - vehicle.usedTodayKm))} left today.
          </span>
        )}
      </div>
    </FormDialog>
  );
}
