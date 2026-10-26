'use client';

/**
 * Stop & review — ending a fleet trip the way a My Trips GPS trip is stopped: what was measured
 * first (distance, moving and stopped minutes, fixes, from → to), the place it ended (reverse-
 * geocoded from the last fix, editable), then the closing reading, photographed, and a remark if
 * anything happened. A company-vehicle trip is not claimable, so there is nothing to price — the
 * odometer and the route are what the project is billed on.
 *
 * The end must never be lost to a bad signal, which is exactly where trips end — a basement car
 * park, a site in the hills. So:
 *
 * - points still waiting on the phone are sent first (`flushQueue`), so the server measures the
 *   whole route rather than whatever arrived;
 * - offline, or if the request cannot reach the server, the end goes into the phone's queue with
 *   its photo and the time the driver pressed End, and syncs when the connection is back. The server
 *   takes the phone's end time, so a trip ended at 18:05 and synced at 19:30 still ended at 18:05;
 * - the end id is fixed for this opening, so a retry (or the queue) never ends a trip twice.
 *
 * What comes back is the server's verdict: billed km, or "waiting for review" and why.
 */

import { useEffect, useState } from 'react';
import { Building2, CloudUpload, Loader2, LocateFixed, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatKm, type FleetTrip } from '@/lib/fleet/types';
import { fleetErrorMessage, fleetFetch, newClientId } from '@/components/fleet/fleet-api';
import { enqueueEnd, flushQueue } from '@/components/fleet/offline-queue';
import { PhotoCapture } from '@/components/fleet/fleet-ui';
import { Field } from '@/components/driver-management/trips/trip-ui';
import type { LiveRecordingFigures } from '../live-recording-card';
import { ensureUploaded, fieldErrors, isNetworkFailure, ocrDiffers, placeName, quickPosition, refusalCode, toNumber, type TripPosition, type UploadedPhoto } from './start-helpers';

/** `stale`: the server already had an end for this trip — reload to see it. */
export type EndOutcome = { kind: 'ended'; trip: FleetTrip } | { kind: 'queued' } | { kind: 'stale' };

export function EndTripDialog({
  open,
  onOpenChange,
  trip,
  figures,
  lastPoint,
  onEnded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: FleetTrip;
  /** What the phone has measured — the GPS trip's tiles, shown for review and for the "about" hint. */
  figures: LiveRecordingFigures;
  /** The last fix, to name where the trip ended. */
  lastPoint: { lat: number; lng: number } | null;
  onEnded: (outcome: EndOutcome) => void;
}) {
  const liveKm = figures.distanceKm;
  const { toast } = useToast();
  const opening = trip.startOdometer.km;
  const [reading, setReading] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [uploaded, setUploaded] = useState<UploadedPhoto | null>(null);
  const [remark, setRemark] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [ocrPrompt, setOcrPrompt] = useState<number | null>(null);
  const [ocrSettled, setOcrSettled] = useState(false);
  const [clientEndId] = useState(() => newClientId('end'));
  /** When the driver first pressed End: the trip's end time, however late it syncs. */
  const [endedAt, setEndedAt] = useState<string | null>(null);
  const [endPlace, setEndPlace] = useState('');
  const [locatingPlace, setLocatingPlace] = useState(true);

  // Where it ended, named once on opening from the last fix (or a fresh one) — as a GPS trip names
  // its To. Typing wins over a late answer. The dialog is mounted afresh for each opening.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const place = await placeName(lastPoint);
      if (cancelled) return;
      setEndPlace((current) => (current.trim() ? current : place));
      setLocatingPlace(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function locateHere() {
    setLocatingPlace(true);
    try {
      const place = await placeName();
      if (place) setEndPlace(place);
    } finally {
      setLocatingPlace(false);
    }
  }

  const fromPlace = trip.startPlace || trip.startGeofenceName;

  const km = toNumber(reading);
  const readingError = attempted && (km === null || km < opening) ? (km === null ? 'Read the odometer.' : `Not below the opening reading (${opening.toLocaleString('en-IN')} km).`) : serverErrors.endOdometerKm || serverErrors.endOdometer || undefined;
  const photoError = attempted && !photo ? 'Photograph the odometer.' : undefined;
  const about = liveKm !== null && liveKm > 0 ? Math.round(opening + liveKm) : null;

  const queueIt = async (closing: number, at: string, position: TripPosition | null, ocrKm: number | null) => {
    await enqueueEnd(trip.id, { clientEndId, endOdometerKm: closing, photo: photo as Blob, ocrKm, position, endedAt: at, remark: remark.trim(), endPlace: endPlace.trim() });
    toast({ title: 'Saved on this phone', description: 'The trip end will sync as soon as there is a connection. You can close the app.' });
    onEnded({ kind: 'queued' });
  };

  async function submit(choice?: { useOcr?: boolean }) {
    setAttempted(true);
    setFailure(null);
    let closing = km;
    if (choice?.useOcr && ocrPrompt !== null) {
      closing = ocrPrompt;
      setReading(String(ocrPrompt));
    }
    if (closing === null || closing < opening || !photo) return;
    setSubmitting(true);
    const at = endedAt ?? new Date().toISOString();
    if (!endedAt) setEndedAt(at);
    let position: TripPosition | null = null;
    try {
      setStep('Reading location…');
      position = await quickPosition();
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await queueIt(closing, at, position, null);
        return;
      }

      setStep('Uploading the photo…');
      let photoUp: UploadedPhoto;
      try {
        photoUp = await ensureUploaded(photo, uploaded, trip.vehicleId);
      } catch (error) {
        if (isNetworkFailure(error)) {
          await queueIt(closing, at, position, null);
          return;
        }
        throw error;
      }
      setUploaded(photoUp);

      if (!(ocrSettled || choice) && ocrDiffers(closing, photoUp.ocrKm)) {
        setOcrPrompt(photoUp.ocrKm);
        return;
      }
      setOcrPrompt(null);
      setOcrSettled(true);

      setStep('Sending the route…');
      try {
        await flushQueue();
      } catch {
        // Points that cannot go yet go later; the server re-measures when they arrive.
      }

      setStep('Ending…');
      let ended: FleetTrip;
      try {
        ({ trip: ended } = await fleetFetch<{ trip: FleetTrip }>(`trips/${trip.id}/end`, {
          method: 'POST',
          body: { clientEndId, endOdometer: { km: closing, uploadId: photoUp.uploadId, ocrKm: photoUp.ocrKm }, position, endedAt: at, remark: remark.trim(), endPlace: endPlace.trim() },
        }));
      } catch (error) {
        if (isNetworkFailure(error)) {
          await queueIt(closing, at, position, photoUp.ocrKm);
          return;
        }
        throw error;
      }
      toast(
        ended.status === 'pending_review'
          ? { title: 'Trip ended — waiting for review', description: ended.review?.reason ?? 'A manager will settle the distance.' }
          : { title: 'Trip ended', description: `${formatKm(ended.billableDistanceKm)} billed${ended.flagCodes.length ? ' · flagged for a look' : ''}.` },
      );
      onEnded({ kind: 'ended', trip: ended });
    } catch (error) {
      if (refusalCode(error) === 'already_ended') {
        toast({ title: 'Already ended', description: 'This trip was ended earlier.' });
        onEnded({ kind: 'stale' });
        return;
      }
      setServerErrors(fieldErrors(error));
      const message = fleetErrorMessage(error, 'The trip could not be ended.');
      setFailure(message);
      toast({ variant: 'destructive', title: 'Trip not ended', description: message });
    } finally {
      setSubmitting(false);
      setStep(null);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !submitting && onOpenChange(next)}
      size="md"
      sheet
      title={`Stop & review — ${trip.vehicleNumber}`}
      description="Check what was measured, then read and photograph the odometer."
      onSubmit={() => submit()}
      submitting={submitting}
      submitLabel={step ?? 'End trip'}
    >
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Measured on this trip</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Distance', value: `${figures.distanceKm.toFixed(1)} km` },
            { label: 'Moving', value: `${Math.round(figures.movingMinutes)} min` },
            { label: 'Stopped', value: `${Math.round(figures.idleMinutes)} min` },
            { label: 'Fixes', value: String(figures.fixes) },
          ].map((tile) => (
            <div key={tile.label} className="min-w-0 rounded-lg border border-white/70 bg-white/80 px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
              <p className="text-base font-semibold tabular-nums text-slate-800">{tile.value}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 min-w-0 break-words text-xs text-slate-600">
          {fromPlace || 'Start'} → {endPlace.trim() || (locatingPlace ? 'locating…' : '—')}
        </p>
      </div>

      <Field label="Ending at" htmlFor="fleet-end-place" hint={locatingPlace ? 'Finding where the trip ended…' : 'Named from the last GPS fix — change it if it is wrong.'}>
        <div className="flex min-w-0 gap-2">
          <Input id="fleet-end-place" value={endPlace} onChange={(event) => setEndPlace(event.target.value)} maxLength={200} placeholder={locatingPlace ? 'Locating…' : 'Where the trip ended'} className="min-w-0 flex-1 bg-white" />
          <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => void locateHere()} disabled={locatingPlace || submitting} aria-label="Use my current location" title="Use my current location">
            {locatingPlace ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
      </Field>
      <Field
        label="Odometer now (km)"
        required
        error={readingError}
        htmlFor="fleet-end-odometer"
        hint={`Opening ${opening.toLocaleString('en-IN')} km${about !== null ? ` · GPS measured ${formatKm(liveKm)} — about ${about.toLocaleString('en-IN')}` : ''}`}
      >
        <Input
          id="fleet-end-odometer"
          type="number"
          inputMode="decimal"
          min={opening}
          step="0.1"
          value={reading}
          onChange={(event) => {
            setReading(event.target.value);
            setOcrSettled(false);
            setOcrPrompt(null);
          }}
          className="bg-white"
        />
      </Field>
      <div className="min-w-0">
        <PhotoCapture
          label="Odometer photo"
          value={photo}
          onChange={(blob) => {
            setPhoto(blob);
            setOcrSettled(false);
            setOcrPrompt(null);
          }}
          required
          disabled={submitting}
          hint="The whole odometer, sharp and readable."
        />
        {photoError && <p className="mt-1 text-xs text-destructive">{photoError}</p>}
      </div>
      <Field label="Remark" htmlFor="fleet-end-remark" hint="Anything the manager should know — a diversion, a breakdown, a long wait.">
        <Textarea id="fleet-end-remark" value={remark} onChange={(event) => setRemark(event.target.value)} rows={2} maxLength={500} placeholder="Optional" className="bg-white" />
      </Field>

      {ocrPrompt !== null && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <ScanLine className="h-4 w-4" aria-hidden />
            The photo reads {ocrPrompt.toLocaleString('en-IN')} km
          </p>
          <p className="mt-0.5 text-xs">You typed {km !== null ? km.toLocaleString('en-IN') : '—'} km. Which is right?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void submit({ useOcr: true })} disabled={submitting || ocrPrompt < opening}>
              Use {ocrPrompt.toLocaleString('en-IN')} km
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void submit({ useOcr: false })} disabled={submitting}>
              Keep {km !== null ? km.toLocaleString('en-IN') : 'mine'}
            </Button>
          </div>
        </div>
      )}

      {failure && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</p>}
      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Building2 className="mt-px h-3 w-3 shrink-0" aria-hidden />
        A company-vehicle trip is not claimable: it is billed to {trip.projectName || 'the project'}, not paid to the driver. Own-vehicle travel is recorded on the Own vehicle tab and claimed.
      </p>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CloudUpload className="h-3 w-3 shrink-0" aria-hidden />
        No signal? The end is saved on the phone and sent when you are back online.
      </p>
    </FormDialog>
  );
}
