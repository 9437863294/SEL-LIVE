'use client';

/**
 * Settings › Company Profile, drawn: the company card, four tabs (Details, GST, Letterhead,
 * Print), the A4 preview beside them and, while anything is unsaved, the save bar. The page
 * (app/(protected)/settings/company-profile/page.tsx) loads and saves; this keeps the open tab,
 * the preview's place and the checks, and hands every edit back as a change to the draft.
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type MouseEventHandler } from 'react';
import Link from 'next/link';
import { Building2, Palette, Printer, Receipt, Stamp, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PreviewToggle, usePreviewPreference } from '@/components/appearance/controls';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsNotice, SettingsPage } from '@/components/settings/settings-ui';
import { useToast } from '@/hooks/use-toast';
import { sanitizeCompanyProfile, type CompanyDesign, type CompanyProfile } from '@/lib/company-profile';
import {
  changedAreas,
  issuesByField,
  mergeImportedRegistrations,
  profileIssues,
  type ImportableRegistration,
  type ProfileArea,
  type ProfileIssue,
} from '@/lib/company-profile-checks';
import { cn } from '@/lib/utils';
import { DetailsTab } from './details-tab';
import { GstTab } from './gst-tab';
import { LetterheadTab } from './letterhead-tab';
import { PrintTab } from './print-tab';
import { AREA_LABEL, CompanyProfileCard, DocumentPreviewPanel, ProfileSaveBar, fieldDomId } from './profile-parts';

const TABS: { id: ProfileArea; label: string; icon: LucideIcon }[] = [
  { id: 'details', label: 'Company details', icon: Building2 },
  { id: 'gst', label: 'GST registrations', icon: Receipt },
  { id: 'letterhead', label: 'Letterhead', icon: Stamp },
  { id: 'print', label: 'Print', icon: Printer },
];

/** Tailwind's `xl`: from here the preview fits beside the form. */
const WIDE_QUERY = '(min-width: 1280px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

function useWideScreen(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => false);
}

export interface CompanyProfileEditorProps {
  /** The profile as stored. */
  saved: CompanyProfile;
  draft: CompanyProfile;
  onDraftChange: (change: (current: CompanyProfile) => CompanyProfile) => void;
  readOnly: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Expenses › GST registrations' active entries, offered for import. */
  importable: ImportableRegistration[];
  /** The Appearance light logo, which documents print when the profile has no logo of its own. */
  brandingLogoUrl: string | null;
  back: { href: string; label: string; onClick?: MouseEventHandler<HTMLAnchorElement> };
}

export function CompanyProfileEditor({
  saved,
  draft,
  onDraftChange,
  readOnly,
  saving,
  onSave,
  onDiscard,
  importable,
  brandingLogoUrl,
  back,
}: CompanyProfileEditorProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<ProfileArea>('details');
  const [goTo, setGoTo] = useState<{ field: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [previewChoice, setPreviewChoice] = usePreviewPreference('company-profile');
  const wide = useWideScreen();
  // Shown where it fits beside the form; on a narrower screen it waits to be asked for.
  const showPreview = previewChoice ?? wide;

  // What Save would store, and what documents print: the Branding logo stands in for a missing one.
  const preview = useMemo(() => sanitizeCompanyProfile(draft), [draft]);
  const printed = useMemo(() => (preview.logoUrl || !brandingLogoUrl ? preview : { ...preview, logoUrl: brandingLogoUrl }), [preview, brandingLogoUrl]);
  const issues = useMemo(() => profileIssues(draft), [draft]);
  const byField = useMemo(() => issuesByField(issues), [issues]);
  const areas = useMemo(() => changedAreas(draft, saved), [draft, saved]);
  const dirty = areas.length > 0;
  const canSave = !readOnly && dirty && !saving && !issues.some((issue) => issue.severity === 'error');

  // A field chosen from the save bar, brought into view once its tab has rendered.
  useEffect(() => {
    if (!goTo) return;
    const element = document.getElementById(fieldDomId(goTo.field));
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element?.focus({ preventScroll: true });
  }, [goTo]);

  // Ctrl+S (⌘S) saves, as in a document.
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (canSave) onSave();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly, canSave, onSave]);

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (readOnly || !dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome 109, on the Windows 7 PCs, asks only when this is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [readOnly, dirty]);

  const update = (patch: Partial<CompanyProfile>) => onDraftChange((current) => ({ ...current, ...patch }));
  const changeLetterhead = (change: (current: CompanyDesign['letterhead']) => CompanyDesign['letterhead']) =>
    onDraftChange((current) => ({ ...current, design: { ...current.design, letterhead: change(current.design.letterhead) } }));
  const changePrint = (patch: Partial<CompanyDesign['print']>) =>
    onDraftChange((current) => ({ ...current, design: { ...current.design, print: { ...current.design.print, ...patch } } }));

  const importRegistrations = () => {
    if (!importable.length) {
      toast({ title: 'Nothing to import', description: 'Expenses › GST registrations has no active registrations.' });
      return;
    }
    onDraftChange((current) => ({ ...current, gstRegistrations: mergeImportedRegistrations(current.gstRegistrations, importable) }));
    toast({ title: `${importable.length} registration${importable.length === 1 ? '' : 's'} imported`, description: 'Review them, then save.' });
  };

  const goToIssue = (issue: ProfileIssue) => {
    setTab(issue.area);
    setGoTo({ field: issue.field });
  };

  return (
    <SettingsPage>
      <PageHeader
        title="Company Profile"
        description="The company's details, GST registrations and the letterhead every document prints with."
        icon={Building2}
        backHref={back.href}
        backLabel={back.label}
        onBackClick={back.onClick}
        badge={readOnly ? <Badge variant="neutral">View only</Badge> : undefined}
        actions={
          <Button variant="outline" asChild>
            <Link href="/settings/appearance/company-layout">
              <Palette className="mr-2 h-4 w-4" aria-hidden="true" />
              Layout &amp; text
            </Link>
          </Button>
        }
      />
      {readOnly && <SettingsNotice>You can look but not change: saving needs the Company Profile › Edit permission.</SettingsNotice>}

      <CompanyProfileCard profile={printed} logoFromBranding={!preview.logoUrl && Boolean(brandingLogoUrl)} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as ProfileArea)} className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <TabsList aria-label="Company profile sections">
            {TABS.map(({ id, label, icon: Icon }) => {
              const unsaved = areas.includes(id);
              const broken = issues.some((issue) => issue.area === id && issue.severity === 'error');
              return (
                <TabsTrigger key={id} value={id} className="gap-1.5">
                  <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" />
                  {/* The short word on a phone, so all four fit across. */}
                  <span className="sm:hidden">{AREA_LABEL[id]}</span>
                  <span className="hidden sm:inline">{label}</span>
                  {id === 'gst' && draft.gstRegistrations.length > 0 && (
                    <span className="rounded-full bg-background/70 px-1.5 text-[10px] font-semibold tabular-nums text-foreground/80">{draft.gstRegistrations.length}</span>
                  )}
                  {(broken || unsaved) && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', broken ? 'bg-rose-500' : 'bg-amber-500')} aria-hidden="true" />}
                  {broken ? <span className="sr-only">(needs a fix)</span> : unsaved ? <span className="sr-only">(unsaved)</span> : null}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {/* While it shows, the preview carries its own Hide button. */}
          {!showPreview && <PreviewToggle visible={false} onToggle={setPreviewChoice} />}
        </div>

        <div className={cn('grid grid-cols-1 gap-4', showPreview && 'xl:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:items-start')}>
          {showPreview && (
            <DocumentPreviewPanel
              profile={printed}
              onHide={() => setPreviewChoice(false)}
              className="mx-auto w-full max-w-md xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:order-last xl:max-w-none"
            />
          )}
          <TabsContent value={tab} className="mt-0 min-w-0">
            {tab === 'details' && (
              <DetailsTab draft={draft} issues={byField} readOnly={readOnly} single={showPreview} brandingLogoUrl={brandingLogoUrl} update={update} />
            )}
            {tab === 'gst' && (
              <GstTab
                rows={draft.gstRegistrations}
                readOnly={readOnly}
                importable={importable}
                addLabel={preview.labels.add}
                deleteLabel={preview.labels.delete}
                onChange={(gstRegistrations) => update({ gstRegistrations })}
                onImport={importRegistrations}
              />
            )}
            {tab === 'letterhead' && (
              <LetterheadTab letterhead={draft.design.letterhead} issues={byField} readOnly={readOnly} single={showPreview} onChange={changeLetterhead} />
            )}
            {tab === 'print' && (
              <PrintTab print={draft.design.print} preview={preview} issues={byField} readOnly={readOnly} single={showPreview} onChange={changePrint} />
            )}
          </TabsContent>
        </div>
      </Tabs>

      {!readOnly && dirty && (
        <ProfileSaveBar
          areas={areas}
          issues={issues}
          saving={saving}
          saveLabel={preview.labels.save}
          onSave={onSave}
          onDiscard={() => setConfirmDiscard(true)}
          onGoTo={goToIssue}
        />
      )}
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard your changes?"
        description="Everything changed since the last save goes back to how it was."
        confirmLabel="Discard changes"
        destructive
        onConfirm={onDiscard}
      />
    </SettingsPage>
  );
}
