'use client';

/**
 * A vehicle's fleet fields: its category, daily limit, cost, fuel standard, approvers, home and
 * service. These sit on the Vehicle Master record beside its registration details, which are edited
 * in Vehicle Master as before.
 *
 * A blank field takes the default for the vehicle's category from Rules & limits, shown as the
 * field's placeholder — so changing a default later moves every vehicle that has not been given its
 * own figure. The masters API says which figures are the record's own, so a default opens blank and
 * saving the dialog does not quietly pin it onto the vehicle.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDialog } from '@/components/shared/form-dialog';
import { Field, SearchSelect } from '@/components/driver-management/trips/trip-ui';
import { fleetErrorMessage, fleetFetch } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import { categoryFromType } from '@/lib/fleet/settings';
import { COST_BASIS_LABELS, FLEET_CATEGORIES, FLEET_CATEGORY_LABELS, GEOFENCE_KIND_LABELS, type CostBasis, type FleetCategory, type FleetSettings, type FleetVehicle, type Geofence } from '@/lib/fleet/types';
import { fieldErrorsOf, numberOrNull, numberText, type FleetDirectoryUser, type MastersVehicle, type OwnFleetFigures } from './fleet-masters';

interface VehicleForm {
  fleetCategory: 'auto' | FleetCategory;
  dailyKmLimit: string;
  monthlyKmLimit: string;
  costBasis: CostBasis;
  ratePerKm: string;
  fixedMonthlyCost: string;
  tankCapacityL: string;
  stdMileageKmpl: string;
  mileageTolerancePct: string;
  approverUid: string | null;
  backupApproverUid: string | null;
  homeGeofenceId: string | null;
  serviceIntervalKm: string;
  lastServiceKm: string;
  lastServiceDate: string;
  siteInternalExemptFromLimit: boolean;
}

/**
 * The vehicle's own figure, blank where it has none so the default keeps applying. The masters API
 * says which figures are the record's own (`own`); without that, a figure equal to the default is
 * read as the default.
 */
function ownFigure(vehicle: MastersVehicle, key: keyof OwnFleetFigures, value: number, fallback: number): string {
  if (vehicle.own) return vehicle.own[key] === null ? '' : String(vehicle.own[key]);
  return value === fallback ? '' : String(value);
}

function formFrom(vehicle: MastersVehicle, settings: FleetSettings): VehicleForm {
  return {
    fleetCategory: vehicle.categorySet ? vehicle.category : 'auto',
    dailyKmLimit: ownFigure(vehicle, 'dailyKmLimit', vehicle.dailyKmLimit, settings.dailyKmLimitByCategory[vehicle.category]),
    monthlyKmLimit: ownFigure(vehicle, 'monthlyKmLimit', vehicle.monthlyKmLimit, settings.monthlyKmLimit),
    costBasis: vehicle.costBasis,
    ratePerKm: vehicle.ratePerKm ? String(vehicle.ratePerKm) : '',
    fixedMonthlyCost: vehicle.fixedMonthlyCost ? String(vehicle.fixedMonthlyCost) : '',
    tankCapacityL: numberText(vehicle.tankCapacityL),
    stdMileageKmpl: numberText(vehicle.stdMileageKmpl),
    mileageTolerancePct: ownFigure(vehicle, 'mileageTolerancePct', vehicle.mileageTolerancePct, settings.mileageTolerancePct),
    approverUid: vehicle.approverUid,
    backupApproverUid: vehicle.backupApproverUid,
    homeGeofenceId: vehicle.homeGeofenceId,
    serviceIntervalKm: ownFigure(vehicle, 'serviceIntervalKm', vehicle.serviceIntervalKm, settings.serviceIntervalKm),
    lastServiceKm: numberText(vehicle.lastServiceKm),
    lastServiceDate: vehicle.lastServiceDate ?? '',
    siteInternalExemptFromLimit: vehicle.siteInternalExemptFromLimit,
  };
}

const NUMBER_FIELDS: Array<{ key: keyof VehicleForm; min: number; max: number }> = [
  { key: 'dailyKmLimit', min: 1, max: 5000 },
  { key: 'monthlyKmLimit', min: 1, max: 100000 },
  { key: 'ratePerKm', min: 0, max: 1000 },
  { key: 'fixedMonthlyCost', min: 0, max: 10_000_000 },
  { key: 'tankCapacityL', min: 0.5, max: 2000 },
  { key: 'stdMileageKmpl', min: 0.5, max: 200 },
  { key: 'mileageTolerancePct', min: 0, max: 100 },
  { key: 'serviceIntervalKm', min: 100, max: 100000 },
  { key: 'lastServiceKm', min: 0, max: 9_999_999 },
];

export function VehicleFleetDialog({
  open,
  onOpenChange,
  vehicle,
  settings,
  users,
  geofences,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicle: MastersVehicle | null;
  settings: FleetSettings;
  users: FleetDirectoryUser[];
  geofences: Geofence[];
  onSaved: (vehicle: FleetVehicle) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<VehicleForm | null>(() => (vehicle ? formFrom(vehicle, settings) : null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const session = open && vehicle ? `open:${vehicle.id}` : 'closed';
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    if (open && vehicle) {
      setForm(formFrom(vehicle, settings));
      setErrors({});
    }
  }

  if (!vehicle || !form) return null;
  const derived = categoryFromType(vehicle.vehicleType);
  const category = form.fleetCategory === 'auto' ? derived : form.fleetCategory;
  const set = <K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => ({ ...current, [key]: '' }));
  };
  const userOptions = users.map((user) => ({ value: user.id, label: user.name, hint: user.email || undefined }));
  const fenceOptions = geofences.filter((fence) => fence.active).map((fence) => ({ value: fence.id, label: fence.name, hint: GEOFENCE_KIND_LABELS[fence.kind] }));

  const numberInput = (key: keyof VehicleForm, placeholder: string, step = 'any') => (
    <Input
      id={`vehicle-${key}`}
      type="number"
      inputMode="decimal"
      step={step}
      value={form[key] as string}
      onChange={(event) => set(key, event.target.value as never)}
      placeholder={placeholder}
      className="bg-white tabular-nums"
      aria-invalid={Boolean(errors[key])}
    />
  );

  async function submit() {
    if (!vehicle || !form) return;
    const invalid: Record<string, string> = {};
    for (const field of NUMBER_FIELDS) {
      const text = String(form[field.key]).trim();
      if (!text) continue;
      const value = Number(text);
      if (!Number.isFinite(value) || value < field.min || value > field.max) invalid[field.key] = `From ${field.min} to ${field.max.toLocaleString('en-IN')}, or blank.`;
    }
    if (form.approverUid && form.approverUid === form.backupApproverUid) invalid.backupApproverUid = 'Choose someone other than the approver.';
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return;
    }
    setSaving(true);
    try {
      const body = {
        fleetCategory: form.fleetCategory === 'auto' ? null : form.fleetCategory,
        dailyKmLimit: numberOrNull(form.dailyKmLimit),
        monthlyKmLimit: numberOrNull(form.monthlyKmLimit),
        costBasis: form.costBasis,
        ratePerKm: form.costBasis === 'per_km' ? numberOrNull(form.ratePerKm) : null,
        fixedMonthlyCost: form.costBasis === 'fixed_plus_fuel' ? numberOrNull(form.fixedMonthlyCost) : null,
        tankCapacityL: numberOrNull(form.tankCapacityL),
        stdMileageKmpl: numberOrNull(form.stdMileageKmpl),
        mileageTolerancePct: numberOrNull(form.mileageTolerancePct),
        approverUid: form.approverUid,
        backupApproverUid: form.backupApproverUid,
        homeGeofenceId: form.homeGeofenceId,
        serviceIntervalKm: numberOrNull(form.serviceIntervalKm),
        lastServiceKm: numberOrNull(form.lastServiceKm),
        lastServiceDate: form.lastServiceDate || null,
        siteInternalExemptFromLimit: form.siteInternalExemptFromLimit,
      };
      const result = await fleetFetch<{ vehicle: FleetVehicle }>(`vehicles/${vehicle.id}`, { method: 'PATCH', body });
      toast({ title: `${vehicle.vehicleNumber} saved`, description: 'Applies from the next trip started on it.' });
      onSaved(result.vehicle);
    } catch (failure) {
      setErrors(fieldErrorsOf(failure));
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The vehicle could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`${vehicle.vehicleNumber} — fleet settings`}
      description={`${vehicle.vehicleType}${vehicle.fuelType ? ` · ${vehicle.fuelType}` : ''}. Blank fields take the ${FLEET_CATEGORY_LABELS[category].toLowerCase()} defaults from Rules & limits.`}
      onSubmit={submit}
      submitting={saving}
      submitLabel="Save vehicle"
    >
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Running and cost</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category" error={errors.fleetCategory} hint="Decides the default daily limit.">
            <Select value={form.fleetCategory} onValueChange={(value) => set('fleetCategory', value as VehicleForm['fleetCategory'])}>
              <SelectTrigger className="bg-white text-left [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">From the vehicle type — {FLEET_CATEGORY_LABELS[derived]}</SelectItem>
                {FLEET_CATEGORIES.map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {FLEET_CATEGORY_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Daily km limit" error={errors.dailyKmLimit} htmlFor="vehicle-dailyKmLimit" hint="Past it, a trip needs approval first.">
            {numberInput('dailyKmLimit', `${settings.dailyKmLimitByCategory[category]} (default)`, '1')}
          </Field>
          <Field label="Cost basis" error={errors.costBasis} hint={form.costBasis === 'per_km' ? 'Each trip costs its km × the rate, billed to its project.' : "The month's fixed charge and fuel, shared over its trips' projects by km."}>
            <Select value={form.costBasis} onValueChange={(value) => set('costBasis', value as CostBasis)}>
              <SelectTrigger className="bg-white text-left [&>span]:truncate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(COST_BASIS_LABELS) as CostBasis[]).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {COST_BASIS_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.costBasis === 'per_km' ? (
            <Field label="Rate per km (₹)" error={errors.ratePerKm} htmlFor="vehicle-ratePerKm" hint="Blank or 0: trips are counted but cost nothing.">
              {numberInput('ratePerKm', '0')}
            </Field>
          ) : (
            <Field label="Fixed monthly charge (₹)" error={errors.fixedMonthlyCost} htmlFor="vehicle-fixedMonthlyCost" hint="Hire charge or driver's salary — fuel is added from the fuel register.">
              {numberInput('fixedMonthlyCost', '0')}
            </Field>
          )}
          <Field label="Monthly km" error={errors.monthlyKmLimit} htmlFor="vehicle-monthlyKmLimit" hint="Expected running, for planning.">
            {numberInput('monthlyKmLimit', `${settings.monthlyKmLimit} (default)`, '1')}
          </Field>
        </div>
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-800">Running inside a site is outside the limit</span>
            <span className="block text-xs text-muted-foreground">For a pickup or loader that works within a project site: a trip that starts and ends inside the same project-site geofence, without leaving it, does not count toward the daily limit.</span>
          </span>
          <Switch checked={form.siteInternalExemptFromLimit} onCheckedChange={(value) => set('siteInternalExemptFromLimit', value)} aria-label="Running inside a site is outside the limit" />
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approvers</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Approver" error={errors.approverUid} hint="Decides over-limit requests and reviews this vehicle's trips. Blank: each driver's reporting authority.">
            <SearchSelect options={userOptions} value={form.approverUid} onChange={(value) => set('approverUid', value)} placeholder="Driver's reporting authority" allowClear />
          </Field>
          <Field label="Backup approver" error={errors.backupApproverUid} hint="Reached when the approver has not decided in time.">
            <SearchSelect options={userOptions.filter((option) => option.value !== form.approverUid)} value={form.backupApproverUid} onChange={(value) => set('backupApproverUid', value)} placeholder="None" allowClear invalid={Boolean(errors.backupApproverUid)} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fuel</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tank (litres)" error={errors.tankCapacityL} htmlFor="vehicle-tankCapacityL" hint="A fill bigger than this is flagged.">
            {numberInput('tankCapacityL', 'Not set')}
          </Field>
          <Field label="Standard mileage (km/L)" error={errors.stdMileageKmpl} htmlFor="vehicle-stdMileageKmpl" hint="Full tank to full tank is checked against it.">
            {numberInput('stdMileageKmpl', 'Not set')}
          </Field>
          <Field label="Mileage tolerance (%)" error={errors.mileageTolerancePct} htmlFor="vehicle-mileageTolerancePct">
            {numberInput('mileageTolerancePct', `${settings.mileageTolerancePct} (default)`)}
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home and service</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Home geofence" error={errors.homeGeofenceId} hint="Where it is parked overnight.">
            <SearchSelect options={fenceOptions} value={form.homeGeofenceId} onChange={(value) => set('homeGeofenceId', value)} placeholder="None" allowClear emptyText="No geofence matches — add it on the Geofences page." />
          </Field>
          <Field label="Service every (km)" error={errors.serviceIntervalKm} htmlFor="vehicle-serviceIntervalKm">
            {numberInput('serviceIntervalKm', `${settings.serviceIntervalKm} (default)`, '1')}
          </Field>
          <Field label="Last service reading (km)" error={errors.lastServiceKm} htmlFor="vehicle-lastServiceKm" hint="The service-due check counts from here.">
            {numberInput('lastServiceKm', 'Not recorded', '1')}
          </Field>
          <Field label="Last service date" error={errors.lastServiceDate} htmlFor="vehicle-lastServiceDate">
            <Input id="vehicle-lastServiceDate" type="date" value={form.lastServiceDate} onChange={(event) => set('lastServiceDate', event.target.value)} className="bg-white" />
          </Field>
        </div>
        {form.lastServiceKm === '' && vehicle.currentOdometerKm !== null && (
          <Button type="button" variant="outline" size="sm" onClick={() => set('lastServiceKm', String(Math.round(vehicle.currentOdometerKm as number)))}>
            Serviced at today&apos;s reading ({Math.round(vehicle.currentOdometerKm).toLocaleString('en-IN')} km)
          </Button>
        )}
      </section>
    </FormDialog>
  );
}
