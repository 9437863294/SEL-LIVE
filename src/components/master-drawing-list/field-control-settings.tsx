'use client';

/**
 * Settings › Field Control: for each Master Drawing List form, every field's label, whether it is
 * shown, and whether it is required — applied by the forms and checked again by the API. A locked
 * field (the item's description, schedule and scope, the round's submission date…) keeps its place
 * and can only be renamed: the register cannot work without it. Nothing changes until it is saved.
 */

import { useState } from 'react';
import { Lock, RotateCcw, SlidersHorizontal } from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MDL_FORM_KEYS, MDL_FORM_REGISTRY, fieldSetting, type FieldControl, type FieldOverride, type MdlFormKey } from '@/lib/master-drawing-list/settings';
import { cn } from '@/lib/utils';

import { MdlError, MdlLoading } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { ChangeHistory, SaveBar, useSaveSection, useSettingsData } from './settings-parts';

const TAB_LIST = 'flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm';

/** The override without anything equal to the default, or undefined when nothing is left. */
function trimOverride(form: MdlFormKey, key: string, override: FieldOverride): FieldOverride | undefined {
  const def = MDL_FORM_REGISTRY[form].fields.find((field) => field.key === key);
  if (!def) return undefined;
  const out: FieldOverride = {};
  if (override.label && override.label.trim() && override.label.trim() !== def.defaultLabel) out.label = override.label;
  if (!def.locked && override.visible === false) out.visible = false;
  if (!def.locked && override.required !== undefined && override.required !== def.defaultRequired) out.required = override.required;
  return Object.keys(out).length ? out : undefined;
}

export default function FieldControlSettings() {
  const query = useSettingsData();
  const [edits, setEdits] = useState<FieldControl | null>(null);
  const [tab, setTab] = useState<MdlFormKey>('item');
  const { save, saving } = useSaveSection('field-control', () => {
    setEdits(null);
    query.reload();
  });
  const stored = query.data?.settings.fieldControl ?? null;
  if (!query.data || !stored) return query.error ? <MdlError message={query.error} onRetry={query.reload} /> : <MdlLoading />;
  const control = edits ?? stored;
  const { canManage, history } = query.data;
  const dirty = JSON.stringify(control) !== JSON.stringify(stored);

  const setOverride = (form: MdlFormKey, key: string, patch: FieldOverride) => {
    const current = control[form]?.[key] ?? {};
    const next = trimOverride(form, key, { ...current, ...patch });
    const fields = { ...(control[form] ?? {}) };
    if (next) fields[key] = next;
    else delete fields[key];
    const out: FieldControl = { ...control };
    if (Object.keys(fields).length) out[form] = fields;
    else delete out[form];
    setEdits(out);
  };
  const changedIn = (form: MdlFormKey) => Object.keys(control[form] ?? {}).length;

  return (
    <SettingsPage>
      <PageHeader
        icon={SlidersHorizontal}
        title="Field Control"
        description="Rename fields, show or hide them, and make them required or optional — per form. The forms follow it at once, and saving is refused when a required field is empty."
        backHref={`${MDL_BASE}/settings`}
        backLabel="Back to Settings"
        actions={
          canManage ? (
            <Button variant="outline" size="sm" onClick={() => setEdits({})} disabled={!Object.keys(control).length}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" /> All defaults
            </Button>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as MdlFormKey)}>
        <TabsList className={TAB_LIST} aria-label="Forms">
          {MDL_FORM_KEYS.map((form) => (
            <TabsTrigger key={form} value={form} className="shrink-0 gap-1.5">
              {MDL_FORM_REGISTRY[form].title}
              {changedIn(form) > 0 && <span className="rounded-full bg-violet-100 px-1.5 text-[10px] font-semibold leading-4 text-violet-700">{changedIn(form)}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {MDL_FORM_KEYS.map((form) => (
          <TabsContent key={form} value={form} className="mt-4">
            <SettingsSection title={MDL_FORM_REGISTRY[form].title} description={MDL_FORM_REGISTRY[form].description} flush>
              <div className="hidden grid-cols-[minmax(0,1.2fr),minmax(0,1.4fr),6rem,6rem] gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Field</span>
                <span>Label on the form</span>
                <span className="text-center">Shown</span>
                <span className="text-center">Required</span>
              </div>
              <ul className="divide-y">
                {MDL_FORM_REGISTRY[form].fields.map((def) => {
                  const setting = fieldSetting(control, form, def.key);
                  const override = control[form]?.[def.key] ?? {};
                  return (
                    <li key={def.key} className={cn('grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr),minmax(0,1.4fr),6rem,6rem] md:items-center', !setting.visible && 'bg-muted/30')}>
                      <div className="min-w-0">
                        {/* A div, not a p: Badge renders a div, which a p may not contain. */}
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                          {def.defaultLabel}
                          {def.locked && (
                            <Badge variant="neutral" className="gap-1">
                              <Lock className="h-3 w-3" aria-hidden="true" /> Locked
                            </Badge>
                          )}
                          {override.label || override.visible === false || override.required !== undefined ? <Badge variant="progress">Changed</Badge> : null}
                        </div>
                        {def.note && <p className="mt-0.5 text-xs text-muted-foreground">{def.note}</p>}
                      </div>
                      <Input
                        value={override.label ?? ''}
                        onChange={(event) => setOverride(form, def.key, { label: event.target.value })}
                        placeholder={def.defaultLabel}
                        disabled={!canManage}
                        className="h-9"
                        aria-label={`Label for ${def.defaultLabel}`}
                      />
                      <label className="flex items-center gap-2 text-xs text-slate-600 md:justify-center">
                        <Switch checked={setting.visible} onCheckedChange={(visible) => setOverride(form, def.key, { visible, ...(visible ? {} : { required: false }) })} disabled={!canManage || def.locked} aria-label={`Show ${def.defaultLabel}`} />
                        <span className="md:hidden">Shown</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-600 md:justify-center">
                        <Switch checked={setting.required} onCheckedChange={(required) => setOverride(form, def.key, { required })} disabled={!canManage || def.locked || !setting.visible} aria-label={`Require ${def.defaultLabel}`} />
                        <span className="md:hidden">Required</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </SettingsSection>
          </TabsContent>
        ))}
      </Tabs>
      {canManage && <SaveBar dirty={dirty} saving={saving} onSave={() => void save({ forms: control }, 'Field Control is updated; the forms follow it now.')} onReset={() => setEdits(null)} />}
      <ChangeHistory entries={history.fieldControl} />
    </SettingsPage>
  );
}
