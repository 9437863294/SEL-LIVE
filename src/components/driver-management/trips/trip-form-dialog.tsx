'use client';

/**
 * Record or edit a trip. The figures update as the employee types — distance from the odometer,
 * the rate the company set for this vehicle on this date, toll and parking — using the same rules
 * the server applies on save, so what the dialog shows is what gets recorded.
 *
 * Prefills that save typing: the opening reading from the vehicle's last logged trip, the employee's
 * own vehicles from their earlier trips, and "Save & add next", which starts the next leg where this
 * one ended (same date, vehicle and project).
 */

import { useMemo, useState } from 'react';
import { Building2, Car, Loader2, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DialogClose } from '@/components/ui/dialog';
import { FormDialog } from '@/components/shared/form-dialog';
import { useToast } from '@/hooks/use-toast';
import { formatINR, odometerDistance, ownVehicleTypes, priceTrip, rateFor } from '@/lib/employee-trips/rates';
import { daysLeftToClaim, validateTrip, type TripErrors, type TripInput } from '@/lib/employee-trips/trips';
import { formatKm, normaliseVehicleNumber, type TripGpsEvidence, type TripRecord, type VehicleOwnership } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import { getCurrentDriverPosition } from '@/lib/driver-mobile-geolocation';
import { TripApiError, errorMessage, reverseGeocode, tripFetch, type Bootstrap } from './trip-api';
import { Field, Money, SearchSelect } from './trip-ui';

interface FormState {
  tripDate: string;
  ownership: VehicleOwnership;
  vehicleType: string;
  vehicleNumber: string;
  vehicleId: string | null;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  /** null until typed: the vehicle's last logged reading is offered in its place. */
  startOdometer: string | null;
  endOdometer: string;
  distanceKm: string;
  useDistance: boolean;
  projectId: string | null;
  departmentId: string | null;
  tollAmount: string;
  parkingAmount: string;
  notes: string;
}

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value));
const toNumber = (value: string): number | null => (value.trim() === '' ? null : Number(value));

/**
 * The form’s opening values.
 *
 * `prefill` is what a GPS recording hands over — the measured distance and the places it
 * reverse-geocoded — applied last so it wins over the suggestions drawn from previous trips.
 * It is still an ordinary editable form: the employee confirms a measured figure, they do not
 * merely witness it.
 */
function initialState(
  data: Bootstrap,
  trip: TripRecord | null,
  myTrips: TripRecord[],
  prefill?: Partial<FormState>,
): FormState {
  const withPrefill = (state: FormState): FormState => ({ ...state, ...prefill });
  if (trip) {
    return withPrefill({
      tripDate: trip.tripDate,
      ownership: trip.ownership,
      vehicleType: trip.vehicleType,
      vehicleNumber: trip.vehicleNumber,
      vehicleId: trip.vehicleId,
      fromPlace: trip.fromPlace,
      toPlace: trip.toPlace,
      purpose: trip.purpose,
      startOdometer: numberText(trip.startOdometer),
      endOdometer: numberText(trip.endOdometer),
      distanceKm: numberText(trip.distanceKm),
      useDistance: trip.startOdometer === null && !data.settings.rules.requireOdometer,
      projectId: trip.projectId,
      departmentId: trip.departmentId,
      tollAmount: trip.tollAmount ? String(trip.tollAmount) : '',
      parkingAmount: trip.parkingAmount ? String(trip.parkingAmount) : '',
      notes: trip.notes,
    });
  }
  // A new trip starts from the employee's last one: same kind of vehicle, same project.
  const last = myTrips[0];
  const rules = data.settings.rules;
  const ownership: VehicleOwnership = last && (last.ownership === 'own' ? rules.allowOwnVehicle : rules.allowCompanyVehicle) ? last.ownership : rules.allowOwnVehicle ? 'own' : 'company';
  const sameKind = last?.ownership === ownership ? last : null;
  return withPrefill({
    tripDate: data.today,
    ownership,
    vehicleType: sameKind?.ownership === 'own' ? sameKind.vehicleType : '',
    vehicleNumber: sameKind?.ownership === 'own' ? sameKind.vehicleNumber : '',
    vehicleId: sameKind?.ownership === 'company' && data.vehicles.some((vehicle) => vehicle.id === sameKind.vehicleId) ? sameKind.vehicleId : null,
    fromPlace: '',
    toPlace: '',
    purpose: '',
    startOdometer: null,
    endOdometer: '',
    distanceKm: '',
    useDistance: false,
    projectId: last?.projectId && data.projects.some((project) => project.id === last.projectId) ? last.projectId : null,
    departmentId: last?.departmentId && data.departments.some((department) => department.id === last.departmentId) ? last.departmentId : null,
    tollAmount: '',
    parkingAmount: '',
    notes: '',
  });
}

export function TripFormDialog({
  open,
  onOpenChange,
  data,
  trip,
  myTrips,
  onSaved,
  prefill,
  gps,
  mode = 'save',
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Bootstrap;
  /** The trip to edit, or null to record a new one. */
  trip: TripRecord | null;
  /** The employee's trips, newest first — for prefills and own-vehicle suggestions. */
  myTrips: TripRecord[];
  onSaved: (trip: TripRecord) => void;
  /** Opening values from a GPS recording. Editable like any other. */
  prefill?: Partial<FormState>;
  /**
   * `gps-start` collects the trip up front and hands it back instead of saving.
   *
   * The same dialog rather than a second one, because the question “what does a trip need” has
   * one answer. A separate start sheet drifted from this form the moment either changed, and it
   * already looked and sized differently.
   */
  mode?: 'save' | 'gps-start';
  /** Called in `gps-start` mode with what was entered. */
  onStart?: (values: {
    ownership: VehicleOwnership;
    vehicleType: string;
    vehicleNumber: string;
    vehicleId: string | null;
    tripDate: string;
    fromPlace: string;
    purpose: string;
    projectId: string | null;
    departmentId: string | null;
    startOdometer: string | null;
    notes: string;
  }) => void;
  /** Measured evidence, saved beside the claimed figures so an approver can weigh them. */
  gps?: TripGpsEvidence;
}) {
  const { toast } = useToast();
  const rules = data.settings.rules;
  const [form, setForm] = useState<FormState>(() => initialState(data, trip, myTrips, prefill));
  const [errors, setErrors] = useState<TripErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState<false | 'save' | 'next'>(false);
  const [locating, setLocating] = useState(false);

  /**
   * Put the device's current place in the From box.
   *
   * Silent on failure beyond clearing the spinner: location can be refused, unavailable indoors,
   * or simply slow, and none of those should interrupt somebody filling in a form they can
   * perfectly well complete by typing.
   */
  const fillFromCurrentLocation = async () => {
    setLocating(true);
    try {
      const position = await getCurrentDriverPosition();
      const place = await reverseGeocode(position.coords.latitude, position.coords.longitude);
      if (place) setForm((current) => ({ ...current, fromPlace: place }));
    } catch {
      // Nothing to say: the field is still there to type in.
    } finally {
      setLocating(false);
    }
  };

  // A fresh form whenever the dialog opens or switches trip (adjusted during render, not in an
  // effect). Later refreshes of the trip list must not wipe what is being typed.
  const session = open ? `open:${trip?.id ?? 'new'}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open) {
      setForm(initialState(data, trip, myTrips, prefill));
      // Starting a GPS trip means starting it here, so the From box fills itself rather than
      // asking the driver to name a place their phone already knows.
      if (mode === 'gps-start' && !prefill?.fromPlace) void fillFromCurrentLocation();
      setErrors({});
      setAttempted(false);
    }
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const companyVehicle = form.ownership === 'company' ? data.vehicles.find((vehicle) => vehicle.id === form.vehicleId) ?? null : null;
  const vehicleType = form.ownership === 'company' ? companyVehicle?.vehicleType ?? '' : form.vehicleType;
  const vehicleNumber = form.ownership === 'company' ? normaliseVehicleNumber(companyVehicle?.vehicleNumber) : normaliseVehicleNumber(form.vehicleNumber);

  // The vehicle's last known closing reading, offered as this trip's opening one.
  const lastReading = useMemo(() => {
    if (form.ownership === 'company' && companyVehicle) {
      return data.odometer[companyVehicle.id]?.km ?? companyVehicle.currentOdometerKm ?? null;
    }
    if (form.ownership === 'own' && vehicleNumber) {
      return myTrips.find((entry) => entry.id !== trip?.id && entry.vehicleNumber === vehicleNumber && entry.endOdometer !== null)?.endOdometer ?? null;
    }
    return null;
  }, [companyVehicle, data.odometer, form.ownership, myTrips, trip?.id, vehicleNumber]);

  const startText = form.startOdometer ?? (lastReading !== null && !trip ? String(lastReading) : '');

  const input: Partial<TripInput> = {
    tripDate: form.tripDate,
    ownership: form.ownership,
    vehicleType: form.vehicleType,
    vehicleNumber: form.vehicleNumber,
    vehicleId: form.vehicleId,
    fromPlace: form.fromPlace,
    toPlace: form.toPlace,
    purpose: form.purpose,
    startOdometer: form.useDistance ? null : toNumber(startText),
    endOdometer: form.useDistance ? null : toNumber(form.endOdometer),
    distanceKm: form.useDistance ? toNumber(form.distanceKm) : null,
    projectId: form.projectId,
    departmentId: form.departmentId,
    tollAmount: toNumber(form.tollAmount) ?? 0,
    parkingAmount: toNumber(form.parkingAmount) ?? 0,
    notes: form.notes,
  };

  const distanceKm = form.useDistance ? Math.max(0, Math.round((toNumber(form.distanceKm) ?? 0) * 10) / 10) : odometerDistance(toNumber(startText), toNumber(form.endOdometer));
  const rate = rateFor(data.settings.rateRevisions, form.tripDate, vehicleType, form.ownership);
  const pricing = priceTrip({ distanceKm, ratePerKm: rate.ratePerKm, tollAmount: toNumber(form.tollAmount) ?? 0, parkingAmount: toNumber(form.parkingAmount) ?? 0, allowTollParking: rules.allowTollParking });
  const typeOptions = useMemo(() => ownVehicleTypes(data.settings.rateRevisions, form.tripDate, data.vehicleTypes), [data.settings.rateRevisions, data.vehicleTypes, form.tripDate]);
  // The employee's own vehicles from their earlier trips, most recent first.
  const ownVehicles = useMemo(() => {
    const byNumber = new Map<string, { vehicleNumber: string; vehicleType: string }>();
    for (const entry of myTrips) {
      if (entry.ownership === 'own' && !byNumber.has(entry.vehicleNumber)) byNumber.set(entry.vehicleNumber, { vehicleNumber: entry.vehicleNumber, vehicleType: entry.vehicleType });
    }
    return [...byNumber.values()].slice(0, 4);
  }, [myTrips]);
  const daysLeft = daysLeftToClaim(form.tripDate, data.today, rules);

  const check = validateTrip(input, { rules, today: data.today, companyVehicle });
  // Errors show once the employee has tried to save, then update as they fix them.
  const liveErrors: TripErrors = attempted ? { ...errors, ...(check.ok ? {} : check.errors) } : {};

  async function save(next: boolean) {
    setAttempted(true);
    if (!check.ok) {
      setErrors({});
      return;
    }
    setSaving(next ? 'next' : 'save');
    try {
      const result = await tripFetch<{ trip: TripRecord }>(trip ? `trips/${trip.id}` : 'trips', { method: trip ? 'PATCH' : 'POST', body: gps ? { ...input, gps } : input });
      onSaved(result.trip);
      toast({ title: trip ? 'Trip updated' : 'Trip recorded', description: `${formatKm(result.trip.distanceKm)} · ${formatINR(result.trip.totalAmount)}` });
      if (next) {
        setForm((current) => ({
          ...current,
          fromPlace: current.toPlace,
          toPlace: '',
          purpose: current.purpose,
          startOdometer: result.trip.endOdometer !== null ? String(result.trip.endOdometer) : null,
          endOdometer: '',
          distanceKm: '',
          tollAmount: '',
          parkingAmount: '',
          notes: '',
        }));
        setErrors({});
        setAttempted(false);
      } else {
        onOpenChange(false);
      }
    } catch (error) {
      if (error instanceof TripApiError && Object.keys(error.fields).length) setErrors(error.fields as TripErrors);
      toast({ variant: 'destructive', title: 'Trip not saved', description: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const vehicleOptions = data.vehicles.map((vehicle) => ({
    value: vehicle.id,
    label: `${vehicle.vehicleNumber} · ${vehicle.vehicleType}`,
    hint: [vehicle.fuelType, vehicle.assignedDriverName && `Driver: ${vehicle.assignedDriverName}`].filter(Boolean).join(' · ') || undefined,
  }));

  /**
   * Hand the trip back to the recorder instead of saving it.
   *
   * Only the fields a driver can know before setting off are required here — `validateTrip`
   * insists on a destination and a closing reading, which is exactly right for a recorded trip
   * and impossible for one about to be driven.
   */
  const startRecording = () => {
    setAttempted(true);
    const missing: TripErrors = {};
    if (!form.purpose.trim()) missing.purpose = 'Say what the trip is for.';
    if (!form.fromPlace.trim()) missing.fromPlace = 'Where does it start?';
    if (form.ownership === 'own' && !normaliseVehicleNumber(form.vehicleNumber)) {
      missing.vehicleNumber = 'Which vehicle?';
    }
    if (form.ownership === 'company' && !form.vehicleId) missing.vehicleId = 'Choose a vehicle.';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    onStart?.({
      ownership: form.ownership,
      vehicleType: form.vehicleType,
      vehicleNumber: form.vehicleNumber,
      vehicleId: form.vehicleId,
      tripDate: form.tripDate,
      fromPlace: form.fromPlace,
      purpose: form.purpose,
      projectId: form.projectId,
      departmentId: form.departmentId,
      startOdometer: form.startOdometer,
      notes: form.notes,
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      // Wider than `lg` (672px) so the paired fields and both vehicle buttons sit on one line each.
      className="sm:max-w-4xl"
      title={mode === 'gps-start' ? 'Start a GPS trip' : trip ? 'Edit trip' : 'Record a trip'}
      description={
        mode === 'gps-start'
          ? 'One leg of official travel. Fill in what only you know — the distance, the destination and the closing reading are measured while you drive.'
          : "One leg of official travel. The amount is worked out from the company's per-km rate for the vehicle."
      }
      onSubmit={() => (mode === 'gps-start' ? startRecording() : save(false))}
      submitting={Boolean(saving)}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={Boolean(saving)}>
              Cancel
            </Button>
          </DialogClose>
          {!trip && mode === 'save' && (
            <Button type="button" variant="secondary" disabled={Boolean(saving)} onClick={() => save(true)}>
              {saving === 'next' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
              Save &amp; add next
            </Button>
          )}
          <Button type="submit" disabled={Boolean(saving)}>
            {saving === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {mode === 'gps-start' ? 'Start recording' : trip ? 'Save changes' : 'Save trip'}
          </Button>
        </>
      }
    >
      {trip?.returnNote && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Sent back from {trip.returnNote.claimNumber} by {trip.returnNote.byName}</p>
          <p className="mt-0.5">{trip.returnNote.remarks}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Trip date" required error={liveErrors.tripDate} htmlFor="trip-date" hint={daysLeft !== null && daysLeft <= 7 && daysLeft >= 0 ? `Claim within ${daysLeft} day${daysLeft === 1 ? '' : 's'}.` : undefined}>
          <Input id="trip-date" type="date" value={form.tripDate} max={data.today} onChange={(event) => set('tripDate', event.target.value)} aria-invalid={Boolean(liveErrors.tripDate)} className="bg-white" />
        </Field>
        <Field label="Vehicle" required error={liveErrors.ownership}>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Vehicle ownership">
            {([
              { value: 'own', label: 'Own vehicle', icon: Car, allowed: rules.allowOwnVehicle },
              { value: 'company', label: 'Company vehicle', icon: Building2, allowed: rules.allowCompanyVehicle },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={form.ownership === option.value}
                disabled={!option.allowed}
                onClick={() => setForm((current) => ({ ...current, ownership: option.value, startOdometer: current.ownership === option.value ? current.startOdometer : null }))}
                className={cn(
                  'flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  form.ownership === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                <option.icon className="h-4 w-4" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      {form.ownership === 'own' ? (
        <div className="space-y-2">
          {ownVehicles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Your vehicles:</span>
              {ownVehicles.map((vehicle) => (
                <button
                  key={vehicle.vehicleNumber}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, vehicleNumber: vehicle.vehicleNumber, vehicleType: vehicle.vehicleType, startOdometer: null }))}
                  className={cn('rounded-full border px-2.5 py-1 text-xs', vehicleNumber === vehicle.vehicleNumber ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
                >
                  {vehicle.vehicleNumber} · {vehicle.vehicleType}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle type" required error={liveErrors.vehicleType}>
              <Select value={form.vehicleType || undefined} onValueChange={(value) => set('vehicleType', value)}>
                <SelectTrigger className={cn('bg-white text-left', liveErrors.vehicleType && 'border-destructive')}>
                  <SelectValue placeholder="Choose type" />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.type} value={option.type}>
                      {option.type}
                      {option.rate !== null ? ` — ₹${option.rate}/km` : ' — no rate set'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Registration number" required error={liveErrors.vehicleNumber} htmlFor="trip-vehicle-number">
              <Input id="trip-vehicle-number" value={form.vehicleNumber} onChange={(event) => set('vehicleNumber', event.target.value.toUpperCase())} placeholder="e.g. OD02AB1234" autoComplete="off" className="bg-white uppercase" aria-invalid={Boolean(liveErrors.vehicleNumber)} />
            </Field>
          </div>
        </div>
      ) : (
        <Field label="Company vehicle" required error={liveErrors.vehicleId} hint={data.vehicles.length ? undefined : 'No vehicles in Vehicle Master yet.'}>
          <SearchSelect options={vehicleOptions} value={form.vehicleId} onChange={(value) => setForm((current) => ({ ...current, vehicleId: value, startOdometer: null }))} placeholder="Search by number or type" invalid={Boolean(liveErrors.vehicleId)} />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="From" required error={liveErrors.fromPlace} htmlFor="trip-from">
          <div className="relative">
            <Input id="trip-from" value={form.fromPlace} onChange={(event) => set('fromPlace', event.target.value)} placeholder={locating ? 'Finding your location…' : 'Office, site, city…'} maxLength={200} className="bg-white pr-9" aria-invalid={Boolean(liveErrors.fromPlace)} />
            {/*
              Typed by hand for years while the device knew the answer. Offered rather than forced:
              a trip can be recorded days later from somewhere else entirely, and then the current
              position is the wrong answer — which is why it fills itself only when a GPS trip is
              starting, and is a button everywhere else.
            */}
            <button
              type="button"
              onClick={() => void fillFromCurrentLocation()}
              disabled={locating}
              title="Use my current location"
              aria-label="Use my current location"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-50"
            >
              {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            </button>
          </div>
        </Field>
        <Field label="To" required={mode === 'save'} error={mode === 'save' ? liveErrors.toPlace : undefined} htmlFor="trip-to">
          <Input id="trip-to" value={form.toPlace} onChange={(event) => set('toPlace', event.target.value)} disabled={mode === 'gps-start'} placeholder={mode === 'gps-start' ? 'Measured when you stop' : 'Where the trip ended'} maxLength={200} className="bg-white" aria-invalid={Boolean(mode === 'save' && liveErrors.toPlace)} />
        </Field>
      </div>
      <Field label="Purpose" required error={liveErrors.purpose} htmlFor="trip-purpose">
        <Input id="trip-purpose" value={form.purpose} onChange={(event) => set('purpose', event.target.value)} placeholder="e.g. Site inspection, client meeting, bank work" maxLength={300} className="bg-white" aria-invalid={Boolean(liveErrors.purpose)} />
      </Field>

      <div className="space-y-2">
        {!rules.requireOdometer && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Distance from</span>
            <button type="button" onClick={() => set('useDistance', false)} className={cn('rounded-md px-2 py-1 font-medium', !form.useDistance ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100')}>
              Odometer readings
            </button>
            <button type="button" onClick={() => set('useDistance', true)} className={cn('rounded-md px-2 py-1 font-medium', form.useDistance ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:bg-slate-100')}>
              Distance only
            </button>
          </div>
        )}
        {form.useDistance ? (
          <Field label="Distance travelled (km)" required error={liveErrors.distance} htmlFor="trip-distance">
            <Input id="trip-distance" type="number" inputMode="decimal" step="0.1" min="0" value={form.distanceKm} onChange={(event) => set('distanceKm', event.target.value)} className="bg-white" aria-invalid={Boolean(liveErrors.distance)} />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Opening reading (km)" required error={liveErrors.startOdometer} htmlFor="trip-start" hint={lastReading !== null && !trip ? `Last logged: ${lastReading.toLocaleString('en-IN')}` : undefined}>
              <Input id="trip-start" type="number" inputMode="decimal" step="0.1" min="0" value={startText} onChange={(event) => set('startOdometer', event.target.value)} className="bg-white" aria-invalid={Boolean(liveErrors.startOdometer)} />
            </Field>
            <Field label="Closing reading (km)" required={mode === 'save'} error={mode === 'save' ? liveErrors.endOdometer ?? liveErrors.distance : undefined} htmlFor="trip-end">
              <Input id="trip-end" type="number" inputMode="decimal" step="0.1" min="0" value={form.endOdometer} onChange={(event) => set('endOdometer', event.target.value)} disabled={mode === 'gps-start'} placeholder={mode === 'gps-start' ? 'Measured' : undefined} className="bg-white" aria-invalid={Boolean(mode === 'save' && (liveErrors.endOdometer || liveErrors.distance))} />
            </Field>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Project" required={rules.requireProject} error={liveErrors.projectId}>
          <SearchSelect options={data.projects.map((project) => ({ value: project.id, label: project.name }))} value={form.projectId} onChange={(value) => set('projectId', value)} placeholder={rules.requireProject ? 'Choose project' : 'Head office / none'} allowClear invalid={Boolean(liveErrors.projectId)} />
        </Field>
        <Field label="Department" error={liveErrors.departmentId}>
          <SearchSelect options={data.departments.map((department) => ({ value: department.id, label: department.name }))} value={form.departmentId} onChange={(value) => set('departmentId', value)} placeholder="Optional" allowClear />
        </Field>
      </div>

      {rules.allowTollParking && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Toll (₹)" error={liveErrors.tollAmount} htmlFor="trip-toll">
            <Input id="trip-toll" type="number" inputMode="decimal" step="0.01" min="0" value={form.tollAmount} onChange={(event) => set('tollAmount', event.target.value)} placeholder="0" className="bg-white" />
          </Field>
          <Field label="Parking (₹)" error={liveErrors.parkingAmount} htmlFor="trip-parking">
            <Input id="trip-parking" type="number" inputMode="decimal" step="0.01" min="0" value={form.parkingAmount} onChange={(event) => set('parkingAmount', event.target.value)} placeholder="0" className="bg-white" />
          </Field>
        </div>
      )}

      <Field label="Notes" htmlFor="trip-notes">
        <Textarea id="trip-notes" value={form.notes} onChange={(event) => set('notes', event.target.value)} rows={2} maxLength={500} placeholder="Anything the approver should know" className="bg-white" />
      </Field>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs text-slate-600">
            {formatKm(distanceKm)} × {rate.ratePerKm !== null ? `₹${rate.ratePerKm}/km` : 'no rate'}
            {pricing.extrasAmount > 0 && <> + toll &amp; parking <Money value={pricing.extrasAmount} /></>}
          </p>
          <p className="text-lg font-semibold text-slate-900">
            <Money value={pricing.totalAmount} />
          </p>
        </div>
        <p className={cn('mt-1 text-[11px]', rate.ratePerKm === null && vehicleType ? 'text-amber-700' : 'text-muted-foreground')}>
          {!vehicleType
            ? 'Choose the vehicle to see the rate.'
            : rate.ratePerKm === null
              ? `The rate card has no ${form.ownership === 'own' ? 'own' : 'company'}-vehicle rate for ${vehicleType} on this date — only toll and parking would be paid. You can still record the trip.`
              : `Rate card from ${rate.effectiveFrom} · ${vehicleType}, ${form.ownership === 'own' ? 'own vehicle' : 'company vehicle'}.`}
        </p>
      </div>
    </FormDialog>
  );
}
