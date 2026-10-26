'use client';

/**
 * Settings › Fleet › Rules & limits: the numbers every fleet trip and fuel entry is checked
 * against, and who may drive.
 *
 * Each figure says what happens at it, in the words a driver or a manager would meet it — "needs
 * approval", "goes to a manager to pick", "flagged" — because the owner sets these, not a developer,
 * and a bare "mismatchPct" invites a guess. A vehicle's own figures (the Vehicles tab) override the
 * category defaults here.
 */

import { useState, type ReactNode } from 'react';
import { Camera, Gauge, Route, ShieldCheck, Timer, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import { fleetErrorMessage } from '@/components/fleet/fleet-api';
import { useToast } from '@/hooks/use-toast';
import { FLEET_CATEGORY_LABELS, type FleetCategory, type FleetSettings } from '@/lib/fleet/types';
import { cn } from '@/lib/utils';
import { fieldErrorsOf } from './fleet-masters';
import { parseDraftNumbers, saveFleetSettings, type NumberDraft } from './settings-save';

type NumKey =
  | 'bike'
  | 'car'
  | 'pickup'
  | 'monthlyKmLimit'
  | 'serviceIntervalKm'
  | 'mileageTolerancePct'
  | 'mismatchAbsKm'
  | 'mismatchPct'
  | 'unloggedKmTolerance'
  | 'emergencyMonthlyMax'
  | 'gpsGapMinutes'
  | 'idleRemindMinutes'
  | 'idleAutoCloseMinutes'
  | 'maxTripHours'
  | 'fuelRateVariancePct';

type ToggleKey = 'anyEmployeeMayDrive' | 'companyTripsInFleet' | 'ocrEnabled' | 'employeeProjectsOnly';

/** The API's ranges (src/lib/fleet/schemas.ts), so the form refuses what the server would. */
const RULES: Record<NumKey, { min: number; max: number; integer?: boolean; label: string }> = {
  bike: { min: 1, max: 2000, label: 'a daily limit' },
  car: { min: 1, max: 2000, label: 'a daily limit' },
  pickup: { min: 1, max: 2000, label: 'a daily limit' },
  monthlyKmLimit: { min: 1, max: 50000, label: 'the monthly km' },
  serviceIntervalKm: { min: 100, max: 100000, label: 'the service interval' },
  mileageTolerancePct: { min: 0, max: 100, label: 'the tolerance' },
  mismatchAbsKm: { min: 0, max: 500, label: 'the km margin' },
  mismatchPct: { min: 0, max: 100, label: 'the % margin' },
  unloggedKmTolerance: { min: 0, max: 1000, label: 'the km' },
  emergencyMonthlyMax: { min: 0, max: 100, integer: true, label: 'the number of starts' },
  gpsGapMinutes: { min: 1, max: 1440, integer: true, label: 'the minutes' },
  idleRemindMinutes: { min: 5, max: 1440, integer: true, label: 'the minutes' },
  idleAutoCloseMinutes: { min: 15, max: 10080, integer: true, label: 'the minutes' },
  maxTripHours: { min: 1, max: 72, label: 'the hours' },
  fuelRateVariancePct: { min: 0, max: 100, label: 'the %' },
};

const CATEGORIES: FleetCategory[] = ['bike', 'car', 'pickup'];

/** Server field paths → the keys here. */
const SERVER_KEYS: Record<string, NumKey> = {
  'dailyKmLimitByCategory.bike': 'bike',
  'dailyKmLimitByCategory.car': 'car',
  'dailyKmLimitByCategory.pickup': 'pickup',
};

function savedNumber(settings: FleetSettings, key: NumKey): number {
  if (key === 'bike' || key === 'car' || key === 'pickup') return settings.dailyKmLimitByCategory[key];
  return settings[key];
}

function NumberRow({ id, label, hint, unit, value, onChange, error, disabled, step = 'any' }: { id: string; label: string; hint: ReactNode; unit: string; value: string; onChange: (value: string) => void; error?: string; disabled: boolean; step?: string }) {
  return (
    <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <label htmlFor={id} className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
        {error && <span className="mt-0.5 block text-xs text-destructive">{error}</span>}
      </label>
      <div className="flex shrink-0 items-center gap-1.5">
        <Input id={id} type="number" inputMode="decimal" step={step} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={cn('w-24 bg-white text-right tabular-nums', error && 'border-destructive')} aria-invalid={Boolean(error)} />
        <span className="w-14 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled, children }: { label: string; hint: ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled: boolean; children?: ReactNode }) {
  return (
    <div className="py-3">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">{label}</span>
          <span className="block text-xs text-muted-foreground">{hint}</span>
        </span>
        <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
      </label>
      {children}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Gauge; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-slate-500" aria-hidden />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100">{children}</CardContent>
    </Card>
  );
}

export default function RulesLimitsSettings({ settings, canEdit, onSaved }: { settings: FleetSettings; canEdit: boolean; onSaved: (settings: FleetSettings) => void }) {
  const { toast } = useToast();
  const [numbers, setNumbers] = useState<NumberDraft<NumKey>>({});
  const [toggles, setToggles] = useState<Partial<Pick<FleetSettings, ToggleKey>>>({});
  const [errors, setErrors] = useState<Partial<Record<NumKey, string>>>({});
  const [saving, setSaving] = useState(false);

  const text = (key: NumKey) => numbers[key] ?? String(savedNumber(settings, key));
  const live = (key: NumKey) => {
    const parsed = Number(text(key));
    return Number.isFinite(parsed) ? parsed : savedNumber(settings, key);
  };
  const toggle = (key: ToggleKey) => toggles[key] ?? settings[key];
  const dirty = Object.keys(numbers).length > 0 || Object.keys(toggles).length > 0;
  const setNumber = (key: NumKey) => (value: string) => {
    setNumbers((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const row = (key: NumKey, label: string, hint: ReactNode, unit: string, step?: string) => (
    <NumberRow key={key} id={`fleet-rule-${key}`} label={label} hint={hint} unit={unit} value={text(key)} onChange={setNumber(key)} error={errors[key]} disabled={!canEdit || saving} step={step} />
  );

  async function save() {
    const { values, errors: invalid } = parseDraftNumbers(numbers, RULES);
    const merged = (key: NumKey) => values[key] ?? savedNumber(settings, key);
    if (merged('idleAutoCloseMinutes') <= merged('idleRemindMinutes')) invalid.idleAutoCloseMinutes ??= 'Must be longer than the reminder.';
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<FleetSettings> = { ...toggles, dailyKmLimitByCategory: { bike: merged('bike'), car: merged('car'), pickup: merged('pickup') } };
      for (const key of Object.keys(values) as NumKey[]) {
        if (key !== 'bike' && key !== 'car' && key !== 'pickup') Object.assign(patch, { [key]: values[key] });
      }
      const next = await saveFleetSettings(settings, patch);
      onSaved(next);
      setNumbers({});
      setToggles({});
      setErrors({});
      toast({ title: 'Fleet rules saved', description: 'They apply from the next trip started or fuel entry made.' });
    } catch (failure) {
      const fields = fieldErrorsOf(failure);
      setErrors(Object.fromEntries(Object.entries(fields).map(([key, message]) => [SERVER_KEYS[key] ?? key, message])) as Partial<Record<NumKey, string>>);
      toast({ variant: 'destructive', title: 'Not saved', description: fleetErrorMessage(failure, 'The rules could not be saved.') });
    } finally {
      setSaving(false);
    }
  }

  // A worked example, so the margin reads as what it does to a real trip.
  const example = 40;
  const margin = Math.max(live('mismatchAbsKm'), (example * live('mismatchPct')) / 100);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => { setNumbers({}); setToggles({}); setErrors({}); }}>
              Discard changes
            </Button>
          )}
          <Button type="button" className={VM_PRIMARY_BUTTON} disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save rules'}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section icon={Gauge} title="Daily km limits">
          {CATEGORIES.map((category) =>
            row(category, FLEET_CATEGORY_LABELS[category], `A ${FLEET_CATEGORY_LABELS[category].toLowerCase()}'s km in a day, before its approver must agree.`, 'km/day'),
          )}
          {row(
            'emergencyMonthlyMax',
            'Emergency starts per driver',
            'Past the limit with no time to ask: the driver may start anyway, this many times a month. Each one is flagged and the approver is told at once. 0 = never.',
            'a month',
            '1',
          )}
          <p className="py-3 text-xs text-muted-foreground">
            Starting a trip that would take the vehicle&apos;s day past its limit needs approval first. The approver can approve, approve fewer km, or raise the vehicle&apos;s limit for good. A vehicle&apos;s own limit on the Vehicles tab replaces its category&apos;s.
          </p>
        </Section>

        <Section icon={Route} title="Billing: GPS against the odometer">
          {row('mismatchAbsKm', 'Margin in km', 'GPS and the odometer may differ by this many km and the odometer is still billed…', 'km')}
          {row('mismatchPct', 'or margin in %', '…or by this share of the odometer km, whichever is larger.', '%')}
          <p className="py-3 text-xs text-slate-600">
            On a {example} km trip the odometer is billed if GPS is within <span className="font-semibold">{margin.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km</span> of it. Further apart, the trip waits for a manager to pick the odometer, GPS or a figure of their own. With no usable GPS track the odometer stands, flagged.
          </p>
          {row('unloggedKmTolerance', 'Unlogged running', "A trip's opening reading this far above the vehicle's last closing reading means it ran without a trip; the trip is flagged and the approver told.", 'km')}
        </Section>

        <Section icon={Timer} title="Tracking during a trip">
          {row('gpsGapMinutes', 'GPS gap', 'No position from the phone for this long is a gap, flagged on the trip (background tracking stopped, or no signal).', 'min', '1')}
          {row('idleRemindMinutes', 'Remind the driver after', 'A running trip with no position for this long: the driver is reminded it is still running.', 'min', '1')}
          {row('idleAutoCloseMinutes', 'Close a silent trip after', 'Still silent this long: the system ends the trip and it waits for a manager to settle the km.', 'min', '1')}
          {row('maxTripHours', 'Longest trip', 'A trip running longer than this is closed the same way.', 'hours')}
        </Section>

        <Section icon={Wrench} title="Fuel and service">
          {row('mileageTolerancePct', 'Low mileage', "Full tank to full tank, a vehicle doing worse than its standard km/L by more than this is flagged. A vehicle's own tolerance overrides it.", '%')}
          {row('fuelRateVariancePct', 'Unusual price per litre', "A fill this far from the vehicle's recent price per litre is flagged.", '%')}
          {row('serviceIntervalKm', 'Service every', 'The service-due check counts from each vehicle’s last service reading. A vehicle may have its own interval.', 'km', '1')}
          {row('monthlyKmLimit', 'Monthly running', 'A vehicle’s expected km in a month, for planning and reports; a vehicle may have its own.', 'km', '1')}
        </Section>
      </div>

      <Section icon={ShieldCheck} title="Who drives, and reading the odometer">
        <ToggleRow
          label="Any employee may drive a company vehicle"
          hint="On: every active employee can start a fleet trip and enter fuel. Off: only people with a Driver Master record."
          checked={toggle('anyEmployeeMayDrive')}
          onChange={(value) => setToggles((current) => ({ ...current, anyEmployeeMayDrive: value }))}
          disabled={!canEdit || saving}
        />
        <ToggleRow
          label="Trips list only the employee's projects"
          hint="On: the project picker on Fleet Trip and on an own-vehicle trip shows only the employee's own projects — their greytHR project, linked to Settings › Projects on Employee › Category — and the server refuses another. Off: their projects come first and every other project follows. Someone with no linked project always sees them all."
          checked={toggle('employeeProjectsOnly')}
          onChange={(value) => setToggles((current) => ({ ...current, employeeProjectsOnly: value }))}
          disabled={!canEdit || saving}
        />
        <ToggleRow
          label="Company-vehicle trips are fleet trips"
          hint="On: a run in a company vehicle is recorded here — started and ended with odometer photos, billed to a project — and leaves Fleet & Travel › My Trips, which then takes own vehicles only (claims already made are not touched). Off: employees may log company-vehicle trips on My Trips and claim them as before."
          checked={toggle('companyTripsInFleet')}
          onChange={(value) => setToggles((current) => ({ ...current, companyTripsInFleet: value }))}
          disabled={!canEdit || saving}
        />
        <ToggleRow
          label="Read odometer photos automatically (OCR)"
          hint="On: each odometer photo is read by Google Cloud Vision and the reading suggested to the driver, who confirms or corrects it; a typed reading that differs from the photo is flagged. Off: the driver types the reading and the photo is kept as proof."
          checked={toggle('ocrEnabled')}
          onChange={(value) => setToggles((current) => ({ ...current, ocrEnabled: value }))}
          disabled={!canEdit || saving}
        >
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Needs the Cloud Vision API enabled on the Firebase project (or a <code className="rounded bg-amber-100 px-1">GOOGLE_CLOUD_VISION_API_KEY</code>). Google bills it per photo after the first 1,000 a month — two photos per trip, one per fill-up. If it is not enabled, turning this on does no harm: photos are simply not read.
            </span>
          </p>
        </ToggleRow>
      </Section>
    </div>
  );
}
