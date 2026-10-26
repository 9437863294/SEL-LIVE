'use client';

/**
 * The three things a manager does to a fleet trip that is not theirs:
 *
 * - **Review** a trip waiting because GPS and the odometer disagree (or it was closed without a
 *   reading): bill the odometer, the GPS track, or a figure of their own with a note saying how.
 * - **Force-close** a trip the driver left running. With a closing reading the trip settles as any
 *   other; without one the GPS km stand and the trip comes back for review — a person closing it
 *   without seeing the meter is not a measurement.
 * - **Resolve** an exception (a flagged trip or fuel entry) with a note of what was found.
 *
 * Shared by the approvals inbox, the Exceptions screen and the trip detail. Nobody settles their own
 * trip; the server refuses it, and these dialogs are only offered for other people's.
 */

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useFleet } from '@/components/fleet/fleet-provider';
import { Field } from '@/components/driver-management/trips/trip-ui';
import { useToast } from '@/hooks/use-toast';
import { formatKm, round1, type BillableSource, type FleetTrip } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';

const kmText = (value: number | null | undefined) => (value === null || value === undefined ? '—' : formatKm(value));

/** The allowed gap between GPS and odometer, when the fleet's thresholds are known on this page. */
function toleranceFor(odoKm: number | null, thresholds: { mismatchAbsKm: number; mismatchPct: number } | null): number | null {
  if (!thresholds || odoKm === null) return null;
  return round1(Math.max(thresholds.mismatchAbsKm, (odoKm * thresholds.mismatchPct) / 100));
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'muted' | 'warn' }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-base font-semibold tabular-nums', tone === 'warn' ? 'text-amber-700' : tone === 'muted' ? 'text-slate-500' : 'text-slate-900')}>{value}</p>
    </div>
  );
}

/* ── review ─────────────────────────────────────────────────────────────── */

export function ReviewTripDialog({ trip, open, onOpenChange, onDone }: { trip: FleetTrip; open: boolean; onOpenChange: (open: boolean) => void; onDone: (trip: FleetTrip) => void }) {
  const { toast } = useToast();
  const fleet = useFleet();
  const thresholds = fleet.data?.settings ?? null;
  const hasOdo = trip.odoDistanceKm !== null;
  const hasGps = trip.gpsDistanceKm > 0;
  const firstChoice: BillableSource = hasOdo ? 'odometer' : hasGps ? 'gps' : 'manager';

  const [choice, setChoice] = useState<BillableSource>(firstChoice);
  const [km, setKm] = useState('');
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // A fresh form each time the dialog opens or switches trip (adjusted during render, not in an effect).
  const session = open ? trip.id : null;
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (session) {
      setChoice(firstChoice);
      setKm('');
      setNote('');
      setAttempted(false);
    }
  }

  const diff = hasOdo && hasGps ? round1(Math.abs(trip.gpsDistanceKm - (trip.odoDistanceKm as number))) : null;
  const tolerance = toleranceFor(trip.odoDistanceKm, thresholds);
  const typedKm = km.trim() === '' ? null : Number(km);
  const kmError = attempted && choice === 'manager' && (typedKm === null || !Number.isFinite(typedKm) || typedKm < 0 || typedKm > 2000) ? 'Enter the km to bill (0 to 2,000).' : undefined;
  const noteError = attempted && choice === 'manager' && !note.trim() ? 'Say how the km were worked out.' : undefined;
  const billed = choice === 'odometer' ? trip.odoDistanceKm : choice === 'gps' ? trip.gpsDistanceKm : typedKm !== null && Number.isFinite(typedKm) ? typedKm : null;

  async function submit() {
    setAttempted(true);
    if (choice === 'manager' && (typedKm === null || !Number.isFinite(typedKm) || typedKm < 0 || typedKm > 2000 || !note.trim())) return;
    setSubmitting(true);
    try {
      const result = await fleetFetch<{ trip: FleetTrip }>(`trips/${trip.id}/review`, { method: 'POST', body: { choice, km: choice === 'manager' ? typedKm : null, note } });
      toast({ title: 'Trip reviewed', description: `${trip.vehicleNumber}: ${kmText(result.trip.billableDistanceKm)} billed.` });
      onDone(result.trip);
      onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Review not saved', description: fleetErrorMessage(error, 'The review could not be saved.') });
    } finally {
      setSubmitting(false);
    }
  }

  const options: Array<{ value: BillableSource; label: string; detail: string; disabled: boolean }> = [
    { value: 'odometer', label: 'Bill the odometer', detail: hasOdo ? kmText(trip.odoDistanceKm) : 'No closing reading', disabled: !hasOdo },
    { value: 'gps', label: 'Bill the GPS track', detail: hasGps ? kmText(trip.gpsDistanceKm) : 'No usable track', disabled: !hasGps },
    { value: 'manager', label: 'Enter the km myself', detail: 'With a note saying how', disabled: false },
  ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Review trip · ${trip.vehicleNumber}`}
      description={`${trip.driverName} · ${trip.dateKey}${trip.projectName ? ` · ${trip.projectName}` : ''}. Pick the distance to bill.`}
      onSubmit={submit}
      submitting={submitting}
      submitLabel={billed !== null ? `Bill ${kmText(billed)}` : 'Save review'}
    >
      {trip.review?.reason && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{trip.review.reason}</p>}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Figure label="Odometer" value={kmText(trip.odoDistanceKm)} tone={hasOdo ? undefined : 'muted'} />
        <Figure label="GPS" value={kmText(hasGps ? trip.gpsDistanceKm : null)} tone={hasGps ? undefined : 'muted'} />
        <Figure label="Difference" value={kmText(diff)} tone={diff !== null && tolerance !== null && diff > tolerance ? 'warn' : undefined} />
        <Figure label="Allowed" value={kmText(tolerance)} tone="muted" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Readings {trip.startOdometer.km.toLocaleString('en-IN')} → {trip.endOdometer ? trip.endOdometer.km.toLocaleString('en-IN') : 'not taken'} · {trip.pointCount} GPS fixes
        {trip.gapCount ? ` · ${trip.gapCount} gap${trip.gapCount === 1 ? '' : 's'} in tracking` : ''}.{' '}
        <Link href={`/driver-management/fleet/trips/${trip.id}`} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">
          Open the trip and its map
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </p>

      <RadioGroup value={choice} onValueChange={(value) => setChoice(value as BillableSource)} className="gap-2" aria-label="Distance to bill">
        {options.map((option) => (
          <Label
            key={option.value}
            htmlFor={`review-${option.value}`}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-normal transition-colors',
              choice === option.value ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:bg-slate-50',
              option.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <RadioGroupItem id={`review-${option.value}`} value={option.value} disabled={option.disabled} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-slate-800">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.detail}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>

      {choice === 'manager' && (
        <Field label="Km to bill" required error={kmError} htmlFor="review-km">
          <Input id="review-km" type="number" inputMode="decimal" step="0.1" min="0" max="2000" value={km} onChange={(event) => setKm(event.target.value)} className="bg-white" aria-invalid={Boolean(kmError)} />
        </Field>
      )}
      <Field label="Note" required={choice === 'manager'} error={noteError} htmlFor="review-note" hint="Kept on the trip and shown to the driver.">
        <Textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder={choice === 'manager' ? 'e.g. Route checked on the map: 38 km via the bypass' : 'Optional'} className="bg-white" aria-invalid={Boolean(noteError)} />
      </Field>
    </FormDialog>
  );
}

/* ── force-close ────────────────────────────────────────────────────────── */

export function ForceCloseDialog({ trip, open, onOpenChange, onDone }: { trip: FleetTrip; open: boolean; onOpenChange: (open: boolean) => void; onDone: (trip: FleetTrip) => void }) {
  const { toast } = useToast();
  const [reading, setReading] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const session = open ? trip.id : null;
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (session) {
      setReading('');
      setReason('');
      setAttempted(false);
    }
  }

  const endKm = reading.trim() === '' ? null : Number(reading);
  const readingError = attempted && endKm !== null && (!Number.isFinite(endKm) || endKm < trip.startOdometer.km) ? `At or above the opening reading (${trip.startOdometer.km.toLocaleString('en-IN')}).` : undefined;
  const reasonError = attempted && reason.trim().length < 5 ? 'Say why the trip is being closed.' : undefined;

  async function submit() {
    setAttempted(true);
    if ((endKm !== null && (!Number.isFinite(endKm) || endKm < trip.startOdometer.km)) || reason.trim().length < 5) return;
    setSubmitting(true);
    try {
      const result = await fleetFetch<{ trip: FleetTrip }>(`trips/${trip.id}/force-close`, { method: 'POST', body: { endOdometerKm: endKm, reason: reason.trim() } });
      toast({
        title: 'Trip closed',
        description: result.trip.status === 'pending_review' ? `${trip.vehicleNumber} is free again. The trip waits for review.` : `${trip.vehicleNumber} is free again: ${kmText(result.trip.billableDistanceKm)} billed.`,
      });
      onDone(result.trip);
      onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Trip not closed', description: fleetErrorMessage(error, 'The trip could not be closed.') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Close trip · ${trip.vehicleNumber}`}
      description={`${trip.driverName} started it ${trip.startedAt.slice(0, 10)} and never ended it. Closing it frees the vehicle for the next trip.`}
      onSubmit={submit}
      submitting={submitting}
      submitLabel="Close trip"
    >
      <Field
        label="Closing odometer reading"
        error={readingError}
        htmlFor="force-reading"
        hint={`Opening reading ${trip.startOdometer.km.toLocaleString('en-IN')} km${trip.gpsDistanceKm > 0 ? ` · GPS so far ${formatKm(trip.gpsDistanceKm)}` : ''}. Leave blank if nobody has read the meter.`}
      >
        <Input id="force-reading" type="number" inputMode="decimal" step="0.1" min={trip.startOdometer.km} value={reading} onChange={(event) => setReading(event.target.value)} className="bg-white" aria-invalid={Boolean(readingError)} />
      </Field>
      <p className={cn('rounded-lg border p-3 text-xs', endKm === null ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700')}>
        {endKm === null
          ? 'Without a closing reading the GPS km stand and the trip goes to review, where a manager picks the figure to bill.'
          : 'With a reading the trip settles as any other: the odometer is billed when GPS agrees with it, otherwise it goes to review.'}
      </p>
      <Field label="Reason" required error={reasonError} htmlFor="force-reason">
        <Textarea id="force-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={500} placeholder="e.g. Driver's phone died; vehicle back in the yard since 6 pm" className="bg-white" aria-invalid={Boolean(reasonError)} />
      </Field>
    </FormDialog>
  );
}

/* ── resolve ────────────────────────────────────────────────────────────── */

export function ResolveExceptionDialog({ kind, id, label, open, onOpenChange, onDone }: { kind: 'trip' | 'fuel'; id: string; label: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const session = open ? `${kind}:${id}` : null;
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (session) {
      setNote('');
      setAttempted(false);
    }
  }

  const noteError = attempted && note.trim().length < 3 ? 'Add a note on what was found.' : undefined;

  async function submit() {
    setAttempted(true);
    if (note.trim().length < 3) return;
    setSubmitting(true);
    try {
      await fleetFetch('exceptions/resolve', { method: 'POST', body: { kind, id, note: note.trim() } });
      toast({ title: 'Exception resolved', description: label });
      onDone();
      onOpenChange(false);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Not resolved', description: fleetErrorMessage(error, 'The exception could not be resolved.') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={kind === 'trip' ? 'Resolve trip exception' : 'Resolve fuel exception'}
      description={`${label}. The flags stay on the record; resolving says someone looked and what they found.`}
      onSubmit={submit}
      submitting={submitting}
      submitLabel="Resolve"
    >
      <Field label="What was found" required error={noteError} htmlFor="resolve-note">
        <Textarea
          id="resolve-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder={kind === 'trip' ? 'e.g. Phone lost signal in the tunnel; route checked and fine' : 'e.g. Bill checked with the pump; long idle at site explains the mileage'}
          className="bg-white"
          aria-invalid={Boolean(noteError)}
        />
      </Field>
    </FormDialog>
  );
}
