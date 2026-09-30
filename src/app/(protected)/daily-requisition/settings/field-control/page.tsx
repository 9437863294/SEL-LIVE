'use client';

/**
 * Field Control — the Entry Sheet's Add / Edit form fields (label, required, visible) and the
 * register's columns (visible, order). Saved to `dailyRequisitionSettings/module-config`, read live
 * by the Entry Sheet through `useDailyRequisitionSettings`.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, ListChecks, Lock, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { diffFields } from '@/lib/activity-logger';
import {
  DAILY_REQUISITION_SETTINGS_PATH,
  DR_FIELD_REGISTRY,
  MAX_LABEL_LENGTH,
  defaultColumnSettings,
  defaultFieldSettings,
  drColumnDef,
  flattenFieldControl,
  hasBlockingIssue,
  moveColumn,
  setColumnVisibility,
  validateDailyRequisitionSettings,
  type DRColumnSetting,
  type DRFieldKey,
  type DRFieldSetting,
} from '@/lib/daily-requisition-settings';
import {
  saveDailyRequisitionSettings,
  useDailyRequisitionSettings,
} from '@/components/daily-requisition/use-daily-requisition-settings';
import {
  IssueList,
  SaveBar,
  SettingsAccessDenied,
  SettingsSection,
  SettingsSkeleton,
  describeLastUpdate,
  settingsPageClass,
} from '@/components/daily-requisition/settings-controls';
import { cn } from '@/lib/utils';

type Draft = { fields: Record<DRFieldKey, DRFieldSetting>; columns: DRColumnSetting[] };

const TITLE = 'Field Control';
const DESCRIPTION = 'Label, require or hide the Entry Sheet form fields, and choose the register columns.';

export default function DailyRequisitionFieldControlPage() {
  const { user } = useAuth();
  const { can, isLoading: authLoading } = useAuthorization();
  const { toast } = useToast();
  const { log } = useActivityLogger(ACTIVITY_MODULES.DAILY_REQUISITION);
  const { settings, meta, isLoading } = useDailyRequisitionSettings();

  const canView = can('View', 'Daily Requisition.Field Control') || can('View', 'Daily Requisition.Settings');
  const canEdit = can('Edit', 'Daily Requisition.Field Control');

  // Null until the first edit: until then the page simply shows what is live.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const live: Draft = useMemo(() => ({ fields: settings.fields, columns: settings.columns }), [settings]);
  const current = draft ?? live;
  const liveFlat = useMemo(() => flattenFieldControl(live), [live]);
  const currentFlat = useMemo(() => flattenFieldControl(current), [current]);
  const dirty = JSON.stringify(liveFlat) !== JSON.stringify(currentFlat);

  const issues = useMemo(
    () =>
      validateDailyRequisitionSettings({ ...settings, fields: current.fields, columns: current.columns }).filter(
        // Every error blocks the save wherever it arises; Data Control's warnings belong on its page.
        (issue) => issue.severity === 'error' || issue.section === 'fieldControl',
      ),
    [settings, current],
  );
  const blocked = hasBlockingIssue(issues);

  const edit = (update: (previous: Draft) => Draft) => setDraft((previous) => update(previous ?? live));

  const setField = (key: DRFieldKey, patch: Partial<DRFieldSetting>) =>
    edit((previous) => {
      const next = { ...previous.fields[key], ...patch };
      if (!next.visible) next.required = false;
      return { ...previous, fields: { ...previous.fields, [key]: next } };
    });

  const handleSave = async () => {
    if (!canEdit || blocked) return;
    setSaving(true);
    try {
      await saveDailyRequisitionSettings({
        section: 'fieldControl',
        next: { ...settings, fields: current.fields, columns: current.columns },
        meta,
        user,
      });
      const changes = diffFields(liveFlat, currentFlat);
      await log(
        'Update Daily Requisition Field Control',
        { changes, changedCount: Object.keys(changes).length },
        { recordId: DAILY_REQUISITION_SETTINGS_PATH.doc, recordRef: 'Field Control' },
      );
      setDraft(null);
      toast({ title: 'Field Control saved', description: 'The Entry Sheet picks up the new layout straight away.' });
    } catch (error) {
      console.error('Failed to save Field Control:', error);
      toast({ variant: 'destructive', title: 'Save failed', description: 'The settings could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || (isLoading && canView)) return <SettingsSkeleton />;
  if (!canView) return <SettingsAccessDenied title={TITLE} description={DESCRIPTION} />;

  const readOnly = !canEdit || saving;

  return (
    <div className={settingsPageClass}>
      <PageHeader
        eyebrow="Daily Requisition"
        title={TITLE}
        description={DESCRIPTION}
        backHref="/daily-requisition/settings"
        meta={
          <>
            <Badge variant="neutral">{DR_FIELD_REGISTRY.filter((f) => current.fields[f.key].visible).length} fields shown</Badge>
            <Badge variant="neutral">{current.columns.filter((c) => c.visible).length} columns shown</Badge>
          </>
        }
      />

      <div className="space-y-4">
        <IssueList issues={issues} />

        <SettingsSection
          icon={ListChecks}
          title="Entry form fields"
          description="The Add Entry and Edit Entry dialogs. A hidden field is never required; a blank label keeps the default."
        >
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_4.5rem_2.25rem] items-center gap-3 border-b border-slate-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid">
            <span>Field</span>
            <span>Label on the form</span>
            <span className="text-center">Required</span>
            <span className="text-center">Visible</span>
            <span className="sr-only">Reset</span>
          </div>
          <ul>
            {DR_FIELD_REGISTRY.map((def) => {
              const field = current.fields[def.key];
              const fixedVisible = def.locked || def.alwaysVisible;
              const fixedRequired = def.locked || def.requiredManagedElsewhere;
              const isDefault = field.visible && field.required === def.defaultRequired && !field.label;
              return (
                <li
                  key={def.key}
                  className="grid grid-cols-1 gap-2 border-b border-slate-100 px-4 py-2.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_4.5rem_4.5rem_2.25rem] md:items-center md:gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-800">{def.defaultLabel}</span>
                      {def.locked ? (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600" title="Can only be relabelled">
                          <Lock className="h-3 w-3" aria-hidden="true" /> Locked
                        </span>
                      ) : def.alwaysVisible ? (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          <Lock className="h-3 w-3" aria-hidden="true" /> Always shown
                        </span>
                      ) : null}
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">
                        {def.forms.length === 2 ? 'Add · Edit' : 'Add only'}
                      </span>
                    </div>
                    {def.helpText ? <p className="text-xs text-slate-500">{def.helpText}</p> : null}
                  </div>
                  <Input
                    aria-label={`${def.defaultLabel} label`}
                    className="h-9"
                    value={field.label}
                    placeholder={def.defaultLabel}
                    maxLength={MAX_LABEL_LENGTH}
                    disabled={readOnly}
                    onChange={(event) => setField(def.key, { label: event.target.value })}
                  />
                  <div className="flex items-center gap-2 md:justify-center">
                    <Switch
                      aria-label={`${def.defaultLabel} required`}
                      checked={field.required}
                      disabled={readOnly || fixedRequired || !field.visible}
                      onCheckedChange={(checked) => setField(def.key, { required: checked })}
                    />
                    <span className="text-xs text-slate-500 md:hidden">Required</span>
                  </div>
                  <div className="flex items-center gap-2 md:justify-center">
                    <Switch
                      aria-label={`${def.defaultLabel} visible`}
                      checked={field.visible}
                      disabled={readOnly || fixedVisible}
                      onCheckedChange={(checked) => setField(def.key, { visible: checked })}
                    />
                    <span className="text-xs text-slate-500 md:hidden">Visible</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 justify-self-start md:justify-self-center"
                    title="Reset this field"
                    aria-label={`Reset ${def.defaultLabel}`}
                    disabled={readOnly || isDefault}
                    onClick={() => setField(def.key, defaultFieldSettings()[def.key])}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </SettingsSection>

        <SettingsSection
          icon={Columns3}
          title="Register columns"
          description="The Entry Sheet table. Reception No., Status and Actions are always shown; Actions stays last."
        >
          <ol>
            {current.columns.map((column, index) => {
              const def = drColumnDef(column.key);
              const pinned = def?.pinnedLast;
              const nextIsPinned = drColumnDef(current.columns[index + 1]?.key ?? '')?.pinnedLast;
              return (
                <li
                  key={column.key}
                  className={cn(
                    'flex items-center gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0',
                    !column.visible && 'bg-slate-50/60',
                  )}
                >
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                  <span className={cn('min-w-0 flex-1 truncate text-sm', column.visible ? 'text-slate-800' : 'text-slate-400 line-through')}>
                    {def?.label ?? column.key}
                  </span>
                  {def?.locked ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Always shown" />
                  ) : null}
                  <Switch
                    aria-label={`Show ${def?.label ?? column.key}`}
                    checked={column.visible}
                    disabled={readOnly || def?.locked}
                    onCheckedChange={(checked) =>
                      edit((previous) => ({ ...previous, columns: setColumnVisibility(previous.columns, column.key, checked) }))
                    }
                  />
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move ${def?.label ?? column.key} up`}
                      disabled={readOnly || pinned || index === 0}
                      onClick={() => edit((previous) => ({ ...previous, columns: moveColumn(previous.columns, index, 'up') }))}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move ${def?.label ?? column.key} down`}
                      disabled={readOnly || pinned || nextIsPinned || index === current.columns.length - 1}
                      onClick={() => edit((previous) => ({ ...previous, columns: moveColumn(previous.columns, index, 'down') }))}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </SettingsSection>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        canEdit={canEdit}
        blocked={blocked}
        lastUpdate={describeLastUpdate(meta.fieldControl)}
        onSave={handleSave}
        onDiscard={() => setDraft(null)}
        onResetDefaults={() => setDraft({ fields: defaultFieldSettings(), columns: defaultColumnSettings() })}
      />
    </div>
  );
}
