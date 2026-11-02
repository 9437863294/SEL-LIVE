'use client';

/**
 * Serial Numbers inside a module's own Settings: the one `serialNumberConfigs/{series}` document
 * that module hands its numbers out from. Each module's page only says which series, who may see
 * and change it, and where Back goes; this loads, shows and saves it. The form is
 * `serial-number-editor.tsx`, and how each module composes its number is `src/lib/document-numbers.ts`.
 *
 * The series used to be edited together on Settings › Serial Nos. (`Settings.Serial No. Config`).
 * Roles still holding that right keep it here — the module pages pass it on beside their own.
 */

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Hash, Loader2, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageAccessDenied } from '@/components/shared/module-shell';
import { SeriesForm, fromDraft, sameDraft, toDraft, type SeriesDraft } from '@/components/settings/serial-number-editor';
import { SettingsNotice, SettingsPage, SettingsSection } from '@/components/settings/settings-ui';
import { useAuth } from '@/components/auth/AuthProvider';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { useToast } from '@/hooks/use-toast';
import { logUserActivity } from '@/lib/activity-logger';
import { nextDocumentNumber, requireDocumentSeries } from '@/lib/document-numbers';
import { db } from '@/lib/firebase';
import type { SerialNumberConfig } from '@/lib/types';

/** The rights the old Settings › Serial Nos. page went by, still honoured on every module's page. */
export const LEGACY_SERIAL_RESOURCE = 'Settings.Serial No. Config';

export function SerialNumberSettings({
  seriesId,
  permissionsLoading,
  canView,
  canEdit,
  editRight,
  activityModule,
  backFallback,
}: {
  seriesId: string;
  /** While roles load, so the page waits rather than flashing "Access Denied". */
  permissionsLoading: boolean;
  canView: boolean;
  canEdit: boolean;
  /** The right that unlocks Save, as the role editor names it — shown to those without it. */
  editRight: string;
  /** Which module the audit row files under. */
  activityModule: string;
  /** The module's Settings page, for Back when there is no history to follow. */
  backFallback: string;
}) {
  const series = requireDocumentSeries(seriesId);
  const back = useBackNavigation(backFallback);
  const { toast } = useToast();
  const { user } = useAuth();

  /** `undefined` while loading; `null` for a series never saved. */
  const [saved, setSaved] = useState<SerialNumberConfig | null | undefined>(undefined);
  const [draft, setDraft] = useState<SeriesDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (permissionsLoading || !canView) return;
    let live = true;
    getDoc(doc(db, 'serialNumberConfigs', series.id))
      .then((snapshot) => {
        if (!live) return;
        const stored = snapshot.exists() ? (snapshot.data() as SerialNumberConfig) : null;
        setSaved(stored);
        setDraft(toDraft(stored ?? series.suggested));
      })
      .catch((error) => {
        console.error('Error fetching serial number config: ', error);
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [permissionsLoading, canView, series]);

  const baseline = useMemo(() => toDraft(saved ?? series.suggested), [saved, series]);

  const header = (
    <PageHeader
      eyebrow={series.moduleName}
      title="Serial Numbers"
      description={`How ${series.name} numbers are made: what goes before and after the running number, and where it stands.`}
      icon={Hash}
      backHref={back.href}
      backLabel={back.label}
      onBackClick={back.onClick}
    />
  );

  if (permissionsLoading || !canView) {
    return (
      <SettingsPage>
        {header}
        {permissionsLoading ? <Skeleton className="h-72 w-full rounded-lg" /> : <PageAccessDenied />}
      </SettingsPage>
    );
  }

  const config = draft ? fromDraft(draft) : null;
  const dirty = draft !== null && (!saved || !sameDraft(draft, baseline));
  const lowered = Boolean(saved && config && config.startingIndex < saved.startingIndex);

  const change = (patch: Partial<SeriesDraft>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  const save = async () => {
    if (!canEdit || !config || !user) return;
    setSaving(true);
    try {
      await setDoc(doc(db, 'serialNumberConfigs', series.id), config);
      await logUserActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        module: activityModule,
        action: 'Update Serial No. Config',
        details: { configuredModule: series.id, newConfig: config },
        recordId: series.id,
        recordRef: series.id,
      });
      setSaved(config);
      setDraft(toDraft(config));
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
      {header}

      <SettingsSection
        title={series.name}
        icon={Hash}
        description={
          saved === undefined
            ? undefined
            : saved
              ? 'Changes apply to the next document numbered.'
              : 'Not saved yet. These are suggested values; the module refuses to number documents until the series is saved.'
        }
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
        {loadFailed ? (
          <SettingsNotice tone="danger" title="Could not load the series">
            Check your connection and reload the page.
          </SettingsNotice>
        ) : !draft ? (
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
        {!canEdit && draft && <SettingsNotice>Your role can see this series but not change it ({editRight}).</SettingsNotice>}
      </SettingsSection>
    </SettingsPage>
  );
}
