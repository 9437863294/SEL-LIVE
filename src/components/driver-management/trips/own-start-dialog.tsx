'use client';

/**
 * Starting an own-vehicle GPS trip — the same start as a company-vehicle trip (fleet
 * start-trip-dialog.tsx), asked for what an own vehicle needs.
 *
 * The date is today and not editable (a trip is dated by when it is driven), and the starting place
 * fills itself from the phone and stays editable. The vehicle is the employee's own: one tap on a
 * vehicle from their earlier trips, or its type and registration. Then what the trip is for, the
 * project (their own first — Employee › Category), and the opening odometer when Trip rules require
 * readings. No price is shown here — the rate is not what a vehicle is chosen for. The route records
 * as they drive; Stop & review (own-review-dialog.tsx) prices it and saves it to My Trips, ready to
 * claim.
 *
 * It replaced the old "Start a GPS trip" mode of the full trip form, which asked for a trip the way
 * an office form does — every field of a finished trip, most of them disabled.
 */

import { useEffect, useMemo, useState } from 'react';
import { Car, Loader2, LocateFixed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDialog } from '@/components/shared/form-dialog';
import { placeName } from '@/components/driver-management/fleet/start-helpers';
import { shortDateLabel } from '@/lib/fleet/dates';
import { projectChoices, projectGroup } from '@/lib/employee-projects/links';
import { ownVehicleTypes } from '@/lib/employee-trips/rates';
import { normaliseVehicleNumber, type TripRecord } from '@/lib/employee-trips/types';
import { cn } from '@/lib/utils';
import type { Bootstrap } from './trip-api';
import { Field, SearchSelect } from './trip-ui';

/** What the recorder needs to begin: `beginTrip` in gps-trip-recorder.tsx. */
export interface OwnStartValues {
  ownership: 'own';
  vehicleType: string;
  vehicleNumber: string;
  vehicleId: null;
  tripDate: string;
  fromPlace: string;
  purpose: string;
  projectId: string | null;
  departmentId: string | null;
  startOdometer: string | null;
  notes: string;
}

type Errors = Partial<Record<'vehicleType' | 'vehicleNumber' | 'purpose' | 'projectId' | 'startOdometer', string>>;

export function OwnStartDialog({
  open,
  onOpenChange,
  data,
  myTrips,
  starting,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Bootstrap;
  /** The employee's trips, newest first — their own vehicles and last readings. */
  myTrips: TripRecord[];
  /** The recorder is getting a first fix; the button waits. */
  starting: boolean;
  onStart: (values: OwnStartValues) => void;
}) {
  const rules = data.settings.rules;
  const today = data.today;
  const projectPick = projectChoices(data.projects, data.projectScope?.mine ?? [], Boolean(data.projectScope?.onlyMine));

  // The employee's own vehicles from their earlier trips, most recent first.
  const ownVehicles = useMemo(() => {
    const byNumber = new Map<string, { vehicleNumber: string; vehicleType: string }>();
    for (const trip of myTrips) if (trip.ownership === 'own' && !byNumber.has(trip.vehicleNumber)) byNumber.set(trip.vehicleNumber, { vehicleNumber: trip.vehicleNumber, vehicleType: trip.vehicleType });
    return [...byNumber.values()].slice(0, 4);
  }, [myTrips]);
  const last = myTrips.find((trip) => trip.ownership === 'own');

  const [vehicleType, setVehicleType] = useState(ownVehicles[0]?.vehicleType ?? '');
  const [vehicleNumber, setVehicleNumber] = useState(ownVehicles[0]?.vehicleNumber ?? '');
  const [fromPlace, setFromPlace] = useState('');
  const [purpose, setPurpose] = useState('');
  const [projectId, setProjectId] = useState<string | null>(() => projectPick.preselect ?? (last?.projectId && projectPick.options.some((option) => option.id === last.projectId) ? last.projectId : null));
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [startOdometer, setStartOdometer] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [locating, setLocating] = useState(true);

  // Where the trip starts, from the phone, once per opening (the dialog mounts afresh for each).
  // Typing wins: an answer that arrives after the employee typed is dropped.
  useEffect(() => {
    let cancelled = false;
    void placeName().then((place) => {
      if (cancelled) return;
      setFromPlace((current) => (current.trim() ? current : place));
      setLocating(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function locateHere() {
    setLocating(true);
    try {
      const place = await placeName();
      if (place) setFromPlace(place);
    } finally {
      setLocating(false);
    }
  }

  const types = useMemo(() => ownVehicleTypes(data.settings.rateRevisions, today, data.vehicleTypes), [data.settings.rateRevisions, data.vehicleTypes, today]);
  const number = normaliseVehicleNumber(vehicleNumber);
  // The vehicle's last closing reading, offered as this trip's opening one.
  const lastReading = number ? myTrips.find((trip) => trip.vehicleNumber === number && trip.endOdometer !== null)?.endOdometer ?? null : null;
  const byDepartment = data.settings.stages.some((stage) => stage.routing === 'department');

  const errors: Errors = {};
  if (!vehicleType) errors.vehicleType = 'Choose the vehicle type.';
  if (number.length < 4) errors.vehicleNumber = 'Enter the registration number.';
  if (purpose.trim().length < 3) errors.purpose = 'Say what the trip is for.';
  if (rules.requireProject && !projectId) errors.projectId = 'Choose the project this trip is for.';
  const opening = startOdometer.trim() === '' ? null : Number(startOdometer);
  if (rules.requireOdometer && (opening === null || !Number.isFinite(opening) || opening < 0)) errors.startOdometer = 'Read the odometer before you set off.';
  const shown = attempted ? errors : {};

  function submit() {
    setAttempted(true);
    if (Object.keys(errors).length) return;
    onStart({
      ownership: 'own',
      vehicleType,
      vehicleNumber: number,
      vehicleId: null,
      tripDate: today,
      fromPlace: fromPlace.trim(),
      purpose: purpose.trim(),
      projectId,
      departmentId,
      startOdometer: rules.requireOdometer && opening !== null ? String(opening) : null,
      notes: '',
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !starting && onOpenChange(next)}
      size="lg"
      sheet
      title="Start a trip"
      // The date is today and not editable — said here rather than in a disabled field.
      description={`Own vehicle · Today, ${shortDateLabel(today, today)} · claimed per km`}
      onSubmit={() => submit()}
      submitting={starting}
      submitLabel={starting ? 'Finding you…' : 'Start recording'}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {ownVehicles.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:col-span-2">
            <span className="text-[11px] text-muted-foreground">Your vehicles:</span>
            {ownVehicles.map((vehicle) => {
              const chosen = number === vehicle.vehicleNumber;
              return (
                <button
                  key={vehicle.vehicleNumber}
                  type="button"
                  onClick={() => {
                    setVehicleNumber(vehicle.vehicleNumber);
                    setVehicleType(vehicle.vehicleType);
                  }}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', chosen ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
                >
                  <Car className="h-3 w-3" aria-hidden />
                  {vehicle.vehicleNumber} · {vehicle.vehicleType}
                </button>
              );
            })}
          </div>
        )}

        <Field label="Vehicle type" required error={shown.vehicleType}>
          <Select value={vehicleType || undefined} onValueChange={setVehicleType}>
            <SelectTrigger className={cn('bg-white text-left', shown.vehicleType && 'border-destructive')} aria-label="Vehicle type">
              <span className="min-w-0 truncate">
                <SelectValue placeholder="Choose type" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {types.map((option) => (
                <SelectItem key={option.type} value={option.type}>
                  {option.type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Registration number" required error={shown.vehicleNumber} htmlFor="own-start-number">
          <Input id="own-start-number" value={vehicleNumber} onChange={(event) => setVehicleNumber(event.target.value.toUpperCase())} maxLength={15} placeholder="e.g. OD02AB1234" autoCapitalize="characters" className="bg-white" />
        </Field>

        <Field label="Starting from" htmlFor="own-start-place" className="sm:col-span-2" hint={locating ? 'Finding where you are…' : 'From your location — change it if it is wrong.'}>
          <div className="flex min-w-0 gap-2">
            <Input id="own-start-place" value={fromPlace} onChange={(event) => setFromPlace(event.target.value)} maxLength={200} placeholder={locating ? 'Locating…' : 'Where the trip starts'} className="min-w-0 flex-1 bg-white" />
            <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => void locateHere()} disabled={locating || starting} aria-label="Use my current location" title="Use my current location">
              {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            </Button>
          </div>
        </Field>

        <Field label="Purpose" required error={shown.purpose} htmlFor="own-start-purpose" className="sm:col-span-2">
          <Input id="own-start-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={300} placeholder="e.g. Site inspection, client meeting, bank work" className="bg-white" />
        </Field>

        <Field label="Project" required={rules.requireProject} error={shown.projectId}>
          <SearchSelect
            options={projectPick.options.map((project, _, all) => ({ value: project.id, label: project.name, group: projectGroup(project.mine, all.some((entry) => entry.mine)) }))}
            value={projectId}
            onChange={setProjectId}
            placeholder={rules.requireProject ? 'Choose project' : 'Head office / none'}
            allowClear
            invalid={Boolean(shown.projectId)}
          />
        </Field>
        {byDepartment ? (
          <Field label="Department">
            <SearchSelect options={data.departments.map((department) => ({ value: department.id, label: department.name }))} value={departmentId} onChange={setDepartmentId} placeholder="Optional" allowClear />
          </Field>
        ) : rules.requireOdometer ? null : (
          <div className="hidden sm:block" />
        )}

        {rules.requireOdometer && (
          <Field
            label="Odometer now (km)"
            required
            error={shown.startOdometer}
            htmlFor="own-start-odometer"
            hint={lastReading !== null ? `Last logged ${lastReading.toLocaleString('en-IN')} km` : 'Read it off the dashboard.'}
          >
            <Input id="own-start-odometer" type="number" inputMode="decimal" min="0" step="0.1" value={startOdometer} onChange={(event) => setStartOdometer(event.target.value)} placeholder={lastReading !== null ? String(lastReading) : undefined} className="bg-white" />
          </Field>
        )}
      </div>

      {/* No money at the start: the amount is worked out, and shown, at Stop & review. */}
      <p className="rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2 text-xs text-teal-900">
        The amount is worked out from the distance when you stop, and the trip goes to My Trips to claim.
      </p>
    </FormDialog>
  );
}
