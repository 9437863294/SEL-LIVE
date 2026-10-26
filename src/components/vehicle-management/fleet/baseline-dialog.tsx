'use client';

/**
 * Reset a vehicle's odometer: a new baseline when the meter was replaced, the cluster repaired or
 * the reading rolled over.
 *
 * Trips refuse an opening reading below the vehicle's last one — the odometer never runs backwards —
 * so a lower reading can only come from here, with a reason, by someone with Fleet Settings · Edit.
 * The next trip from the baseline is flagged so its approver sees why. Not possible while a trip is
 * running on the vehicle: its opening reading belongs to the old meter.
 */

import { useState } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormDialog } from '@/components/shared/form-dialog';
import { Field } from '@/components/driver-management/trips/trip-ui';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { PhotoCapture } from '@/components/fleet/fleet-ui';
import { uploadFleetPhoto } from '@/components/fleet/photo';
import { useToast } from '@/hooks/use-toast';
import type { FleetVehicle, OdometerBaseline } from '@/lib/fleet/types';
import { fieldErrorsOf } from './fleet-masters';

const km = (value: number | null) => (value === null ? '—' : `${Math.round(value).toLocaleString('en-IN')} km`);

export function BaselineDialog({ open, onOpenChange, vehicle, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; vehicle: FleetVehicle | null; onSaved: () => void }) {
  const { toast } = useToast();
  const [reading, setReading] = useState('');
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const session = open && vehicle ? `open:${vehicle.id}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open) {
      setReading('');
      setReason('');
      setPhoto(null);
      setErrors({});
    }
  }

  if (!vehicle) return null;
  const running = Boolean(vehicle.currentTripId);
  const history = [...vehicle.odometerBaselineHistory].reverse().slice(0, 3);

  async function submit() {
    if (!vehicle || running) return;
    const value = Number(reading);
    const invalid: Record<string, string> = {};
    if (reading.trim() === '' || !Number.isFinite(value) || value < 0) invalid.km = 'Enter the reading the meter shows now.';
    if (reason.trim().length < 5) invalid.reason = 'Say why — meter replaced, cluster repaired, rolled over…';
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return;
    }
    setSaving(true);
    try {
      const uploadId = photo ? (await uploadFleetPhoto(photo, 'baseline', vehicle.id)).uploadId : null;
      await fleetFetch<{ baseline: OdometerBaseline }>(`vehicles/${vehicle.id}/baseline`, { method: 'POST', body: { km: value, reason: reason.trim(), uploadId } });
      toast({ title: `${vehicle.vehicleNumber} odometer reset`, description: `The next trip starts from ${km(value)}.` });
      onSaved();
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setErrors(fields);
      toast({ variant: 'destructive', title: 'Not reset', description: fleetErrorMessage(failure, 'The odometer could not be reset.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={`Reset the odometer of ${vehicle.vehicleNumber}`}
      description={`Last reading on record: ${km(vehicle.currentOdometerKm)}. Trips cannot start below it; a new baseline allows a lower reading.`}
      onSubmit={submit}
      submitting={saving}
      submitDisabled={running}
      submitLabel="Set baseline"
    >
      {running && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>A trip is running on this vehicle. It must be ended (or closed by a manager) before the odometer can be reset.</span>
        </div>
      )}
      <Field label="Reading now (km)" required error={errors.km} htmlFor="baseline-km" hint="Exactly what the meter shows.">
        <Input id="baseline-km" type="number" inputMode="decimal" min="0" step="any" value={reading} onChange={(event) => setReading(event.target.value)} disabled={running} className="bg-white tabular-nums" aria-invalid={Boolean(errors.km)} />
      </Field>
      <Field label="Reason" required error={errors.reason} htmlFor="baseline-reason">
        <Textarea id="baseline-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} disabled={running} placeholder="e.g. Instrument cluster replaced at the dealer on 24 Oct; old meter read 48,210 km." className="bg-white" />
      </Field>
      <PhotoCapture label="Photo of the meter" value={photo} onChange={setPhoto} disabled={running} hint="Optional, but it is what an auditor will ask for." />
      {history.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <History className="h-3.5 w-3.5" aria-hidden />
            Earlier resets
          </p>
          <ul className="space-y-1 text-xs text-slate-600">
            {history.map((entry) => (
              <li key={`${entry.at}-${entry.km}`}>
                {entry.at.slice(0, 10)}: {km(entry.previousKm)} → {km(entry.km)} by {entry.byName || 'someone'} — {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormDialog>
  );
}
