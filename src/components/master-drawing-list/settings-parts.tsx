'use client';

/**
 * What the Master Drawing List settings pages share: their data (`/api/master-drawing-list/settings`),
 * saving a section, and the list of recent changes under each page.
 */

import { useState } from 'react';
import { History, Loader2 } from 'lucide-react';

import { SettingsSection } from '@/components/settings/settings-ui';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import type { MdlSettings } from '@/lib/master-drawing-list/settings';

import { mdlFetch, useMdl, useMdlQuery } from './mdl-client';

export interface SettingsChange {
  at: string;
  by: string;
  byName: string;
  summary: string;
}

export interface SettingsData {
  settings: MdlSettings;
  usage: { schedules: Record<string, number>; scopes: Record<string, number> };
  history: { masterData: SettingsChange[]; fieldControl: SettingsChange[]; dateControl: SettingsChange[] };
  canManage: boolean;
}

export function useSettingsData() {
  return useMdlQuery<SettingsData>('settings');
}

/** Saves one section, then reloads the module's lookups so every form picks the change up. */
export function useSaveSection(section: 'master-data' | 'field-control' | 'date-control', onSaved: () => void) {
  const { reload } = useMdl();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const save = async (body: unknown, message: string) => {
    setSaving(true);
    try {
      await mdlFetch(`settings/${section}`, { method: 'PUT', body });
      toast({ title: 'Saved', description: message });
      onSaved();
      void reload();
      return true;
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not save', description: error instanceof Error ? error.message : 'Try again.' });
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

export function SaveBar({ dirty, saving, onSave, onReset, resetLabel = 'Discard changes' }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void; resetLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {dirty && <span className="mr-auto text-xs font-medium text-amber-700">Unsaved changes</span>}
      <Button variant="outline" onClick={onReset} disabled={!dirty || saving}>
        {resetLabel}
      </Button>
      <Button onClick={onSave} disabled={!dirty || saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        Save
      </Button>
    </div>
  );
}

export function ChangeHistory({ entries }: { entries: SettingsChange[] }) {
  return (
    <SettingsSection title="Recent changes" icon={History} description="The last 30 saves of this page, newest first.">
      {entries.length ? (
        <ol className="divide-y">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-3">
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(entry.at))}
              </span>
              <span className="shrink-0 font-medium text-slate-800">{entry.byName}</span>
              <span className="min-w-0 break-words text-slate-600">{entry.summary}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No changes yet — the defaults apply.</p>
      )}
    </SettingsSection>
  );
}
