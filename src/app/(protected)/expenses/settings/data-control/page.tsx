'use client';

/**
 * Expenses › Settings › Data Control — the rules the module enforces on its data.
 *
 * Grouped by where each rule bites: how the registers open, what may change after a request is
 * received, what New Request will accept, and how a bulk import behaves. Every rule's shipped
 * value reproduces the module's behaviour before the rule existed.
 *
 * Saves only its own part of `expensesSettings/module-config` (`data`), so it can never undo a
 * Field Control change. Each save is logged with a readable before/after.
 */

import { useMemo, useState } from 'react';
import { CalendarRange, Database, FileInput, PenLine, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import {
  DEFAULT_EXPENSE_DATA_CONTROL,
  EXPENSE_DATE_PRESETS,
  MAX_DUPLICATE_WARNING_DAYS,
  dataControlPayload,
  flattenDataControl,
  hasBlockingIssue,
  settingsStampFor,
  validateDataControl,
  type ExpenseDataControl,
  type ExpenseDatePreset,
  type ExpensesModuleSettings,
} from '@/lib/expenses-settings';
import {
  CONTROL_LABEL,
  ControlAccessDenied,
  ControlCard,
  ControlSaveBar,
  IssueList,
  ReadOnlyNotice,
  RuleRow,
  saveExpensesSettingsPart,
  stampLine,
  useExpensesControlAccess,
  useSettingsPartDraft,
} from '@/components/expenses/settings-control-kit';
import { PageHeader } from '@/components/shared/page-header';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

const pickDataControl = (settings: ExpensesModuleSettings): ExpenseDataControl => settings.data;

/** A number box that keeps what is typed; blank reads as zero, and validation judges the rest. */
function NumberBox({
  id,
  value,
  onChange,
  disabled,
  prefix,
  suffix,
  placeholder,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>
      )}
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        className={`h-9 text-right text-sm tabular-nums ${prefix ? 'pl-7' : ''} ${suffix ? 'pr-12' : ''}`}
        disabled={disabled}
        placeholder={placeholder}
        value={Number.isFinite(value) && value !== 0 ? value : ''}
        onChange={event => {
          const raw = event.target.value;
          onChange(raw === '' ? 0 : Number(raw));
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

export default function ExpensesDataControlPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.EXPENSES);
  const { canView, canEdit, isLoading: isAuthLoading } = useExpensesControlAccess('Data Control');
  const draft = useSettingsPartDraft(pickDataControl);
  const { value: data, isDirty, update } = draft;
  const [isSaving, setIsSaving] = useState(false);

  const issues = useMemo(() => validateDataControl(data), [data]);
  const blocked = hasBlockingIssue(issues);
  const stamp = settingsStampFor(draft.settings, 'dataControl');

  const set = <K extends keyof ExpenseDataControl>(key: K, next: ExpenseDataControl[K]) =>
    update(current => ({ ...current, [key]: next }));

  const handleSave = async () => {
    if (!user || !canEdit || blocked) return;
    setIsSaving(true);
    try {
      const payload = dataControlPayload(data);
      const before = await saveExpensesSettingsPart('dataControl', { data: payload }, user);
      const changes = diffFields(flattenDataControl(before.data), flattenDataControl(payload));
      await log(
        'Update Expenses Data Control',
        { changes, changedCount: Object.keys(changes).length },
        { recordId: 'module-config', recordRef: 'Data Control' },
      );
      draft.markSaved(payload);
      toast({ title: 'Data Control saved', description: 'The rules apply to the next request, register and import.' });
    } catch (error) {
      console.error('Could not save Expenses Data Control:', error);
      toast({ title: 'Save failed', description: 'The rules were not written.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthLoading || draft.isLoading) {
    return (
      <div className="w-full space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map(index => (
            <Skeleton key={index} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="w-full space-y-4">
        <PageHeader icon={Database} title="Data Control" backHref="/expenses/settings" backLabel="Back to settings" />
        <ControlAccessDenied />
      </div>
    );
  }

  const disabled = !canEdit;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        icon={Database}
        title="Data Control"
        description={stampLine(stamp, 'The rules the module enforces on requests, registers and imports')}
        backHref="/expenses/settings"
        backLabel="Back to settings"
      />

      {!canEdit && <ReadOnlyNotice section="Data Control" />}
      <IssueList issues={issues} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        {/* ── Register ── */}
        <ControlCard icon={CalendarRange} title="Register" description="How the registers and reports open.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <label className={CONTROL_LABEL}>Registers open on</label>
              <Select
                value={data.defaultDateRange}
                disabled={disabled}
                onValueChange={next => set('defaultDateRange', next as ExpenseDatePreset)}
              >
                <SelectTrigger className="h-9 text-sm" aria-label="Registers open on">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_DATE_PRESETS.map(preset => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Anything but “All time” hides older requests until the user widens the range.</p>
            </div>
            <div className="min-w-0 space-y-1.5">
              <label htmlFor="high-value" className={CONTROL_LABEL}>High-value threshold</label>
              <NumberBox
                id="high-value"
                prefix="₹"
                value={data.highValueThreshold}
                disabled={disabled}
                placeholder="0"
                onChange={next => set('highValueThreshold', next)}
              />
              <p className="text-[11px] text-muted-foreground">
                What the High Value report flags. Ships at ₹{DEFAULT_EXPENSE_DATA_CONTROL.highValueThreshold.toLocaleString('en-IN')}.
              </p>
            </div>
          </div>
        </ControlCard>

        {/* ── Editing ── */}
        <ControlCard icon={PenLine} title="Editing" description="What may still change once a request has been received.">
          <div className="divide-y">
            <RuleRow
              title="Allow editing after reception"
              hint="A request that already carries a reception number can still be changed from its register."
              control={
                <Switch
                  checked={data.allowEditAfterReception}
                  disabled={disabled}
                  onCheckedChange={checked => set('allowEditAfterReception', checked)}
                  aria-label="Allow editing after reception"
                />
              }
            />
            <RuleRow
              title="Allow GST & TDS editing after reception"
              hint={
                data.allowEditAfterReception
                  ? 'Recorded for the edit screen. Today GST & TDS are fixed when the request is raised and no screen changes them.'
                  : 'Only applies while editing after reception is allowed.'
              }
              control={
                <Switch
                  checked={data.allowStatutoryEditAfterReception}
                  disabled={disabled || !data.allowEditAfterReception}
                  onCheckedChange={checked => set('allowStatutoryEditAfterReception', checked)}
                  aria-label="Allow GST and TDS editing after reception"
                />
              }
            />
          </div>
        </ControlCard>

        {/* ── Entry rules ── */}
        <ControlCard icon={ShieldCheck} title="Entry rules" description="What the New Request form will accept.">
          <div className="space-y-4">
            <div className="divide-y">
              <RuleRow
                title="Restrict parties to existing names"
                hint="The party picker stops offering to create a new name, which keeps the party ledger tidy."
                control={
                  <Switch
                    checked={data.restrictPartyToExisting}
                    disabled={disabled}
                    onCheckedChange={checked => set('restrictPartyToExisting', checked)}
                    aria-label="Restrict parties to existing names"
                  />
                }
              />
              <RuleRow
                title="Capture GST & TDS on new requests"
                hint="Off hides the whole GST & TDS section; requests are then saved at their plain amount."
                control={
                  <Switch
                    checked={data.gstTdsCapture}
                    disabled={disabled}
                    onCheckedChange={checked => set('gstTdsCapture', checked)}
                    aria-label="Capture GST and TDS on new requests"
                  />
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="max-amount" className={CONTROL_LABEL}>Largest request amount</label>
                <NumberBox
                  id="max-amount"
                  prefix="₹"
                  value={data.maxRequestAmount}
                  disabled={disabled}
                  placeholder="No limit"
                  onChange={next => set('maxRequestAmount', next)}
                />
                <p className="text-[11px] text-muted-foreground">New Request refuses anything above it. Blank or 0 is no limit.</p>
              </div>
              <div className="min-w-0 space-y-1.5">
                <label htmlFor="duplicate-days" className={CONTROL_LABEL}>Warn on a repeat request within</label>
                <NumberBox
                  id="duplicate-days"
                  suffix="days"
                  value={data.duplicateRequestWarningDays}
                  disabled={disabled}
                  placeholder="Off"
                  onChange={next => set('duplicateRequestWarningDays', next)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Same party, same amount: New Request asks before saving. Blank or 0 is off; at most {MAX_DUPLICATE_WARNING_DAYS}.
                </p>
              </div>
            </div>
          </div>
        </ControlCard>

        {/* ── Import ── */}
        <ControlCard icon={FileInput} title="Import" description="How a bulk import from a file behaves.">
          <div className="space-y-4">
            <div className="divide-y">
              <RuleRow
                title="Detect duplicates on import"
                hint="A row matching a request already recorded is skipped rather than created twice."
                control={
                  <Switch
                    checked={data.importDuplicateDetection}
                    disabled={disabled}
                    onCheckedChange={checked => set('importDuplicateDetection', checked)}
                    aria-label="Detect duplicates on import"
                  />
                }
              />
            </div>
            <div className="min-w-0 space-y-1.5 border-t pt-4 sm:max-w-xs">
              <label className={CONTROL_LABEL}>Imports take request numbers from</label>
              <Select
                value={data.importRequestNoSource}
                disabled={disabled}
                onValueChange={next => set('importRequestNoSource', next as ExpenseDataControl['importRequestNoSource'])}
              >
                <SelectTrigger className="h-9 text-sm" aria-label="Imports take request numbers from">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="generate">The department series</SelectItem>
                  <SelectItem value="file">The imported file</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Which option the import wizard opens on. It can still be changed per import.</p>
            </div>
          </div>
        </ControlCard>
      </div>

      <ControlSaveBar
        isDirty={isDirty}
        blocked={blocked}
        isSaving={isSaving}
        canEdit={canEdit}
        onSave={() => void handleSave()}
        onDiscard={draft.discard}
        onReset={() => draft.replace({ ...DEFAULT_EXPENSE_DATA_CONTROL })}
      />
    </div>
  );
}
