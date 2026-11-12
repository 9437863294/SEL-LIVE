'use client';

/**
 * Field Control — the Entry Sheet's Add / Edit form fields (label; required, optional or hidden)
 * and the register's columns (shown, order). Saved to `dailyRequisitionSettings/module-config`,
 * read live by the Entry Sheet through `useDailyRequisitionSettings`.
 *
 * Two tabs. Entry form: each field with its label and state, beside a live preview of the Add or
 * Edit dialog as it will look. Register columns: each column shown or hidden and in order, with how
 * much width the register needs against a laptop or monitor screen and which columns would need a
 * sideways scroll.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Clock3, Columns3, FileText, Loader2, Lock, Paperclip, RotateCcw, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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
  type DRColumnKey,
  type DRColumnSetting,
  type DRFieldDef,
  type DRFieldKey,
  type DRFieldSetting,
} from '@/lib/daily-requisition-settings';
import { saveDailyRequisitionSettings, useDailyRequisitionSettings } from '@/components/daily-requisition/use-daily-requisition-settings';
import { IssueList, SettingsAccessDenied, SettingsSkeleton, describeLastUpdate } from '@/components/daily-requisition/settings-controls';
import { dailyPageContainerClass } from '@/components/daily-requisition/module-shell';
import { Segmented } from '@/components/daily-requisition/workflow-editor-parts';
import { InfoTip } from '@/components/shared/info-tip';
import { cn } from '@/lib/utils';

type Draft = { fields: Record<DRFieldKey, DRFieldSetting>; columns: DRColumnSetting[] };
type FieldState = 'required' | 'optional' | 'hidden';

const TITLE = 'Field Control';
const DESCRIPTION = 'Name, require or hide entry form fields, and choose the register columns.';

const STATE_LOOK: Record<FieldState, { label: string; bar: string; on: string }> = {
  required: { label: 'Required', bar: '#e11d48', on: 'text-rose-700' },
  optional: { label: 'Optional', bar: '#0284c7', on: 'text-sky-700' },
  hidden: { label: 'Hidden', bar: '#cbd5e1', on: 'text-slate-500' },
};

/**
 * Roughly how wide each register column draws, in pixels: the text columns' caps on the Entry Sheet
 * (project 180, department 140, party 200, description 260) plus cell padding, the others sized to
 * what they usually hold. An estimate for the fit check, not a measurement.
 */
const COLUMN_WIDTH: Record<DRColumnKey, number> = {
  createdAt: 130,
  receptionNo: 160,
  status: 120,
  date: 100,
  projectId: 204,
  departmentId: 164,
  partyName: 224,
  description: 284,
  grossAmount: 120,
  netAmount: 120,
  paid: 110,
  balance: 120,
  actions: 70,
};
/** The module's menu and the page's padding take this much of the screen. */
const CHROME_PX = 300;
/** Columns to offer hiding first when the register does not fit: details the opened row shows anyway. */
const FIRST_TO_HIDE: DRColumnKey[] = ['createdAt', 'paid', 'grossAmount', 'departmentId'];
const COLUMN_TINTS = ['#a7f3d0', '#bfdbfe', '#ddd6fe', '#fbcfe8', '#fde68a', '#bae6fd', '#c7d2fe', '#fecdd3'];

const stateOf = (field: DRFieldSetting): FieldState => (!field.visible ? 'hidden' : field.required ? 'required' : 'optional');

/** What a state means for a field, within what the field allows. */
function patchFor(state: FieldState): Partial<DRFieldSetting> {
  return state === 'hidden' ? { visible: false, required: false } : { visible: true, required: state === 'required' };
}

/** Which states a field may take: locked fields keep theirs, always-shown ones cannot hide, and one required elsewhere is not set here. */
function allowedStates(def: DRFieldDef, current: FieldState): FieldState[] {
  if (def.locked) return [current];
  const states: FieldState[] = def.requiredManagedElsewhere ? ['optional', 'hidden'] : ['required', 'optional', 'hidden'];
  return def.alwaysVisible ? states.filter((s) => s !== 'hidden') : states;
}

const SAMPLE_EDIT: Partial<Record<DRFieldKey, string>> = {
  departmentId: 'Site — Sample',
  partyName: 'Sample Transport Co.',
  projectId: 'Sample Project',
  grossAmount: '₹ 27,500',
  netAmount: '₹ 27,500',
  depNo: 'DEP/SAMPLE/0001',
};

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
  const [tab, setTab] = useState<'form' | 'register'>('form');
  const [mode, setMode] = useState<'add' | 'edit'>('add');
  const [screen, setScreen] = useState<'1366' | '1920'>('1366');

  const live: Draft = useMemo(() => ({ fields: settings.fields, columns: settings.columns }), [settings]);
  const current = draft ?? live;
  const liveFlat = useMemo(() => flattenFieldControl(live), [live]);
  const currentFlat = useMemo(() => flattenFieldControl(current), [current]);
  const changeCount = useMemo(() => Object.keys(diffFields(liveFlat, currentFlat)).length, [liveFlat, currentFlat]);
  const dirty = changeCount > 0;

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

  /* ---- the form ---- */
  const shownCount = DR_FIELD_REGISTRY.filter((def) => current.fields[def.key].visible).length;
  const requiredCount = DR_FIELD_REGISTRY.filter((def) => current.fields[def.key].visible && current.fields[def.key].required).length;
  const onForm = DR_FIELD_REGISTRY.filter((def) => current.fields[def.key].visible && def.forms.includes(mode));
  const hiddenFields = DR_FIELD_REGISTRY.filter((def) => !current.fields[def.key].visible);
  const notOnEdit = mode === 'edit' ? DR_FIELD_REGISTRY.filter((def) => current.fields[def.key].visible && !def.forms.includes('edit')) : [];
  const labelOf = (def: DRFieldDef) => current.fields[def.key].label.trim() || def.defaultLabel;

  /* ---- the register ---- */
  const visibleColumns = current.columns.filter((c) => c.visible);
  const screenPx = Number(screen);
  const available = screenPx - CHROME_PX;
  const needed = visibleColumns.reduce((sum, c) => sum + COLUMN_WIDTH[c.key], 0) + 40;
  const overBy = needed - available;
  const laptopOver = needed > 1366 - CHROME_PX;
  const suggestions = overBy > 0 ? visibleColumns.filter((c) => FIRST_TO_HIDE.includes(c.key) && !drColumnDef(c.key)?.locked) : [];
  const scale = 360 / Math.max(needed, available);
  let running = 40;
  const cutOff: string[] = [];
  for (const column of visibleColumns) {
    running += COLUMN_WIDTH[column.key];
    if (running > available) cutOff.push(drColumnDef(column.key)?.label ?? column.key);
  }

  return (
    <div className={cn(dailyPageContainerClass, 'mx-auto max-w-[1500px] pb-28')}>
      <style>{`
        @keyframes dr-field-drift { to { background-position: 100% 50%; } }
        .dr-field-hero { background-size: 140% 140%; animation: dr-field-drift 18s ease-in-out infinite alternate; }
        @media (prefers-reduced-motion: reduce) { .dr-field-hero { animation: none; } }
      `}</style>

      {/* Where this is */}
      <nav className="mb-3.5 flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/daily-requisition/settings" className="mr-1 grid h-[30px] w-[30px] place-items-center rounded-[9px] border bg-card text-foreground/70 hover:text-foreground" aria-label="Back to settings">
          <ArrowLeft className="h-[15px] w-[15px]" />
        </Link>
        <Link href="/daily-requisition" className="text-foreground/70 hover:underline">
          Daily Requisition
        </Link>
        <span aria-hidden>›</span>
        <Link href="/daily-requisition/settings" className="text-foreground/70 hover:underline">
          Settings
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground">Field Control</span>
      </nav>

      {/* Hero */}
      <section
        className="dr-field-hero relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[22px] p-5 text-white sm:px-[26px] sm:py-[22px]"
        style={{
          backgroundImage:
            'radial-gradient(520px 260px at 95% 0%, #a3e635a0, transparent 65%), radial-gradient(560px 300px at 70% 120%, #2563ebb0, transparent 65%), linear-gradient(115deg, #065f46, #0f766e 40%, #0891b2 75%, #4f46e5)',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(#ffffff14 1px, transparent 1px)',
            backgroundSize: '18px 18px',
            maskImage: 'linear-gradient(90deg, transparent, #000 70%)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 70%)',
          }}
        />
        <span className="relative grid h-[54px] w-[54px] place-items-center rounded-2xl bg-white/15 shadow-[inset_0_1px_0_#ffffff40]">
          <SlidersHorizontal className="h-6 w-6" />
        </span>
        <div className="relative min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">Daily Requisition · Settings</div>
          <h1 className="text-2xl font-extrabold">{TITLE}</h1>
          <p className="text-white/85">{DESCRIPTION}</p>
        </div>
        <span className="flex-1" />
        {[
          { label: 'Fields shown', value: `${shownCount} / ${DR_FIELD_REGISTRY.length}` },
          { label: 'Required', value: String(requiredCount) },
          { label: 'Register columns', value: `${visibleColumns.length}${laptopOver ? ' ⚠' : ''}`, warn: laptopOver },
        ].map((k) => (
          <div key={k.label} className="relative min-w-[110px] rounded-2xl border border-white/20 bg-white/10 px-[15px] py-[9px] backdrop-blur" title={k.warn ? 'Wider than a laptop screen' : undefined}>
            <small className="block text-[11.5px] font-semibold text-teal-100">{k.label}</small>
            <b className={cn('text-xl font-extrabold', k.warn && 'text-amber-200')}>{k.value}</b>
          </div>
        ))}
        {!canEdit && <span className="relative rounded-full bg-white/15 px-2.5 py-0.5 text-[11.5px] font-bold">Read-only</span>}
      </section>

      {issues.length > 0 && (
        <div className="mt-3.5">
          <IssueList issues={issues} />
        </div>
      )}

      {/* Tabs */}
      <div className="my-3.5 flex flex-wrap gap-1.5" role="tablist">
        {(
          [
            { key: 'form', label: 'Entry form', icon: FileText, count: shownCount },
            { key: 'register', label: 'Register columns', icon: Columns3, count: visibleColumns.length },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-2 rounded-[14px] border bg-card px-3.5 py-2 font-bold',
              tab === t.key && 'border-slate-900 bg-slate-900 text-white',
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
            <em className={cn('rounded-full px-2 text-[11.5px] not-italic', tab === t.key ? 'bg-white/15 text-white' : 'bg-muted text-muted-foreground')}>{t.count}</em>
          </button>
        ))}
      </div>

      {tab === 'form' ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* Field rows */}
          <section className="overflow-hidden rounded-[20px] border bg-card">
            <header className="flex flex-wrap items-center gap-3 border-b px-[18px] py-3.5">
              <div className="flex items-center gap-1.5">
                <b className="block text-[14.5px]">Entry form fields</b>
                <InfoTip label="About “Entry form fields”">The Add Entry and Edit Entry dialogs. Leave a label blank to keep the default.</InfoTip>
              </div>
              <span className="flex-1" />
              <div className="flex flex-wrap gap-2.5 text-[11.5px] font-bold text-muted-foreground">
                {(Object.keys(STATE_LOOK) as FieldState[]).map((s) => (
                  <span key={s}>
                    <i className="mr-1 inline-block h-[9px] w-[9px] rounded-[3px] align-[-1px]" style={{ background: STATE_LOOK[s].bar }} />
                    {STATE_LOOK[s].label}
                  </span>
                ))}
              </div>
            </header>
            <ul>
              {DR_FIELD_REGISTRY.map((def) => {
                const field = current.fields[def.key];
                const state = stateOf(field);
                const allowed = allowedStates(def, state);
                const changed = JSON.stringify(field) !== JSON.stringify(live.fields[def.key]);
                const isDefault = field.visible && field.required === def.defaultRequired && !field.label;
                return (
                  <li
                    key={def.key}
                    className="grid grid-cols-[4px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 border-t py-3 pr-[18px] first:border-t-0 hover:bg-muted/30 lg:grid-cols-[4px_minmax(0,1.1fr)_minmax(0,1fr)_auto_30px]"
                  >
                    <span className="row-span-4 self-stretch rounded-r lg:row-span-1" style={{ background: STATE_LOOK[state].bar }} />
                    <div className="min-w-0">
                      <b className="mr-1.5 text-[13.5px]">{def.defaultLabel}</b>
                      {def.helpText ? (
                        <InfoTip label={`About “${def.defaultLabel}”`} className="mr-1.5 align-[-1px]">
                          {def.helpText}
                        </InfoTip>
                      ) : null}
                      <span className="inline-flex flex-wrap gap-1 align-[1px]">
                        <span className="rounded-full bg-muted px-2 py-px text-[11px] font-bold text-muted-foreground">{def.forms.length === 2 ? 'Add · Edit' : 'Add only'}</span>
                        {def.locked && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-px text-[11px] font-bold text-violet-700">
                            <Lock className="h-[11px] w-[11px]" /> Locked
                          </span>
                        )}
                        {!def.locked && def.alwaysVisible && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-px text-[11px] font-bold text-violet-700">
                            <Lock className="h-[11px] w-[11px]" /> Always shown
                          </span>
                        )}
                        {def.requiredManagedElsewhere && (
                          <Link href="/daily-requisition/settings/data-control" className="rounded-full bg-amber-100 px-2 py-px text-[11px] font-bold text-amber-800 hover:underline">
                            Required: set in Data Control
                          </Link>
                        )}
                      </span>
                    </div>
                    <input
                      aria-label={`${def.defaultLabel} label`}
                      className={cn(
                        'col-start-2 w-full rounded-[11px] border bg-card px-2.5 py-2 text-sm outline-none focus:border-violet-400 focus:ring-[3px] focus:ring-violet-500/10 disabled:opacity-60 lg:col-start-auto',
                        field.label && 'border-violet-300 bg-violet-50/60',
                      )}
                      value={field.label}
                      placeholder={def.defaultLabel}
                      maxLength={MAX_LABEL_LENGTH}
                      disabled={readOnly}
                      onChange={(event) => setField(def.key, { label: event.target.value })}
                    />
                    <div className="col-start-2 inline-flex gap-0.5 justify-self-start rounded-[11px] bg-muted p-[3px] lg:col-start-auto" role="radiogroup" aria-label={`${def.defaultLabel} state`}>
                      {(Object.keys(STATE_LOOK) as FieldState[]).map((s) => {
                        const on = state === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={readOnly || !allowed.includes(s)}
                            onClick={() => setField(def.key, patchFor(s))}
                            className={cn(
                              'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-muted-foreground disabled:cursor-not-allowed disabled:opacity-35',
                              on && cn('bg-card shadow-[0_2px_8px_-3px_rgba(15,23,42,0.27)]', STATE_LOOK[s].on),
                            )}
                          >
                            <i className={cn('h-[7px] w-[7px] rounded-full bg-current', on ? 'opacity-100' : 'opacity-50')} />
                            {STATE_LOOK[s].label}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      title="Reset to default"
                      aria-label={`Reset ${def.defaultLabel}`}
                      disabled={readOnly || isDefault}
                      onClick={() => setField(def.key, defaultFieldSettings()[def.key])}
                      className={cn(
                        'col-start-2 grid h-[30px] w-[30px] place-items-center rounded-lg text-slate-300 lg:col-start-auto',
                        !isDefault && 'text-muted-foreground hover:bg-muted',
                        changed && 'text-violet-600',
                      )}
                    >
                      <RotateCcw className="h-[15px] w-[15px]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Live form preview */}
          <aside className="xl:sticky xl:top-4">
            <div className="mb-2.5 flex items-center gap-2">
              <b className="text-sm">Live form preview</b>
              <span className="flex-1" />
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'add', label: 'Add entry' },
                  { value: 'edit', label: 'Edit entry' },
                ]}
              />
            </div>
            <div className="overflow-hidden rounded-[18px] border bg-card shadow-[0_30px_60px_-36px_rgba(15,23,42,0.53)]">
              <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
                <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] text-white" style={{ background: 'linear-gradient(145deg, #fdba74, #ea580c)' }}>
                  <FileText className="h-4 w-4" />
                </span>
                <b className="text-[14.5px]">{mode === 'add' ? 'Add entry' : 'Edit entry · SAMPLE/0001'}</b>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3.5">
                {onForm.map((def) => {
                  const field = current.fields[def.key];
                  const full = def.key === 'description' || def.key === 'attachments';
                  const readOnlyHere = mode === 'edit' && def.locked;
                  return (
                    <div key={def.key} className={cn('flex flex-col gap-1', full && 'col-span-2')}>
                      <label className="text-[11.5px] font-bold text-slate-600">
                        {labelOf(def)} {field.required ? <em className="not-italic text-rose-600">*</em> : <small className="font-semibold text-muted-foreground">(optional)</small>}
                      </label>
                      <div
                        className={cn(
                          'flex min-h-[34px] items-center rounded-[10px] border bg-muted/30 px-2.5 py-1.5 text-[12.5px] text-muted-foreground',
                          def.key === 'attachments' && 'justify-center gap-1.5 border-dashed',
                          readOnlyHere && 'bg-muted',
                        )}
                      >
                        {def.key === 'attachments' ? (
                          <>
                            <Paperclip className="h-3.5 w-3.5" /> Drop files or click to attach
                          </>
                        ) : def.key === 'receptionDate' ? (
                          '05 Nov 2026'
                        ) : def.key === 'description' ? (
                          'What the payment is for'
                        ) : mode === 'edit' ? (
                          SAMPLE_EDIT[def.key] ?? ''
                        ) : (
                          'Select or type…'
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 border-t px-4 py-3">
                <span className="rounded-[10px] border px-3 py-1.5 text-[12.5px] font-bold">Cancel</span>
                <span className="rounded-[10px] bg-gradient-to-r from-teal-700 to-blue-600 px-3 py-1.5 text-[12.5px] font-bold text-white">Save entry</span>
              </div>
            </div>
            {(hiddenFields.length > 0 || notOnEdit.length > 0) && (
              <p className="mt-2.5 rounded-xl border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
                {hiddenFields.length > 0 && (
                  <>
                    <b className="text-foreground/80">Hidden:</b> {hiddenFields.map((d) => d.defaultLabel).join(', ')}.{' '}
                  </>
                )}
                {notOnEdit.length > 0 && (
                  <>
                    <b className="text-foreground/80">Not on Edit:</b> {notOnEdit.map((d) => d.defaultLabel).join(', ')}.
                  </>
                )}
              </p>
            )}
          </aside>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          {/* Column rows */}
          <section className="overflow-hidden rounded-[20px] border bg-card">
            <header className="flex items-center gap-1.5 border-b px-[18px] py-3.5">
              <b className="block text-[14.5px]">Register columns</b>
              <InfoTip label="About “Register columns”">The Entry Sheet table. Reception No., Status and Actions are always shown; Actions stays last.</InfoTip>
            </header>
            <div className="border-b px-[18px] py-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-2.5 text-[12.5px] font-bold">
                About {needed.toLocaleString('en-IN')} px needed of {available.toLocaleString('en-IN')} px on a {screenPx} px screen
                <InfoTip label="About the widths">Widths are estimates from the register&apos;s column caps.</InfoTip>
                <span className="flex-1" />
                {overBy > 0 ? (
                  <span className="rounded-full bg-amber-100 px-2 py-px text-[11px] font-bold text-amber-800">Scrolls sideways · {overBy.toLocaleString('en-IN')} px too wide</span>
                ) : (
                  <span className="rounded-full bg-green-100 px-2 py-px text-[11px] font-bold text-green-800">Fits without scrolling</span>
                )}
              </div>
              <div className="relative h-3.5 rounded-[7px] bg-muted">
                <i
                  className="absolute inset-y-0 left-0 rounded-[7px] transition-[width] duration-300"
                  style={{
                    width: `${Math.min(100, (needed / (1920 - CHROME_PX)) * 100)}%`,
                    background: overBy > 0 ? 'linear-gradient(90deg, #fcd34d, #f97316)' : 'linear-gradient(90deg, #86efac, #16a34a)',
                  }}
                />
                <span className="absolute -bottom-[5px] -top-[5px] w-0.5 bg-slate-900" style={{ left: `${(available / (1920 - CHROME_PX)) * 100}%` }}>
                  <span className="absolute -top-[17px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-extrabold text-muted-foreground">{screenPx} px screen</span>
                </span>
              </div>
              {suggestions.length > 0 && !readOnly && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-amber-800">
                  Suggest hiding:
                  {suggestions.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => edit((previous) => ({ ...previous, columns: setColumnVisibility(previous.columns, c.key, false) }))}
                      className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800"
                    >
                      {drColumnDef(c.key)?.label} ✕
                    </button>
                  ))}
                  <InfoTip label="About hiding columns">Their details are still in the row when opened.</InfoTip>
                </div>
              )}
            </div>
            <ol>
              {current.columns.map((column, index) => {
                const def = drColumnDef(column.key);
                const pinned = def?.pinnedLast;
                const nextIsPinned = drColumnDef(current.columns[index + 1]?.key ?? '')?.pinnedLast;
                return (
                  <li
                    key={column.key}
                    className={cn(
                      'grid grid-cols-[26px_minmax(0,1fr)_auto_auto_auto] items-center gap-2.5 border-t px-[18px] py-2 first:border-t-0',
                      !column.visible && 'bg-muted/40',
                    )}
                  >
                    <span className="text-center text-[11.5px] font-extrabold text-muted-foreground">{index + 1}</span>
                    <span className={cn('min-w-0 truncate text-[13px] font-bold', !column.visible && 'text-muted-foreground line-through')}>
                      {def?.label ?? column.key}{' '}
                      {def?.locked && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-px align-[1px] text-[11px] font-bold text-violet-700 no-underline">
                          <Lock className="h-[11px] w-[11px]" /> {pinned ? 'Always last' : 'Always shown'}
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground">~{COLUMN_WIDTH[column.key]} px</span>
                    <Switch
                      aria-label={`Show ${def?.label ?? column.key}`}
                      checked={column.visible}
                      disabled={readOnly || def?.locked}
                      onCheckedChange={(checked) => edit((previous) => ({ ...previous, columns: setColumnVisibility(previous.columns, column.key, checked) }))}
                    />
                    <span className="flex gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-[26px] w-[26px]"
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
                        className="h-[26px] w-[26px]"
                        aria-label={`Move ${def?.label ?? column.key} down`}
                        disabled={readOnly || pinned || nextIsPinned || index === current.columns.length - 1}
                        onClick={() => edit((previous) => ({ ...previous, columns: moveColumn(previous.columns, index, 'down') }))}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Register preview */}
          <aside className="xl:sticky xl:top-4">
            <div className="mb-2.5 flex items-center gap-2">
              <b className="text-sm">Register preview</b>
              <span className="flex-1" />
              <Segmented
                value={screen}
                onChange={setScreen}
                options={[
                  { value: '1366', label: 'Laptop 1366' },
                  { value: '1920', label: 'Monitor 1920' },
                ]}
              />
            </div>
            <div className="overflow-hidden rounded-[14px] border bg-card px-3.5 pb-1 pt-5">
              <div className="relative h-[170px] py-2.5">
                <div className="absolute left-0 top-2.5 h-[150px] rounded-md bg-muted" style={{ width: 40 * scale }} />
                {(() => {
                  let x = 40 * scale;
                  return visibleColumns.map((column, i) => {
                    const left = x;
                    const width = COLUMN_WIDTH[column.key] * scale;
                    x += width;
                    const beyond = left + width > available * scale + 1;
                    const def = drColumnDef(column.key);
                    return (
                      <div
                        key={column.key}
                        title={def?.label}
                        className="absolute top-2.5 flex h-[150px] items-end justify-center rounded-md pb-2"
                        style={{ left, width: Math.max(2, width - 3), background: def?.locked ? '#e9d5ff' : COLUMN_TINTS[i % COLUMN_TINTS.length], opacity: beyond ? 0.55 : 1 }}
                      >
                        <span className="rotate-180 whitespace-nowrap text-[10.5px] font-bold text-slate-700 [writing-mode:vertical-rl]">{def?.label}</span>
                      </div>
                    );
                  });
                })()}
                <div className="pointer-events-none absolute -left-0.5 top-0.5 h-[166px] rounded-[10px] border-[2.5px] border-slate-900" style={{ width: available * scale + 4 }}>
                  <span className="absolute -top-[11px] left-2.5 rounded-[5px] bg-slate-900 px-1.5 py-px text-[10px] font-extrabold text-white">Visible on {screenPx} px</span>
                </div>
              </div>
            </div>
            <p className="mt-2.5 rounded-xl border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
              {cutOff.length > 0 ? (
                <>
                  On a {screenPx} px screen, people scroll sideways to see: <b className="text-foreground/80">{cutOff.join(', ')}</b>.
                </>
              ) : (
                `Everything is visible on a ${screenPx} px screen.`
              )}
            </p>
          </aside>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        {describeLastUpdate(meta.fieldControl)}
        {canEdit && (
          <>
            <span aria-hidden>·</span>
            <button type="button" className="font-bold text-teal-700 hover:underline" onClick={() => setDraft({ fields: defaultFieldSettings(), columns: defaultColumnSettings() })}>
              Reset everything to defaults
            </button>
          </>
        )}
      </div>

      {/* Unsaved changes */}
      <div
        className={cn(
          'fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-sm text-white shadow-[0_20px_50px_-10px_rgba(15,23,42,0.53)] transition-all duration-200',
          dirty && canEdit ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-[150%] opacity-0',
        )}
        role="status"
      >
        <span>
          <b className="text-emerald-200">{changeCount}</b> unsaved change{changeCount === 1 ? '' : 's'}
          {blocked ? <span className="block text-xs text-rose-300">Fix the errors above to save.</span> : null}
        </span>
        <Button variant="outline" size="sm" className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => setDraft(null)} disabled={saving}>
          Discard
        </Button>
        <Button size="sm" className="bg-white text-slate-900 hover:bg-white/90" onClick={() => void handleSave()} disabled={saving || blocked}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
