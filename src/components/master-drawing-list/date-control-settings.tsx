'use client';

/**
 * Settings › Date Control: how far back — and ahead — submission, comments and approve dates may be
 * entered in Drawing Details, for every drawing list, or a list's own rule. A list's rule is
 * complete, not a patch: it keeps its numbers when the rule for every list changes.
 *
 * Off (the default) means no back-dating limit; dates still cannot be later than today. Only dates
 * entered or changed are checked, so records already on file are never refused for an old date.
 */

import { useState } from 'react';
import { CalendarClock, Layers, Plus, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/page-header';
import { SettingsNotice, SettingsPage, SettingsSection, SwitchRow } from '@/components/settings/settings-ui';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MAX_BACKDATE_DAYS, MAX_FUTURE_DAYS, describeDateRule, type MdlDateControl, type MdlDateRule } from '@/lib/master-drawing-list/settings';

import { useMdl } from './mdl-client';
import { MdlError, MdlLoading } from './mdl-ui';
import { MDL_BASE } from './module-layout-shell';
import { ChangeHistory, SaveBar, useSaveSection, useSettingsData } from './settings-parts';

const days = (raw: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(raw) || 0)));

function RuleEditor({ rule, disabled, onChange }: { rule: MdlDateRule; disabled: boolean; onChange: (rule: MdlDateRule) => void }) {
  return (
    <div className="space-y-4">
      <SwitchRow label="Limit how far back dates may go" description={describeDateRule(rule)} checked={rule.enabled} onCheckedChange={(enabled) => onChange({ ...rule, enabled })} disabled={disabled} />
      {rule.enabled && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Days back allowed (0 = today only)</Label>
              <Input type="number" min={0} max={MAX_BACKDATE_DAYS} inputMode="numeric" value={rule.backdateDays} onChange={(event) => onChange({ ...rule, backdateDays: days(event.target.value, MAX_BACKDATE_DAYS) })} disabled={disabled} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Days ahead allowed (0 = not later than today)</Label>
              <Input type="number" min={0} max={MAX_FUTURE_DAYS} inputMode="numeric" value={rule.futureDays} onChange={(event) => onChange({ ...rule, futureDays: days(event.target.value, MAX_FUTURE_DAYS) })} disabled={disabled} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Applies to</p>
            {(
              [
                ['applySubmission', 'Submission dates'],
                ['applyComments', 'Comments dates'],
                ['applyApproval', 'Approve dates'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-slate-700">
                <Checkbox checked={rule[key]} onCheckedChange={(checked) => onChange({ ...rule, [key]: checked === true })} disabled={disabled} />
                {label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function DateControlSettings() {
  const { lookups } = useMdl();
  const query = useSettingsData();
  const [edits, setEdits] = useState<MdlDateControl | null>(null);
  const [adding, setAdding] = useState<string>('');
  const { save, saving } = useSaveSection('date-control', () => {
    setEdits(null);
    query.reload();
  });
  const stored = query.data?.settings.dateControl ?? null;
  if (!query.data || !stored || !lookups) return query.error ? <MdlError message={query.error} onRetry={query.reload} /> : <MdlLoading />;
  const control = edits ?? stored;
  const { canManage, history } = query.data;
  const dirty = JSON.stringify(control) !== JSON.stringify(stored);
  const own = control.projects ?? {};
  const shortOf = (code: string) => lookups.projects.find((project) => project.code === code)?.short ?? code;
  const { projects: _projects, ...allRule } = control;
  const free = lookups.projects.filter((project) => !own[project.code]);

  const setAll = (rule: MdlDateRule) => setEdits({ ...rule, projects: own });
  const setOwn = (code: string, rule: MdlDateRule | null) => {
    const projects = { ...own };
    if (rule) projects[code] = rule;
    else delete projects[code];
    setEdits({ ...allRule, projects });
  };

  return (
    <SettingsPage>
      <PageHeader
        icon={CalendarClock}
        title="Date Control"
        description="How far back and ahead submission, comments and approve dates may be entered. Only dates entered or changed are checked; records already on file are never refused for an old date."
        backHref={`${MDL_BASE}/settings`}
        backLabel="Back to Settings"
      />
      <SettingsSection title="Every drawing list" icon={CalendarClock} description="The rule each list follows unless it has its own below.">
        <RuleEditor rule={allRule} disabled={!canManage} onChange={setAll} />
      </SettingsSection>

      <SettingsSection title="Lists with their own rule" icon={Layers} description="A list's own rule is complete: it keeps its numbers when the rule above changes.">
        <div className="space-y-4">
          {Object.keys(own).length === 0 && <SettingsNotice tone="info">Every drawing list follows the rule above.</SettingsNotice>}
          {Object.entries(own).map(([code, rule]) => (
            <div key={code} className="rounded-lg border p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="font-medium text-slate-800">{shortOf(code)}</p>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => setOwn(code, null)}>
                    <Trash2 className="mr-1.5 h-4 w-4 text-destructive" aria-hidden="true" /> Follow the rule above
                  </Button>
                )}
              </div>
              <RuleEditor rule={rule} disabled={!canManage} onChange={(next) => setOwn(code, next)} />
            </div>
          ))}
          {canManage && free.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={adding} onValueChange={setAdding}>
                <SelectTrigger className="w-60 text-left" aria-label="Drawing list">
                  <SelectValue placeholder="Choose a drawing list" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {free.map((project) => (
                    <SelectItem key={project.code} value={project.code}>
                      {project.short}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  if (!adding) return;
                  setOwn(adding, { ...allRule });
                  setAdding('');
                }}
                disabled={!adding}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Give it its own rule
              </Button>
            </div>
          )}
        </div>
      </SettingsSection>

      {canManage && <SaveBar dirty={dirty} saving={saving} onSave={() => void save(control, 'Date Control is updated.')} onReset={() => setEdits(null)} />}
      <ChangeHistory entries={history.dateControl} />
    </SettingsPage>
  );
}
