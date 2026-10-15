'use client';

/**
 * The Automatic refresh panel: a schedule per section, overridable per unit.
 *
 * ── Why a section layer ─────────────────────────────────────────────────────────────────────────
 *
 * Fifteen things can be refreshed independently here, and fifteen schedule forms would be a worse
 * screen than the single schedule this replaced. They are also not fifteen unrelated things: the
 * five standard detail groups are all cheap per-employee field fetches, and the five restricted
 * ones are all personal data that an organisation will want on one cadence for one reason. So the
 * schedule sits on the section, and a unit that genuinely differs — the daily muster, an order of
 * magnitude heavier than anything else — overrides it.
 *
 * ── Why a section has no on/off switch ──────────────────────────────────────────────────────────
 *
 * Whether a unit is on is a question about *holding the data* — for a restricted group, the
 * decision to store somebody's Aadhaar number. That belongs to the unit and never to a timing
 * control sitting above it. A section that should not refresh on its own gets the `Manual`
 * frequency, which already means exactly that.
 *
 * ── Why the switch and the group are one control ────────────────────────────────────────────────
 *
 * Every unit but the two core ones is backed by a detail group. Two switches would let somebody set
 * an hourly schedule against a group that is off — a control that visibly does nothing. The row's
 * switch writes the group, and the server's normaliser enforces the same invariant.
 */

import { formatDistanceToNow } from 'date-fns';
import { Check, Clock, Loader2, Lock, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { EMPLOYEE_NAV } from '@/components/employee/employee-ui';
import {
  describeRefreshPlan,
  effectiveRefreshPlan,
  hasOwnRefreshPlan,
  SYNC_FREQUENCIES,
  SYNC_SECTIONS,
  syncUnitsInSection,
  tickCadenceWarning,
  type GreytHRSyncSettings,
  type RefreshPlan,
  type SyncFrequency,
  type SyncSectionKey,
  type SyncUnitKey,
  type SyncUnitSpec,
} from '@/lib/greythr';
import type { SyncReport } from '@/lib/greythr-sync-client';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const COST_TONE: Record<SyncUnitSpec['cost'], string> = {
  Light: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Moderate: 'border-sky-200 bg-sky-50 text-sky-700',
  Heavy: 'border-amber-200 bg-amber-50 text-amber-800',
};

type UnitStatus = NonNullable<SyncReport['unitStatus']>[number];

/**
 * The forward-looking half of a due-check's reason.
 *
 * `isSyncDue` answers with both halves — "Last run was 150h ago; next due in about 18h." — because
 * the scheduler's own log wants both. On a row that already says "Synced 6 days ago" an inch to the
 * left, the first half is the same fact twice.
 */
function nextDueLine(reason: string): string {
  const tail = reason.split(';').pop()!.trim();
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

/** Frequency, hour and day. Hour and day are disabled unless the frequency uses them. */
function PlanControls({
  plan,
  disabled,
  onChange,
  size = 'default',
  observedGapMinutes,
}: {
  plan: RefreshPlan;
  disabled: boolean;
  onChange: (next: RefreshPlan) => void;
  size?: 'default' | 'compact';
  /** Median gap between recent scheduled runs, for the cadence warning. */
  observedGapMinutes: number | null;
}) {
  const timed = plan.frequency === 'Daily' || plan.frequency === 'Weekly';
  const trigger = size === 'compact' ? 'h-8 text-xs' : 'h-9 text-xs';
  // Asking for every five minutes behind a caller that arrives every hour produces hourly runs.
  // Saying so beats letting the setting quietly under-deliver.
  const cadence = tickCadenceWarning(plan.frequency, observedGapMinutes);

  return (
    <div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        {size === 'default' && <Label className="text-[11px] text-muted-foreground">Frequency</Label>}
        <Select
          value={plan.frequency}
          disabled={disabled}
          onValueChange={(value) => onChange({ ...plan, frequency: value as SyncFrequency })}
        >
          <SelectTrigger className={trigger} aria-label="Frequency"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SYNC_FREQUENCIES.map((frequency) => (
              <SelectItem key={frequency} value={frequency}>{frequency}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        {size === 'default' && <Label className="text-[11px] text-muted-foreground">Hour of day</Label>}
        <Select
          value={String(plan.hourOfDay)}
          disabled={disabled || !timed}
          onValueChange={(value) => onChange({ ...plan, hourOfDay: Number(value) })}
        >
          <SelectTrigger className={trigger} aria-label="Hour of day"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-64">
            {Array.from({ length: 24 }).map((_, hour) => (
              <SelectItem key={hour} value={String(hour)}>
                {String(hour).padStart(2, '0')}:00
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        {size === 'default' && <Label className="text-[11px] text-muted-foreground">Day of week</Label>}
        <Select
          value={String(plan.dayOfWeek)}
          disabled={disabled || plan.frequency !== 'Weekly'}
          onValueChange={(value) => onChange({ ...plan, dayOfWeek: Number(value) })}
        >
          <SelectTrigger className={trigger} aria-label="Day of week"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DAY_NAMES.map((day, index) => (
              <SelectItem key={day} value={String(index)}>{day}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
    {cadence && <p className="mt-1.5 text-[11px] text-amber-700">{cadence}</p>}
    </div>
  );
}

export function SyncSchedulePanel({
  draft,
  onChange,
  status,
  canEdit,
  canSync,
  onRunUnit,
  busyUnit,
  schedulerLive,
  observedGapMinutes,
}: {
  draft: GreytHRSyncSettings;
  onChange: (next: GreytHRSyncSettings) => void;
  /** Per-unit due-ness from the last report. Absent before the first load. */
  status: UnitStatus[] | undefined;
  canEdit: boolean;
  canSync: boolean;
  onRunUnit: (key: SyncUnitKey) => void;
  busyUnit: SyncUnitKey | null;
  /** False when nothing calls the endpoint, so "next due" would promise a tick that never comes. */
  schedulerLive: boolean;
  /** Median gap between recent scheduled runs, measured from the run history. */
  observedGapMinutes: number | null;
}) {
  const setSectionPlan = (section: SyncSectionKey, plan: RefreshPlan) => {
    const next: GreytHRSyncSettings = { ...draft, sections: { ...draft.sections, [section]: plan } };
    // The deprecated whole-integration alias tracks Core records, as the server's normaliser does.
    if (section === 'core') next.schedule = { ...plan, enabled: draft.schedule.enabled };
    onChange(next);
  };

  const setUnitPlan = (key: SyncUnitKey, plan: RefreshPlan | null) => {
    const plans = { ...(draft.unitPlans ?? {}) };
    // Absence is the signal for "follows its section" — see `unitPlans` on the settings type.
    if (plan === null) delete plans[key];
    else plans[key] = plan;
    onChange({ ...draft, unitPlans: plans });
  };

  const setUnitEnabled = (spec: SyncUnitSpec, enabled: boolean) => {
    if (spec.detailGroup) {
      onChange({ ...draft, detailGroups: { ...draft.detailGroups, [spec.detailGroup]: enabled } });
      return;
    }
    const next: GreytHRSyncSettings = {
      ...draft,
      unitEnabled: { ...(draft.unitEnabled ?? {}), [spec.key]: enabled },
    };
    if (spec.key === 'employees') next.schedule = { ...draft.schedule, enabled };
    onChange(next);
  };

  const isEnabled = (spec: SyncUnitSpec): boolean =>
    spec.detailGroup ? draft.detailGroups[spec.detailGroup] === true : draft.unitEnabled?.[spec.key] !== false;

  return (
    <div className="space-y-3">
      {SYNC_SECTIONS.map((section) => {
        const units = syncUnitsInSection(section.key);
        const sectionPlan = draft.sections[section.key];
        const following = units.filter((spec) => !hasOwnRefreshPlan(draft, spec.key)).length;

        return (
          <div key={section.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* The section's own schedule, governing every unit below that has not overridden it. */}
            <div className="border-b border-slate-100 bg-slate-50/70 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                    {section.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{section.blurb}</p>
                </div>
                <p className="shrink-0 text-[11px] text-muted-foreground">
                  {following} of {units.length} following
                </p>
              </div>
              <div className="mt-2">
                <PlanControls
                  plan={sectionPlan}
                  disabled={!canEdit}
                  size="compact"
                  observedGapMinutes={observedGapMinutes}
                  onChange={(plan) => setSectionPlan(section.key, plan)}
                />
              </div>
              {/*
                The policy that used to sit under the detail-group list, kept where the switches
                now are. Each restricted group's own description runs to three sentences — too long
                for a row — but the part a reader needs *before* switching one on is the same for
                all five, so it belongs on the section.
              */}
              {section.key === 'restricted' && (
                <p className="mt-2 text-[11px] leading-snug text-amber-800">
                  Special-category personal data. Stored in a separate collection behind{' '}
                  <span className="font-medium">Employee › Personal Data · View</span>, which no role
                  holds until you grant it — switching one on is a decision to hold it.
                </p>
              )}
            </div>

            <div className="divide-y divide-slate-100">
              {units.map((spec) => {
                const enabled = isEnabled(spec);
                const own = hasOwnRefreshPlan(draft, spec.key);
                const plan = effectiveRefreshPlan(draft, spec.key);
                const row = status?.find((entry) => entry.key === spec.key);
                const navItem = spec.href
                  ? EMPLOYEE_NAV.find((item) => item.href === spec.href)
                  : undefined;
                const Icon = navItem?.icon;
                const running = busyUnit === spec.key;
                const syncedAt = row?.lastSuccessfulRunAt ?? null;
                const restricted = spec.section === 'restricted';

                return (
                  <div key={spec.key} className={cn('p-3', !enabled && 'bg-slate-50/40')}>
                    <div className="flex items-start gap-3">
                      {/*
                        A unit with a screen of its own wears that screen's nav icon; the detail
                        groups have no screen, so they get a neutral dot in the same box. The dot is
                        there for alignment rather than meaning — without it their labels start
                        eight pixels left of every other row and the column reads as ragged.
                      */}
                      <span
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          enabled ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        {Icon ? (
                          <Icon className="h-4 w-4" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        {/* A div, not a p: Badge renders a div, and a div inside a p is a hydration error. */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-slate-800">{spec.label}</span>
                          <Badge variant="outline" className={cn('text-[10px]', COST_TONE[spec.cost])}>
                            {spec.cost}
                          </Badge>
                          {restricted && (
                            <Badge variant="warning" className="gap-1 text-[10px]">
                              <Lock className="h-3 w-3" />
                              Restricted
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{spec.blurb}</p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                          <span className="inline-flex items-center gap-1 text-slate-600">
                            <Clock className="h-3 w-3" />
                            {!enabled
                              ? 'Off — refreshed only when you run it'
                              : own
                                ? describeRefreshPlan(plan)
                                : `Follows ${section.label} · ${describeRefreshPlan(plan)}`}
                          </span>
                          {enabled && syncedAt && (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Check className="h-3 w-3" />
                              Synced {formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}
                            </span>
                          )}
                          {enabled && !syncedAt && <span className="text-amber-700">Never synced</span>}
                          {/*
                            Suppressed while nothing drives the scheduler: "next due in about 6h" is
                            a claim about something that will happen, and where no tick ever arrives
                            it is simply untrue. The notice above the tabs says so instead.
                          */}
                          {enabled && schedulerLive && row && !row.due && (
                            <span className="text-slate-500">{nextDueLine(row.reason)}</span>
                          )}
                          {enabled && schedulerLive && row?.due && (
                            <span className="font-medium text-indigo-700">Due on the next tick</span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {enabled && (
                          <Select
                            value={own ? 'own' : 'section'}
                            disabled={!canEdit}
                            onValueChange={(value) =>
                              // Switching to its own plan starts from whatever it is refreshing on
                              // now, so the change is a starting point rather than a surprise.
                              setUnitPlan(spec.key, value === 'own' ? plan : null)
                            }
                          >
                            <SelectTrigger
                              className="h-8 w-[7.5rem] bg-white text-[11px] max-sm:hidden"
                              aria-label={`Schedule source for ${spec.label}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="section">Follow section</SelectItem>
                              <SelectItem value="own">Own schedule</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {canSync && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-8 bg-white/80 p-0"
                            disabled={busyUnit !== null}
                            aria-label={`Sync ${spec.label} now`}
                            onClick={() => onRunUnit(spec.key)}
                          >
                            {running ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        <Switch
                          checked={enabled}
                          disabled={!canEdit}
                          aria-label={`Refresh ${spec.label} automatically`}
                          onCheckedChange={(value) => setUnitEnabled(spec, value)}
                        />
                      </div>
                    </div>

                    {/* Only an overriding unit gets its own controls; the rest read their section's. */}
                    {enabled && own && (
                      <div className="mt-2.5 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
                        <PlanControls
                          plan={plan}
                          disabled={!canEdit}
                          size="compact"
                          observedGapMinutes={observedGapMinutes}
                          onChange={(next) => setUnitPlan(spec.key, next)}
                        />
                      </div>
                    )}

                    {/* The override control has no room on a phone, so it moves below the row. */}
                    {enabled && canEdit && (
                      <div className="mt-2 sm:hidden">
                        <Select
                          value={own ? 'own' : 'section'}
                          onValueChange={(value) => setUnitPlan(spec.key, value === 'own' ? plan : null)}
                        >
                          <SelectTrigger className="h-8 bg-white text-[11px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="section">Follow section</SelectItem>
                            <SelectItem value="own">Own schedule</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
