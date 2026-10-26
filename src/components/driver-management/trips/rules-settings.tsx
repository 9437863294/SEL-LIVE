'use client';

/**
 * Settings › Trip rules: what a trip must have to be recorded (blocking), and the limits that only
 * flag a trip for the approver's attention.
 *
 * When Settings › Fleet routes company-vehicle trips to fleet trips (decision D1, on by default),
 * the Company vehicles switch here has no effect: the page says so beside it.
 */

import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { VM_PRIMARY_BUTTON } from '@/components/vehicle-management/vm-ui';
import type { TripRules } from '@/lib/employee-trips/types';
import { ErrorBlock, LoadingBlock } from './trip-ui';
import { useTripSettings } from './use-trip-settings';
import { useFleet } from '@/components/fleet/fleet-provider';

type Toggle = { key: 'allowOwnVehicle' | 'allowCompanyVehicle' | 'requireOdometer' | 'allowTollParking' | 'requireProject'; label: string; hint: string };
type Limit = { key: 'maxKmPerTrip' | 'maxKmPerDay' | 'claimWindowDays'; label: string; hint: string; unit: string };

const TOGGLES: Toggle[] = [
  { key: 'allowOwnVehicle', label: 'Own vehicles', hint: 'Employees may claim trips on their own vehicle.' },
  { key: 'allowCompanyVehicle', label: 'Company vehicles', hint: 'Employees may log trips on a Vehicle Master vehicle.' },
  { key: 'requireOdometer', label: 'Odometer readings required', hint: 'Off: an employee may type the distance instead.' },
  { key: 'allowTollParking', label: 'Toll and parking', hint: 'Paid at cost on top of the per-km amount.' },
  { key: 'requireProject', label: 'Project required', hint: 'Every trip must name the project it was for.' },
];

const LIMITS: Limit[] = [
  { key: 'claimWindowDays', label: 'Claim window', hint: 'Trips older than this can no longer be recorded or submitted.', unit: 'days' },
  { key: 'maxKmPerTrip', label: 'Flag trips longer than', hint: 'Flagged for the approver, not blocked.', unit: 'km' },
  { key: 'maxKmPerDay', label: 'Flag days over', hint: "An employee's trips in one day, added up.", unit: 'km' },
];

export default function RulesSettings() {
  const { payload, error, saving, load, save } = useTripSettings();
  const fleetRouting = Boolean(useFleet().data?.settings.companyTripsInFleet);
  // The edits, or null while the saved rules are shown unchanged.
  const [draft, setDraft] = useState<TripRules | null>(null);

  if (error) return <ErrorBlock message={error} onRetry={() => void load()} />;
  if (!payload) return <LoadingBlock />;
  const rules = draft ?? payload.settings.rules;
  const dirty = draft !== null;
  const canEdit = payload.canEdit;
  const set = (patch: Partial<TripRules>) => setDraft({ ...rules, ...patch });
  const noVehicle = !rules.allowOwnVehicle && !rules.allowCompanyVehicle;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trip rules"
        icon={SlidersHorizontal}
        backHref="/driver-management/settings"
        description="What every trip is checked against when it is recorded and submitted."
        actions={
          canEdit ? (
            <Button
              type="button"
              className={VM_PRIMARY_BUTTON}
              disabled={!dirty || saving || noVehicle}
              onClick={async () => {
                if (await save({ part: 'rules', rules }, 'Trip rules saved')) setDraft(null);
              }}
            >
              {saving ? 'Saving…' : 'Save rules'}
            </Button>
          ) : undefined
        }
      />
      {noVehicle && <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Allow own vehicles, company vehicles or both.</p>}
      {fleetRouting && !rules.allowOwnVehicle && !noVehicle && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Company vehicles are fleet trips, so with own vehicles off My Trips has nothing to record. Turn own vehicles on.</p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">What a trip may be</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-slate-100">
            {TOGGLES.map((toggle) => (
              <label key={toggle.key} className="flex cursor-pointer items-start justify-between gap-4 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{toggle.label}</span>
                  <span className="block text-xs text-muted-foreground">{toggle.hint}</span>
                  {fleetRouting && toggle.key === 'allowCompanyVehicle' && (
                    <span className="mt-1 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                      Company-vehicle trips are recorded as fleet trips (Vehicle Management › Settings › Fleet), so My Trips offers own vehicles only and this switch has no effect. Company-vehicle drafts already recorded can still be edited and claimed.
                    </span>
                  )}
                </span>
                <Switch checked={rules[toggle.key]} onCheckedChange={(value) => set({ [toggle.key]: value })} disabled={!canEdit} aria-label={toggle.label} />
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Limits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {LIMITS.map((limit) => (
              <div key={limit.key} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{limit.label}</p>
                  <p className="text-xs text-muted-foreground">{limit.hint} Blank = no limit.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Input type="number" min="1" inputMode="numeric" value={rules[limit.key] ?? ''} onChange={(event) => set({ [limit.key]: event.target.value.trim() === '' ? null : Number(event.target.value) })} disabled={!canEdit} className="w-24 bg-white text-right" aria-label={limit.label} />
                  <span className="w-8 text-xs text-muted-foreground">{limit.unit}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
