'use client';

/**
 * Data Control — the rules the Entry Sheet and its import enforce: the reception-date window, when
 * received entries may still be edited or deleted, entry rules, and the register / import defaults.
 * Saved to `dailyRequisitionSettings/module-config`, read live through `useDailyRequisitionSettings`.
 */

import { useMemo, useState } from 'react';
import { CalendarRange, FileLock2, ListChecks, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import { FORM_LABEL } from '@/components/expenses/statutory-section';
import {
  DAILY_REQUISITION_SETTINGS_PATH,
  DR_BACKDATE_PRESETS,
  DR_DATE_PRESETS,
  MAX_WINDOW_DAYS,
  defaultDataControl,
  describeDateWindow,
  flattenDataControl,
  hasBlockingIssue,
  resolveDateWindow,
  todayLocal,
  validateDailyRequisitionSettings,
  type DRDataControl,
  type DRDatePreset,
  type DRDateControl,
} from '@/lib/daily-requisition-settings';
import {
  saveDailyRequisitionSettings,
  useDailyRequisitionSettings,
} from '@/components/daily-requisition/use-daily-requisition-settings';
import {
  IssueList,
  SaveBar,
  SettingRow,
  SettingsAccessDenied,
  SettingsNote,
  SettingsSection,
  SettingsSkeleton,
  describeLastUpdate,
  settingsPageClass,
} from '@/components/daily-requisition/settings-controls';
import { cn } from '@/lib/utils';

const TITLE = 'Data Control';
const DESCRIPTION = 'Date window, edit and delete rules, entry checks and register defaults for the Entry Sheet.';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** Whole days from an input; blank reads as 0 and validation rejects anything else odd. */
const daysFrom = (value: string): number => (value.trim() === '' ? 0 : Number(value));

export default function DailyRequisitionDataControlPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const { settings, meta, isLoading } = useDailyRequisitionSettings();

  const canView = can('View', 'Daily Requisition.Data Control') || can('View', 'Daily Requisition.Settings');
  const canEdit = can('Edit', 'Daily Requisition.Data Control');

  const [draft, setDraft] = useState<DRDataControl | null>(null);
  const [saving, setSaving] = useState(false);
  const [today] = useState(todayLocal);

  const current = draft ?? settings.data;
  const liveFlat = useMemo(() => flattenDataControl(settings.data), [settings.data]);
  const currentFlat = useMemo(() => flattenDataControl(current), [current]);
  const dirty = JSON.stringify(liveFlat) !== JSON.stringify(currentFlat) || JSON.stringify(current) !== JSON.stringify(settings.data);

  const issues = useMemo(
    () =>
      validateDailyRequisitionSettings({ ...settings, data: current }).filter(
        (issue) => issue.severity === 'error' || issue.section === 'dataControl',
      ),
    [settings, current],
  );
  const blocked = hasBlockingIssue(issues);

  const preview = useMemo(() => {
    const dc = current.dateControl;
    const valid = [dc.backdateDays, dc.futureDays].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_WINDOW_DAYS);
    if (!valid) return 'Enter whole numbers of days to see the window.';
    return describeDateWindow(resolveDateWindow(today, { data: { ...current, dateControl: { ...dc, enabled: true } } })) ?? '';
  }, [current, today]);

  const set = (patch: Partial<DRDataControl>) => setDraft((previous) => ({ ...(previous ?? settings.data), ...patch }));
  const setDate = (patch: Partial<DRDateControl>) =>
    setDraft((previous) => {
      const base = previous ?? settings.data;
      return { ...base, dateControl: { ...base.dateControl, ...patch } };
    });

  const handleSave = async () => {
    if (!canEdit || blocked) return;
    setSaving(true);
    try {
      await saveDailyRequisitionSettings({ section: 'dataControl', next: { ...settings, data: current }, meta, user });
      const changes = diffFields(liveFlat, currentFlat);
      await log(
        'Update Daily Requisition Data Control',
        { changes, changedCount: Object.keys(changes).length },
        { recordId: DAILY_REQUISITION_SETTINGS_PATH.doc, recordRef: 'Data Control' },
      );
      setDraft(null);
      toast({ title: 'Data Control saved', description: 'The Entry Sheet applies the new rules straight away.' });
    } catch (error) {
      console.error('Failed to save Data Control:', error);
      toast({ variant: 'destructive', title: 'Save failed', description: 'The settings could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (isLoading && canView)) return <SettingsSkeleton />;
  if (!canView) return <SettingsAccessDenied title={TITLE} description={DESCRIPTION} />;

  const readOnly = !canEdit || saving;
  const dc = current.dateControl;

  return (
    <div className={settingsPageClass}>
      <PageHeader eyebrow="Daily Requisition" title={TITLE} description={DESCRIPTION} backHref="/daily-requisition/settings" />

      <div className="space-y-4">
        <IssueList issues={issues} />

        <SettingsSection
          icon={CalendarRange}
          title="Reception date window"
          description="How far back or ahead a reception date may be set on a new entry, or when an entry's date is changed."
          aside={
            <Switch
              aria-label="Restrict reception dates"
              checked={dc.enabled}
              disabled={readOnly}
              onCheckedChange={(checked) => setDate({ enabled: checked })}
            />
          }
        >
          <div className={cn('space-y-3 px-4 py-3', !dc.enabled && 'opacity-60')}>
            <div className="space-y-1.5">
              <p className={FORM_LABEL}>Back-dating allowed</p>
              <div className="flex flex-wrap gap-1.5">
                {DR_BACKDATE_PRESETS.map((preset) => (
                  <Button
                    key={preset.days}
                    type="button"
                    size="sm"
                    variant={dc.backdateDays === preset.days ? 'default' : 'outline'}
                    className="h-8 px-3 text-xs"
                    disabled={readOnly || !dc.enabled}
                    onClick={() => setDate({ backdateDays: preset.days })}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="days-back" className={FORM_LABEL}>Days back</label>
                <Input
                  id="days-back"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_WINDOW_DAYS}
                  step={1}
                  className="h-9 tabular-nums"
                  value={String(dc.backdateDays)}
                  disabled={readOnly || !dc.enabled}
                  onChange={(event) => setDate({ backdateDays: daysFrom(event.target.value) })}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="days-ahead" className={FORM_LABEL}>Days ahead</label>
                <Input
                  id="days-ahead"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_WINDOW_DAYS}
                  step={1}
                  className="h-9 tabular-nums"
                  value={String(dc.futureDays)}
                  disabled={readOnly || !dc.enabled}
                  onChange={(event) => setDate({ futureDays: daysFrom(event.target.value) })}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <p className={FORM_LABEL}>Preview (today)</p>
                <div className="flex min-h-9 items-center rounded-md border border-dashed bg-slate-50 px-3 text-xs text-slate-700">
                  {dc.enabled ? preview : 'Off — any date can be chosen.'}
                </div>
              </div>
            </div>
          </div>
          <SettingRow
            title="Apply to bulk import"
            hint="Imported rows dated outside the window are skipped. Turn off to import old registers."
            htmlFor="apply-import"
            control={
              <Switch
                id="apply-import"
                checked={dc.applyToImport}
                disabled={readOnly || !dc.enabled}
                onCheckedChange={(checked) => setDate({ applyToImport: checked })}
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          icon={FileLock2}
          title="Editing & deleting"
          description="What the Entry Sheet allows once an entry has moved past Pending (received, verified, paid…)."
        >
          <SettingRow
            title="Allow editing after received"
            hint="Off: only Pending entries can be edited from the Entry Sheet."
            htmlFor="edit-after"
            control={
              <Switch
                id="edit-after"
                checked={current.allowEditAfterReceived}
                disabled={readOnly}
                onCheckedChange={(checked) => set({ allowEditAfterReceived: checked })}
              />
            }
          />
          <SettingRow
            title="Allow deleting after received"
            hint="Off: only Pending entries can be deleted."
            htmlFor="delete-after"
            control={
              <Switch
                id="delete-after"
                checked={current.allowDeleteAfterReceived}
                disabled={readOnly}
                onCheckedChange={(checked) => set({ allowDeleteAfterReceived: checked })}
              />
            }
          />
          <SettingsNote>
            Payment locks always apply: an entry paid through Bank Balance (or marked paid) cannot be deleted and only its
            description can be edited, whatever is set here.
          </SettingsNote>
        </SettingsSection>

        <SettingsSection icon={ListChecks} title="Entry rules" description="Checks applied when an entry is added or edited.">
          <SettingRow
            title="Require an expense request"
            hint="New entries must be received from an expense request (DEP No). Imports are not affected."
            htmlFor="require-dep"
            control={
              <Switch
                id="require-dep"
                checked={current.requireExpenseRequest}
                disabled={readOnly}
                onCheckedChange={(checked) => set({ requireExpenseRequest: checked })}
              />
            }
          />
          <SettingRow
            title="Net amount may exceed gross"
            hint="Off: an entry whose net amount is higher than its gross amount is rejected."
            htmlFor="net-over-gross"
            control={
              <Switch
                id="net-over-gross"
                checked={current.netMayExceedGross}
                disabled={readOnly}
                onCheckedChange={(checked) => set({ netMayExceedGross: checked })}
              />
            }
          />
          <SettingRow
            title="High-value threshold"
            hint={
              current.highValueThreshold > 0
                ? `Rows of ${inr.format(current.highValueThreshold)} or more (gross or net) are marked in the register.`
                : '0 = off. Rows at or above this amount are marked in the register.'
            }
            htmlFor="high-value"
            control={
              <div className="relative w-40">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
                <Input
                  id="high-value"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  className="h-9 pl-7 text-right tabular-nums"
                  value={String(current.highValueThreshold)}
                  disabled={readOnly}
                  onChange={(event) => set({ highValueThreshold: event.target.value.trim() === '' ? 0 : Number(event.target.value) })}
                />
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection icon={Upload} title="Register & import" description="Defaults for the Entry Sheet list and its bulk import.">
          <SettingRow
            title="Default date range"
            hint="What the Entry Sheet shows when it opens (by reception date). A link to one entry always shows it."
            control={
              <Select
                value={current.defaultDateRange}
                disabled={readOnly}
                onValueChange={(value) => set({ defaultDateRange: value as DRDatePreset })}
              >
                <SelectTrigger className="h-9 w-40" aria-label="Default date range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DR_DATE_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingRow
            title="Detect duplicates on import"
            hint="Skip rows that repeat an entry already recorded (same project, department, amount, party, narration and date). Reception numbers are always unique."
            htmlFor="import-dupes"
            control={
              <Switch
                id="import-dupes"
                checked={current.importDuplicateDetection}
                disabled={readOnly}
                onCheckedChange={(checked) => set({ importDuplicateDetection: checked })}
              />
            }
          />
        </SettingsSection>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        canEdit={canEdit}
        blocked={blocked}
        lastUpdate={describeLastUpdate(meta.dataControl)}
        onSave={handleSave}
        onDiscard={() => setDraft(null)}
        onResetDefaults={() => setDraft(defaultDataControl())}
      />
    </div>
  );
}
