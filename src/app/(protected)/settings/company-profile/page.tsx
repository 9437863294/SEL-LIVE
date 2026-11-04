'use client';

/**
 * Settings › Company Profile — the company's identity and the look of its printed documents:
 * details, GST registrations, letterhead and print. One draft, one Save (Edit only); the editor
 * (components/settings/company-profile) draws it, checks it and previews it. Stored at
 * `settings/companyProfile` through `/api/company-profile`; see src/lib/company-profile.ts. The
 * layout of sidebars, tables and dialogs and the shared text labels live in the same document but
 * are edited on Settings › Appearance › Layout, Text and Animations; Save here writes them back as
 * they are stored now.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SettingsAccessDenied, SettingsNotice, SettingsPage } from '@/components/settings/settings-ui';
import { CompanyProfileEditor } from '@/components/settings/company-profile/profile-editor';
import { CompanyProfileSkeleton } from '@/components/settings/company-profile/profile-parts';
import { companyProfileFetch, readStoredProfile } from '@/components/appearance/company-profile-part';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import { useAppearance } from '@/components/theme/ThemeProvider';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { invalidateCompanyProfile } from '@/hooks/use-company-profile';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { COMPANY_PROFILE_RESOURCE, sanitizeCompanyProfile, type CompanyProfile } from '@/lib/company-profile';

export default function CompanyProfileSettingsPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canEdit = can('Edit', COMPANY_PROFILE_RESOURCE);
  const canView = canEdit || can('View', COMPANY_PROFILE_RESOURCE);
  const { doc: gstDoc } = useGstRegistrations();
  const { company } = useAppearance();

  const [saved, setSaved] = useState<CompanyProfile | null>(null);
  const [draft, setDraft] = useState<CompanyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (authzLoading || !canView) return;
    let cancelled = false;
    readStoredProfile().then(
      (profile) => {
        if (cancelled) return;
        setSaved(profile);
        setDraft(profile);
      },
      (error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load the company profile.'); },
    );
    return () => { cancelled = true; };
  }, [authzLoading, canView]);

  const changeDraft = useCallback((change: (current: CompanyProfile) => CompanyProfile) => {
    setDraft((current) => (current ? change(current) : current));
  }, []);

  const importable = useMemo(
    () => gstDoc.registrations.filter((registration) => registration.active).map(({ gstin, stateName, label }) => ({ gstin, stateName, label })),
    [gstDoc],
  );

  const handleSave = useCallback(async () => {
    if (!draft || !canEdit) return;
    setIsSaving(true);
    try {
      // Layout, text labels and animations are edited on Settings › Appearance: write them back as
      // stored now, not as they were when this page opened.
      const fresh = await readStoredProfile({ fresh: true });
      const body: CompanyProfile = {
        ...draft,
        labels: fresh.labels,
        design: {
          ...draft.design,
          sidebar: fresh.design.sidebar,
          tables: fresh.design.tables,
          dialogs: fresh.design.dialogs,
          animations: fresh.design.animations,
        },
      };
      const result = await companyProfileFetch<{ profile: CompanyProfile; stored: CompanyProfile }>('/api/company-profile', { method: 'PUT', body: JSON.stringify(body) });
      const stored = sanitizeCompanyProfile(result.stored);
      setSaved(stored);
      setDraft(stored);
      invalidateCompanyProfile(result.profile);
      toast({ title: 'Company profile saved', description: 'Letterheads and prints now use it.' });
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setIsSaving(false);
  }, [draft, canEdit, toast]);

  if (!authzLoading && !canView) return <SettingsAccessDenied title="Company Profile" icon={Building2} />;
  if (authzLoading || (!draft && !loadError)) return <CompanyProfileSkeleton />;

  if (loadError || !draft || !saved) {
    return (
      <SettingsPage>
        <PageHeader title="Company Profile" icon={Building2} backHref={back.href} backLabel={back.label} onBackClick={back.onClick} />
        <SettingsNotice tone="danger" title="The company profile did not load">{loadError}</SettingsNotice>
      </SettingsPage>
    );
  }

  return (
    <CompanyProfileEditor
      saved={saved}
      draft={draft}
      onDraftChange={changeDraft}
      readOnly={!canEdit}
      saving={isSaving}
      onSave={handleSave}
      onDiscard={() => setDraft(saved)}
      importable={importable}
      brandingLogoUrl={company.branding.logoLight?.url ?? null}
      back={back}
    />
  );
}
