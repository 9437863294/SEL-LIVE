'use client';

/**
 * Settings › Serial Nos. — the document-number series the modules hand out, one
 * `serialNumberConfigs/{series}` document each. Every series is loaded up front so the list can show
 * what each hands out next; edits are kept per series until saved, so switching between them loses
 * nothing. How each module composes its number is `src/lib/document-numbers.ts`; the list and the
 * form are `serial-number-editor.tsx`.
 */

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Hash, ListOrdered, Loader2, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { SeriesForm, SeriesList, fromDraft, sameDraft, toDraft, type SeriesDraft } from '@/components/settings/serial-number-editor';
import { SettingsAccessDenied, SettingsNotice, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { ACTIVITY_MODULES } from '@/lib/activity-modules';
import { DOCUMENT_SERIES, nextDocumentNumber } from '@/lib/document-numbers';
import { db } from '@/lib/firebase';
import type { SerialNumberConfig } from '@/lib/types';

export default function SerialNoConfigurationPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = useAuthorization();
  const canView = can('View', 'Settings.Serial No. Config');
  const canEdit = can('Edit', 'Settings.Serial No. Config');

  /** Each series' saved config; `null` for one never saved. */
  const [stored, setStored] = useState<Record<string, SerialNumberConfig | null> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SeriesDraft>>({});
  const [selectedId, setSelectedId] = useState(DOCUMENT_SERIES[0].id);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canView) return;
    let live = true;
    Promise.all(
      DOCUMENT_SERIES.map(async (series) => {
        const snapshot = await getDoc(doc(db, 'serialNumberConfigs', series.id));
        return [series.id, snapshot.exists() ? (snapshot.data() as SerialNumberConfig) : null] as const;
      }),
    )
      .then((entries) => {
        if (!live) return;
        const next = Object.fromEntries(entries) as Record<string, SerialNumberConfig | null>;
        setStored(next);
        setDrafts(Object.fromEntries(DOCUMENT_SERIES.map((series) => [series.id, toDraft(next[series.id] ?? series.suggested)])));
      })
      .catch((error) => {
        console.error('Error fetching serial number configs: ', error);
        toast({ title: 'Could not load the series', description: 'Check your connection and reload the page.', variant: 'destructive' });
      });
    return () => {
      live = false;
    };
  }, [canView, toast]);

  const series = DOCUMENT_SERIES.find((entry) => entry.id === selectedId) ?? DOCUMENT_SERIES[0];
  const draft = drafts[series.id];
  const saved = stored?.[series.id] ?? null;
  const baseline = useMemo(() => toDraft(saved ?? series.suggested), [saved, series]);

  if (!canView) return <SettingsAccessDenied title="Serial No. Configuration" icon={Hash} />;

  const config = draft ? fromDraft(draft) : null;
  const dirty = Boolean(draft) && (!saved || !sameDraft(draft, baseline));
  const lowered = Boolean(saved && config && config.startingIndex < saved.startingIndex);

  const change = (patch: Partial<SeriesDraft>) => setDrafts((current) => ({ ...current, [series.id]: { ...current[series.id], ...patch } }));

  const save = async () => {
    if (!canEdit || !config || !user) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'serialNumberConfigs', series.id), config);
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        // `module` is which module the log row files under, not which module's
        // serial config was edited — that stays in details as configuredModule.
        module: ACTIVITY_MODULES.SETTINGS,
        action: 'Update Serial No. Config',
        details: { configuredModule: series.id, newConfig: config },
        recordId: series.id,
        recordRef: series.id,
      });
      setStored((current) => ({ ...current, [series.id]: config }));
      setDrafts((current) => ({ ...current, [series.id]: toDraft(config) }));
      toast({ title: 'Series saved', description: `${series.name} hands out ${nextDocumentNumber(series, config) ?? 'its next number'} next.` });
    } catch (error) {
      console.error('Error saving configuration: ', error);
      toast({ title: 'Not saved', description: 'Check your connection and try again.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPage>
      <PageHeader
        title="Serial Nos."
        description="The numbering of documents each module creates: what goes before and after the running number, and where it stands."
        icon={Hash}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start">
        <SettingsSection title="Series" icon={ListOrdered} flush>
          <SeriesList stored={stored} drafts={drafts} selectedId={series.id} onSelect={setSelectedId} />
        </SettingsSection>

        <SettingsSection
          title={series.name}
          icon={Hash}
          description={saved ? 'Changes apply to the next document numbered.' : 'Not saved yet. These are suggested values; the module refuses to number documents until the series is saved.'}
          footer={
            canEdit && draft ? (
              <>
                {dirty && saved && (
                  <Button variant="ghost" onClick={() => change(baseline)} disabled={saving}>
                    <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                    Undo changes
                  </Button>
                )}
                <Button onClick={() => void save()} disabled={saving || !dirty || !config}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {saved ? 'Save' : 'Save and start numbering'}
                </Button>
              </>
            ) : undefined
          }
        >
          {!draft ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[0, 1, 2, 3].map((field) => <Skeleton key={field} className="h-16 rounded-lg" />)}
            </div>
          ) : (
            <SeriesForm series={series} draft={draft} disabled={!canEdit} onChange={change} />
          )}
          {lowered && config && saved && (
            <SettingsNotice tone="warning" title="Lower than the saved running number">
              {config.startingIndex === saved.startingIndex - 1
                ? `${config.startingIndex} may already be on a document, and would be handed out again.`
                : `Numbers ${config.startingIndex} to ${saved.startingIndex - 1} may already be on documents, and would be handed out again.`}
            </SettingsNotice>
          )}
          {!canEdit && <SettingsNotice>Your role can see the series but not change them (Serial No. Config › Edit).</SettingsNotice>}
        </SettingsSection>
      </div>
    </SettingsPage>
  );
}
