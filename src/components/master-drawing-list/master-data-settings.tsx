'use client';

/**
 * Settings › Schedules & Scopes: the two lists every drawing item is filed under. Values can be
 * added, renamed, reordered and switched off; a value already on drawings keeps its name (items
 * are filed under it) and can only be switched off, which takes it out of Add Drawing Item and the
 * importer's choices without touching the drawings that use it.
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { masterValuesError, type MasterData, type MasterKind, type MasterValue } from '@/lib/master-drawing-list/settings';
import { cn } from '@/lib/utils';

import { MdlError, MdlLoading } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { ChangeHistory, SaveBar, useSaveSection, useSettingsData } from './settings-parts';

const KIND: Record<MasterKind, { title: string; one: string; description: string }> = {
  schedules: { title: 'Schedules', one: 'schedule', description: 'The contract schedules drawings belong to — Supply, Civil, Electrical and any others the project has.' },
  scopes: { title: 'Scopes', one: 'scope', description: 'Where the drawing is for — Substation, Transmission Line, or others.' },
};

function ValueList({ kind, values, usage, canManage, onChange }: { kind: MasterKind; values: MasterValue[]; usage: Record<string, number>; canManage: boolean; onChange: (values: MasterValue[]) => void }) {
  const [draft, setDraft] = useState('');
  const meta = KIND[kind];
  const move = (index: number, by: number) => {
    const next = [...values];
    const [entry] = next.splice(index, 1);
    next.splice(index + by, 0, entry);
    onChange(next);
  };
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...values, { id: `new-${Date.now().toString(36)}-${values.length}`, name, active: true }]);
    setDraft('');
  };
  return (
    <SettingsSection title={meta.title} icon={ListChecks} description={meta.description} flush>
      <ul className="divide-y">
        {values.map((value, index) => {
          const used = usage[value.name] ?? 0;
          return (
            <li key={value.id} className={cn('flex flex-wrap items-center gap-2 px-4 py-2.5', !value.active && 'bg-muted/30')}>
              <div className="flex shrink-0 flex-col">
                <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(index, -1)} disabled={!canManage || index === 0} aria-label={`Move ${value.name || 'this value'} up`}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-6" onClick={() => move(index, 1)} disabled={!canManage || index === values.length - 1} aria-label={`Move ${value.name || 'this value'} down`}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                value={value.name}
                onChange={(event) => onChange(values.map((entry) => (entry.id === value.id ? { ...entry, name: event.target.value } : entry)))}
                disabled={!canManage || used > 0}
                className="h-9 min-w-0 flex-1 basis-40"
                aria-label={`${meta.one} name`}
                title={used ? `On ${used} drawing${used === 1 ? '' : 's'} — the name stays; switch it off instead` : undefined}
              />
              <Badge variant={used ? 'info' : 'neutral'} className="shrink-0 tabular-nums">
                {used ? `${used} drawing${used === 1 ? '' : 's'}` : 'unused'}
              </Badge>
              <label className="flex shrink-0 items-center gap-2 text-xs text-slate-600">
                <Switch checked={value.active} onCheckedChange={(active) => onChange(values.map((entry) => (entry.id === value.id ? { ...entry, active } : entry)))} disabled={!canManage} aria-label={`${value.name} in use`} />
                {value.active ? 'On' : 'Off'}
              </label>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onChange(values.filter((entry) => entry.id !== value.id))} disabled={!canManage || used > 0} aria-label={`Remove ${value.name}`} title={used ? 'On drawings — switch it off instead' : 'Remove'}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          );
        })}
      </ul>
      {canManage && (
        <div className="flex gap-2 border-t px-4 py-3">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder={`New ${meta.one}`}
            className="h-9 min-w-0 flex-1"
            aria-label={`New ${meta.one}`}
          />
          <Button variant="outline" onClick={add} disabled={!draft.trim()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

export default function MasterDataSettings() {
  const query = useSettingsData();
  // Unsaved edits; null shows what is stored.
  const [edits, setDraft] = useState<MasterData | null>(null);
  const { save, saving } = useSaveSection('master-data', () => {
    setDraft(null);
    query.reload();
  });
  const stored = query.data?.settings.masterData ?? null;
  const draft = edits ?? stored;

  if (!query.data || !draft || !stored) return query.error ? <MdlError message={query.error} onRetry={query.reload} /> : <MdlLoading />;
  const { usage, canManage, history } = query.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);
  const error = masterValuesError('schedules', draft.schedules) ?? masterValuesError('scopes', draft.scopes);

  return (
    <SettingsPage>
      <PageHeader icon={ListChecks} title="Schedules & Scopes" description="The lists every drawing is filed under. Add Drawing Item, the filters and the Excel import all offer these." backHref={`${MDL_BASE}/settings`} backLabel="Back to Settings" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ValueList kind="schedules" values={draft.schedules} usage={usage.schedules} canManage={canManage} onChange={(schedules) => setDraft({ ...draft, schedules })} />
        <ValueList kind="scopes" values={draft.scopes} usage={usage.scopes} canManage={canManage} onChange={(scopes) => setDraft({ ...draft, scopes })} />
      </div>
      {dirty && error && <MdlError message={error} />}
      {canManage && <SaveBar dirty={dirty} saving={saving} onSave={() => !error && void save(draft, 'Schedules and scopes are updated.')} onReset={() => setDraft(null)} />}
      <ChangeHistory entries={history.masterData} />
    </SettingsPage>
  );
}
