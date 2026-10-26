'use client';

/**
 * Stop & review for an own-vehicle GPS trip — the same review a company-vehicle trip gets (fleet
 * end-trip-dialog.tsx), priced at the rate card's per-km rate and saved to My Trips, ready to claim.
 *
 * What was measured comes first (distance, moving, stopped, fixes, from → to), then only what the
 * employee can add: where it ended (named from the last fix, editable), the closing odometer when
 * Trip rules require readings (with the GPS figure beside it) or else the distance (the measured one,
 * correctable), toll and parking when allowed, and a note. The amount is worked out as they type, by
 * the same rules the server applies (`validateTrip`, `priceTrip`); the measurement is saved beside
 * the figures as the trip's GPS evidence, so an approver can tell a measured trip from a typed one.
 *
 * Closing it without saving discards the recording — asked first, because a driven trip lost is
 * worse than a dialog that asks twice.
 */

import { useState } from 'react';
import { Loader2, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { placeName } from '@/components/driver-management/fleet/start-helpers';
import { formatINR, odometerDistance, priceTrip, rateFor } from '@/lib/employee-trips/rates';
import { validateTrip, type TripErrors, type TripInput } from '@/lib/employee-trips/trips';
import { formatKm, type TripGpsEvidence, type TripRecord } from '@/lib/employee-trips/types';
import { TripApiError, errorMessage, tripFetch, type Bootstrap } from './trip-api';
import { Field } from './trip-ui';

/** The recording, as the recorder hands it over at Stop. */
export interface OwnReview {
  gps: TripGpsEvidence;
  tripDate: string;
  vehicleType: string;
  vehicleNumber: string;
  fromPlace: string;
  /** Reverse-geocoded from the last fix; empty when that failed. */
  toPlace: string;
  purpose: string;
  projectId: string | null;
  departmentId: string | null;
  /** Taken at the start when Trip rules require readings. */
  startOdometer: string | null;
  notes: string;
  /** Moving and stopped minutes, for the summary. */
  movingMinutes: number;
  idleMinutes: number;
}

const toNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function OwnReviewDialog({
  open,
  data,
  review,
  onDiscard,
  onSaved,
}: {
  open: boolean;
  data: Bootstrap;
  review: OwnReview;
  /** Closing without saving: the recording is dropped. */
  onDiscard: () => void;
  onSaved: (trip: TripRecord) => void;
}) {
  const { toast } = useToast();
  const rules = data.settings.rules;
  const measuredKm = review.gps.measuredKm;
  const opening = review.startOdometer !== null ? toNumber(review.startOdometer) : null;

  const [toPlace, setToPlace] = useState(review.toPlace);
  const [locating, setLocating] = useState(false);
  const [closing, setClosing] = useState('');
  const [distance, setDistance] = useState(String(measuredKm));
  const [toll, setToll] = useState('');
  const [parking, setParking] = useState('');
  const [notes, setNotes] = useState(review.notes);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<TripErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function locateHere() {
    setLocating(true);
    try {
      const place = await placeName();
      if (place) setToPlace(place);
    } finally {
      setLocating(false);
    }
  }

  const useReadings = rules.requireOdometer && opening !== null;
  const input: Partial<TripInput> = {
    tripDate: review.tripDate,
    ownership: 'own',
    vehicleType: review.vehicleType,
    vehicleNumber: review.vehicleNumber,
    vehicleId: null,
    fromPlace: review.fromPlace,
    toPlace,
    purpose: review.purpose,
    startOdometer: useReadings ? opening : null,
    endOdometer: useReadings ? toNumber(closing) : null,
    distanceKm: useReadings ? null : toNumber(distance),
    projectId: review.projectId,
    departmentId: review.departmentId,
    tollAmount: toNumber(toll) ?? 0,
    parkingAmount: toNumber(parking) ?? 0,
    notes,
  };
  const check = validateTrip(input, { rules, today: data.today, companyVehicle: null });
  const errors: TripErrors = attempted ? { ...serverErrors, ...(check.ok ? {} : check.errors) } : {};

  const km = useReadings ? odometerDistance(opening, toNumber(closing)) : Math.max(0, Math.round((toNumber(distance) ?? 0) * 10) / 10);
  const rate = rateFor(data.settings.rateRevisions, review.tripDate, review.vehicleType, 'own');
  const pricing = priceTrip({ distanceKm: km, ratePerKm: rate.ratePerKm, tollAmount: toNumber(toll) ?? 0, parkingAmount: toNumber(parking) ?? 0, allowTollParking: rules.allowTollParking });
  const about = opening !== null ? Math.round(opening + measuredKm) : null;

  async function save() {
    setAttempted(true);
    setServerErrors({});
    if (!check.ok) return;
    setSaving(true);
    try {
      const result = await tripFetch<{ trip: TripRecord }>('trips', { method: 'POST', body: { ...input, gps: review.gps } });
      toast({ title: 'Trip saved to My Trips', description: `${formatKm(result.trip.distanceKm)} · ${formatINR(result.trip.totalAmount)} — claim it from My Trips.` });
      onSaved(result.trip);
    } catch (error) {
      if (error instanceof TripApiError && Object.keys(error.fields).length) setServerErrors(error.fields as TripErrors);
      toast({ variant: 'destructive', title: 'Trip not saved', description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          if (next || saving) return;
          setConfirmDiscard(true);
        }}
        size="md"
        title={`Stop & review — ${review.vehicleNumber}`}
        description="Check what was measured, add where it ended, and save it to My Trips to claim."
        onSubmit={() => save()}
        submitting={saving}
        submitLabel="Save trip"
        cancelLabel="Discard"
      >
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Measured on this trip</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Distance', value: `${measuredKm.toFixed(1)} km` },
              { label: 'Moving', value: `${Math.round(review.movingMinutes)} min` },
              { label: 'Stopped', value: `${Math.round(review.idleMinutes)} min` },
              { label: 'Fixes', value: String(review.gps.fixes) },
            ].map((tile) => (
              <div key={tile.label} className="min-w-0 rounded-lg border border-white/70 bg-white/80 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{tile.label}</p>
                <p className="text-base font-semibold tabular-nums text-slate-800">{tile.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 min-w-0 break-words text-xs text-slate-600">
            {review.fromPlace || 'Start'} → {toPlace.trim() || (locating ? 'locating…' : '—')}
          </p>
        </div>

        <Field label="Ending at" required error={errors.toPlace} htmlFor="own-end-place" hint="Named from the last GPS fix — change it if it is wrong.">
          <div className="flex min-w-0 gap-2">
            <Input id="own-end-place" value={toPlace} onChange={(event) => setToPlace(event.target.value)} maxLength={200} placeholder="Where the trip ended" className="min-w-0 flex-1 bg-white" />
            <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => void locateHere()} disabled={locating || saving} aria-label="Use my current location" title="Use my current location">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </Field>

        {useReadings ? (
          <Field
            label="Odometer now (km)"
            required
            error={errors.endOdometer ?? errors.distance}
            htmlFor="own-end-odometer"
            hint={`Opening ${(opening as number).toLocaleString('en-IN')} km${about !== null ? ` · GPS measured ${formatKm(measuredKm)} — about ${about.toLocaleString('en-IN')}` : ''}`}
          >
            <Input id="own-end-odometer" type="number" inputMode="decimal" min={opening ?? 0} step="0.1" value={closing} onChange={(event) => setClosing(event.target.value)} placeholder={about !== null ? String(about) : undefined} className="bg-white" />
          </Field>
        ) : (
          <Field label="Distance (km)" required error={errors.distance} htmlFor="own-end-distance" hint={`Measured by GPS: ${formatKm(measuredKm)}. Correct it only if the measurement is wrong.`}>
            <Input id="own-end-distance" type="number" inputMode="decimal" min="0" step="0.1" value={distance} onChange={(event) => setDistance(event.target.value)} className="bg-white" />
          </Field>
        )}

        {rules.allowTollParking && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Toll (₹)" error={errors.tollAmount} htmlFor="own-end-toll">
              <Input id="own-end-toll" type="number" inputMode="decimal" min="0" step="1" value={toll} onChange={(event) => setToll(event.target.value)} placeholder="0" className="bg-white" />
            </Field>
            <Field label="Parking (₹)" error={errors.parkingAmount} htmlFor="own-end-parking">
              <Input id="own-end-parking" type="number" inputMode="decimal" min="0" step="1" value={parking} onChange={(event) => setParking(event.target.value)} placeholder="0" className="bg-white" />
            </Field>
          </div>
        )}

        <Field label="Note" htmlFor="own-end-note">
          <Textarea id="own-end-note" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} maxLength={500} placeholder="Optional" className="bg-white" />
        </Field>

        <div className="flex items-baseline justify-between gap-3 rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5">
          <p className="text-xs text-teal-900">
            {formatKm(km)}
            {rate.ratePerKm !== null ? ` × ₹${rate.ratePerKm}/km` : ' · no per-km rate set'}
            {pricing.totalAmount > pricing.distanceAmount ? ' + toll & parking' : ''}
          </p>
          <p className="text-lg font-semibold tabular-nums text-teal-900">{formatINR(pricing.totalAmount)}</p>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this trip?"
        description="The route you just drove is not saved anywhere else. Discard it only if the trip should not be claimed."
        confirmLabel="Discard"
        cancelLabel="Keep reviewing"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard();
        }}
      />
    </>
  );
}
