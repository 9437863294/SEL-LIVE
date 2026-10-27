'use client';

/**
 * Settings › Company Profile — the company's identity and the look of its printed documents:
 * details, GST registrations, letterhead and print. One draft, one Save (Edit only); each tab
 * previews the draft as it stands. Stored at `settings/companyProfile` through
 * `/api/company-profile`; see src/lib/company-profile.ts. The layout of sidebars, tables and
 * dialogs and the shared text labels live in the same document but are edited on Settings ›
 * Appearance › Layout, Text and Animations; Save here writes them back as they are stored now.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Download, Loader2, Palette, Plus, RotateCcw, Save, ShieldAlert, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { CompanyFooterLine, CompanyLetterhead, PrintedOnLine, SignatureBlock } from '@/components/shared/company-letterhead';
import { LetterheadA4Preview, LetterheadHtmlEditor } from '@/components/shared/letterhead-designer';
import { ChoiceField, Field, PreviewCard, ToggleField, companyProfileFetch, readStoredProfile } from '@/components/appearance/company-profile-part';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile } from '@/hooks/use-company-profile';
import { COMPANY_GST_STATE_CODE } from '@/lib/statutory';
import {
  COMPANY_PROFILE_RESOURCE,
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_CUSTOM_LETTERHEAD,
  sanitizeCompanyProfile,
  type CompanyDesign,
  type CompanyGstRegistration,
  type CustomLetterhead,
  type CompanyProfile,
} from '@/lib/company-profile';

/* ── small field helpers ─────────────────────────────────────────────────────────────────────── */

/** A millimetre value; blank is null. Clamped by the sanitiser on save. */
function MmField({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: number | null; onChange: (value: number | null) => void; disabled: boolean }) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={120}
        step={0.5}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Field>
  );
}

/* ── the page ────────────────────────────────────────────────────────────────────────────────── */

export default function CompanyProfileSettingsPage() {
  const back = useBackNavigation('/settings');
  const { toast } = useToast();
  const { can, isLoading: authzLoading } = useAuthorization();
  const canEdit = can('Edit', COMPANY_PROFILE_RESOURCE);
  const canView = canEdit || can('View', COMPANY_PROFILE_RESOURCE);
  const readOnly = !canEdit;
  const { doc: gstDoc } = useGstRegistrations();

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

  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)), [draft, saved]);
  // The preview runs the draft through the sanitiser, so it shows exactly what Save would store.
  const preview = useMemo(() => (draft ? sanitizeCompanyProfile(draft) : DEFAULT_COMPANY_PROFILE), [draft]);

  const update = (patch: Partial<CompanyProfile>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const updateDesign = <K extends keyof CompanyDesign>(section: K, patch: Partial<CompanyDesign[K]>) =>
    setDraft((current) => (current ? { ...current, design: { ...current.design, [section]: { ...current.design[section], ...patch } } } : current));
  const updateCustom = (patch: Partial<CustomLetterhead>) =>
    setDraft((current) => (current ? { ...current, design: { ...current.design, letterhead: { ...current.design.letterhead, custom: { ...current.design.letterhead.custom, ...patch } } } } : current));
  const setRegistrations = (next: CompanyGstRegistration[]) => update({ gstRegistrations: next });

  const importFromExpenses = () => {
    if (!draft) return;
    const active = gstDoc.registrations.filter((registration) => registration.active);
    if (!active.length) {
      toast({ title: 'Nothing to import', description: 'Expenses › GST registrations has no active registrations.' });
      return;
    }
    const existing = new Map(draft.gstRegistrations.map((registration) => [registration.gstin, registration]));
    const imported = active.map((registration) => ({
      gstin: registration.gstin,
      state: registration.stateName,
      label: registration.label || registration.stateName,
      primary: existing.get(registration.gstin)?.primary ?? false,
    }));
    const others = draft.gstRegistrations.filter((registration) => !imported.some((entry) => entry.gstin === registration.gstin));
    const merged = [...imported, ...others];
    // No primary yet: the head-office state's registration.
    if (!merged.some((registration) => registration.primary)) {
      const home = merged.findIndex((registration) => registration.gstin.startsWith(COMPANY_GST_STATE_CODE));
      if (home >= 0) merged[home] = { ...merged[home], primary: true };
    }
    setRegistrations(merged);
    toast({ title: `${imported.length} registration${imported.length === 1 ? '' : 's'} imported`, description: 'Review them, then save.' });
  };

  const handleSave = async () => {
    if (!draft || !canEdit) return;
    setIsSaving(true);
    try {
      // Layout, text labels and animations are edited on Settings › Appearance: write them back as
      // stored now, not as they were when this page opened.
      const fresh = await readStoredProfile();
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
  };

  const header = (
    <PageHeader
      title="Company Profile"
      description="The company's details, GST registrations, letterhead and print — used by every document and module."
      icon={Building2}
      backHref={back.href}
      backLabel={back.label}
      onBackClick={back.onClick}
      actions={canView && draft ? (
        <>
          {canEdit && dirty && (
            <Button variant="outline" onClick={() => saved && setDraft(saved)} disabled={isSaving}>
              <RotateCcw className="mr-2 h-4 w-4" />Discard changes
            </Button>
          )}
          {canEdit && (
            <Button onClick={handleSave} disabled={!dirty || isSaving}>
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {preview.labels.save}
            </Button>
          )}
        </>
      ) : undefined}
    />
  );

  if (authzLoading || (canView && !draft && !loadError)) {
    return (
      <div className="w-full space-y-4 px-4 sm:px-5">
        {header}
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canView || loadError || !draft) {
    return (
      <div className="w-full space-y-4 px-4 sm:px-5">
        {header}
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <ShieldAlert className="h-12 w-12 text-destructive" />
            <span className="text-sm text-muted-foreground">
              {!canView ? 'You do not have permission to view the company profile settings.' : loadError}
            </span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const lh = draft.design.letterhead;
  const letterheadPreview = (
    <div className="keep-light min-w-0 rounded-lg border bg-white p-4 text-slate-900">
      <CompanyLetterhead profile={preview} title="Payment Voucher" meta={[{ label: 'Voucher No', value: 'PV-0142' }, { label: preview.labels.date, value: '14 Oct 2026' }]} />
      <div className="my-6 h-16 rounded border border-dashed border-slate-300" />
      <SignatureBlock profile={preview} />
      <div className="mt-6 flex flex-col gap-1">
        <PrintedOnLine profile={preview} />
        <CompanyFooterLine profile={preview} />
      </div>
    </div>
  );

  return (
    <div className="w-full px-4 pb-8 sm:px-5">
      {header}
      {readOnly && <p className="mb-3 text-sm text-muted-foreground">Read-only: saving needs the Company Profile › Edit permission.</p>}
      <p className="mb-3 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Palette className="h-4 w-4 shrink-0" aria-hidden="true" />
        Layout, text and animations are on
        <Link href="/settings/appearance/company-layout" className="font-medium text-primary underline-offset-2 hover:underline">Settings › Appearance</Link>.
      </p>

      <Tabs defaultValue="details" className="min-w-0">
        <div className="min-w-0 overflow-x-auto">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Company details</TabsTrigger>
            <TabsTrigger value="letterhead">Letterhead &amp; print</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Company details ── */}
        <TabsContent value="details" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Identity</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Legal name" className="sm:col-span-2"><Input value={draft.legalName} onChange={(e) => update({ legalName: e.target.value })} disabled={readOnly} maxLength={160} /></Field>
                <Field label="Short name"><Input value={draft.shortName} onChange={(e) => update({ shortName: e.target.value })} disabled={readOnly} maxLength={40} /></Field>
                <Field label="Tagline"><Input value={draft.tagline ?? ''} onChange={(e) => update({ tagline: e.target.value })} disabled={readOnly} maxLength={160} /></Field>
                <Field label="CIN" hint="21 characters, e.g. U31200OR1990PLC002345. Left blank when invalid."><Input value={draft.cin ?? ''} onChange={(e) => update({ cin: e.target.value.toUpperCase() })} disabled={readOnly} maxLength={21} /></Field>
                <Field label="PAN" hint="10 characters. Left blank when invalid."><Input value={draft.pan ?? ''} onChange={(e) => update({ pan: e.target.value.toUpperCase() })} disabled={readOnly} maxLength={10} /></Field>
                <Field label="Logo URL" hint="Blank uses the logo from Settings › Appearance › Branding. https only." className="sm:col-span-2">
                  <Input value={draft.logoUrl ?? ''} onChange={(e) => update({ logoUrl: e.target.value })} disabled={readOnly} placeholder="https://…" />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Address &amp; contacts</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Address lines" hint="One per line, up to four." className="sm:col-span-2">
                  <Textarea rows={3} value={draft.addressLines.join('\n')} onChange={(e) => update({ addressLines: e.target.value.split('\n') })} disabled={readOnly} />
                </Field>
                <Field label="City"><Input value={draft.city} onChange={(e) => update({ city: e.target.value })} disabled={readOnly} /></Field>
                <Field label="PIN code"><Input value={draft.pincode} onChange={(e) => update({ pincode: e.target.value })} disabled={readOnly} inputMode="numeric" /></Field>
                <Field label="State"><Input value={draft.state} onChange={(e) => update({ state: e.target.value })} disabled={readOnly} /></Field>
                <Field label="Country"><Input value={draft.country} onChange={(e) => update({ country: e.target.value })} disabled={readOnly} /></Field>
                <Field label="Phone"><Input value={draft.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} disabled={readOnly} /></Field>
                <Field label="Email"><Input type="email" value={draft.email ?? ''} onChange={(e) => update({ email: e.target.value })} disabled={readOnly} /></Field>
                <Field label="Website" className="sm:col-span-2"><Input value={draft.website ?? ''} onChange={(e) => update({ website: e.target.value })} disabled={readOnly} placeholder="https://…" /></Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">GST registrations</CardTitle>
                  <CardDescription className="text-xs">The primary one prints on the letterhead. Invalid GSTINs are dropped on save.</CardDescription>
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={importFromExpenses}><Download className="mr-1.5 h-4 w-4" />Import from Expenses</Button>
                    <Button variant="outline" size="sm" onClick={() => setRegistrations([...draft.gstRegistrations, { gstin: '', state: '', label: '', primary: draft.gstRegistrations.length === 0 }])}>
                      <Plus className="mr-1.5 h-4 w-4" />{preview.labels.add}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-2">
                {draft.gstRegistrations.length === 0 && <p className="text-sm text-muted-foreground">No registrations yet. Import the ones configured in Expenses › GST registrations.</p>}
                {draft.gstRegistrations.map((registration, index) => {
                  const change = (patch: Partial<CompanyGstRegistration>) =>
                    setRegistrations(draft.gstRegistrations.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
                  return (
                    <div key={index} className="grid grid-cols-1 items-end gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                      <Field label="GSTIN"><Input value={registration.gstin} onChange={(e) => change({ gstin: e.target.value.toUpperCase() })} disabled={readOnly} maxLength={15} className="font-mono" /></Field>
                      <Field label="State"><Input value={registration.state} onChange={(e) => change({ state: e.target.value })} disabled={readOnly} /></Field>
                      <Field label="Label"><Input value={registration.label} onChange={(e) => change({ label: e.target.value })} disabled={readOnly} /></Field>
                      <div className="flex gap-1">
                        <Button
                          variant={registration.primary ? 'default' : 'outline'}
                          size="icon"
                          title={registration.primary ? 'Primary registration' : 'Make primary'}
                          aria-label={registration.primary ? 'Primary registration' : 'Make primary'}
                          disabled={readOnly}
                          onClick={() => setRegistrations(draft.gstRegistrations.map((entry, i) => ({ ...entry, primary: i === index })))}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                        {canEdit && (
                          <Button variant="outline" size="icon" title={preview.labels.delete} aria-label={preview.labels.delete} onClick={() => setRegistrations(draft.gstRegistrations.filter((_, i) => i !== index))}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
          <PreviewCard title="Letterhead preview">{letterheadPreview}</PreviewCard>
        </TabsContent>

        {/* ── Letterhead & print ── */}
        <TabsContent value="letterhead" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
                <div className="min-w-0">
                  <CardTitle className="text-base">Letterhead design</CardTitle>
                  <CardDescription className="text-xs">Standard builds it from the options below; Designed lets you lay out the header and footer like a Word document.</CardDescription>
                </div>
                {canEdit && lh.mode === 'custom' && (
                  <Button variant="outline" size="sm" onClick={() => updateCustom({ headerHtml: DEFAULT_CUSTOM_LETTERHEAD.headerHtml, footerHtml: DEFAULT_CUSTOM_LETTERHEAD.footerHtml })}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />Reset to standard design
                  </Button>
                )}
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Mode" value={lh.mode} disabled={readOnly} onChange={(mode) => updateDesign('letterhead', { mode })}
                  options={[{ value: 'standard', label: 'Standard (options)' }, { value: 'custom', label: 'Designed (header & footer editor)' }]} />
              </CardContent>
            </Card>

            {lh.mode === 'custom' && (
              <>
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Header</CardTitle></CardHeader>
                  <CardContent className="min-w-0">
                    <LetterheadHtmlEditor label="Letterhead header" value={lh.custom.headerHtml} onChange={(headerHtml) => updateCustom({ headerHtml })} disabled={readOnly} minHeightClass="min-h-[160px]" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Footer</CardTitle></CardHeader>
                  <CardContent className="min-w-0">
                    <LetterheadHtmlEditor label="Letterhead footer" value={lh.custom.footerHtml} onChange={(footerHtml) => updateCustom({ footerHtml })} disabled={readOnly} minHeightClass="min-h-[80px]" />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Page</CardTitle>
                    <CardDescription className="text-xs">
                      Repeating on every page and the margin apply to documents printed with the repeating letterhead; others print the header once at the top.
                      Page-number fields print in the page margin on current Chrome and Edge (131+) and are left out on older browsers such as Chrome 109.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <ChoiceField label="Show header on" value={lh.custom.headerOn} disabled={readOnly} onChange={(headerOn) => updateCustom({ headerOn })}
                      options={[{ value: 'first', label: 'First page only' }, { value: 'every', label: 'Every page' }]} />
                    <ChoiceField label="Show footer on" value={lh.custom.footerOn} disabled={readOnly} onChange={(footerOn) => updateCustom({ footerOn })}
                      options={[{ value: 'every', label: 'Every page' }, { value: 'last', label: 'Last page (after the content)' }, { value: 'first', label: 'First page (after the content on longer documents)' }]} />
                    <MmField label="Header height (mm)" hint="Blank: as tall as its content." value={lh.custom.headerHeightMm} disabled={readOnly} onChange={(headerHeightMm) => updateCustom({ headerHeightMm })} />
                    <MmField label="Footer height (mm)" hint="Set it to pin the footer to the foot of every sheet." value={lh.custom.footerHeightMm} disabled={readOnly} onChange={(footerHeightMm) => updateCustom({ footerHeightMm })} />
                    <MmField label="Page margins (mm)" hint="Blank keeps each document's own margins." value={lh.custom.marginMm} disabled={readOnly} onChange={(marginMm) => updateCustom({ marginMm })} />
                    <Field label="Footer note" hint="The {{footerNote}} field."><Input value={lh.footerNote ?? ''} onChange={(e) => updateDesign('letterhead', { footerNote: e.target.value })} disabled={readOnly} maxLength={200} /></Field>
                    <Field label="Watermark" hint="Faint text behind printed pages; blank for none."><Input value={lh.watermark ?? ''} onChange={(e) => updateDesign('letterhead', { watermark: e.target.value })} disabled={readOnly} maxLength={40} /></Field>
                  </CardContent>
                </Card>
              </>
            )}

            {lh.mode === 'standard' && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Letterhead</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Layout" value={lh.layout} disabled={readOnly} onChange={(layout) => updateDesign('letterhead', { layout })}
                  options={[{ value: 'center', label: 'Centred' }, { value: 'left', label: 'Left, logo beside' }, { value: 'split', label: 'Split: name left, details right' }]} />
                <ChoiceField label="Name size" value={lh.titleSize} disabled={readOnly} onChange={(titleSize) => updateDesign('letterhead', { titleSize })}
                  options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]} />
                <ChoiceField label="Divider under the header" value={lh.divider} disabled={readOnly} onChange={(divider) => updateDesign('letterhead', { divider })}
                  options={[{ value: 'none', label: 'None' }, { value: 'line', label: 'Thin line' }, { value: 'double', label: 'Double line' }, { value: 'bar', label: 'Thick bar' }]} />
                <Field label="Accent colour" hint="The company name and divider.">
                  <div className="flex gap-2">
                    <Input type="color" value={lh.accentColor} onChange={(e) => updateDesign('letterhead', { accentColor: e.target.value })} disabled={readOnly} className="h-10 w-14 shrink-0 p-1" />
                    <Input value={lh.accentColor} onChange={(e) => updateDesign('letterhead', { accentColor: e.target.value })} disabled={readOnly} maxLength={7} className="font-mono" />
                  </div>
                </Field>
                <ToggleField label="Show logo" checked={lh.showLogo} disabled={readOnly} onChange={(showLogo) => updateDesign('letterhead', { showLogo })} />
                <ToggleField label="Show address" checked={lh.showAddress} disabled={readOnly} onChange={(showAddress) => updateDesign('letterhead', { showAddress })} />
                <ToggleField label="Show GSTIN" checked={lh.showGstin} disabled={readOnly} onChange={(showGstin) => updateDesign('letterhead', { showGstin })} />
                <ToggleField label="Show CIN and PAN" checked={lh.showCin} disabled={readOnly} onChange={(showCin) => updateDesign('letterhead', { showCin })} />
                <ToggleField label="Show phone, email and website" checked={lh.showContacts} disabled={readOnly} onChange={(showContacts) => updateDesign('letterhead', { showContacts })} />
                <Field label="Note above the name" hint="e.g. An ISO 9001:2015 company"><Input value={lh.headerNote ?? ''} onChange={(e) => updateDesign('letterhead', { headerNote: e.target.value })} disabled={readOnly} maxLength={200} /></Field>
                <Field label="Footer note" hint="Printed under the footer line."><Input value={lh.footerNote ?? ''} onChange={(e) => updateDesign('letterhead', { footerNote: e.target.value })} disabled={readOnly} maxLength={200} /></Field>
                <Field label="Watermark" hint="Faint text behind printed pages; blank for none."><Input value={lh.watermark ?? ''} onChange={(e) => updateDesign('letterhead', { watermark: e.target.value })} disabled={readOnly} maxLength={40} /></Field>
              </CardContent>
            </Card>
            )}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Print</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ToggleField label="Show “printed on” date" checked={draft.design.print.showPrintedOn} disabled={readOnly} onChange={(showPrintedOn) => updateDesign('print', { showPrintedOn })} />
                <ToggleField label="Show page numbers" checked={draft.design.print.showPageNumbers} disabled={readOnly} onChange={(showPageNumbers) => updateDesign('print', { showPageNumbers })} />
                <Field label="Signature captions" hint="One per line, up to six. Blank uses Prepared / Checked / Approved from Text labels." className="sm:col-span-2">
                  <Textarea rows={3} value={draft.design.print.signatureLabels.join('\n')} onChange={(e) => updateDesign('print', { signatureLabels: e.target.value.split('\n') })} disabled={readOnly} />
                </Field>
              </CardContent>
            </Card>
          </div>
          <PreviewCard title="Printed document preview">{lh.mode === 'custom' ? <LetterheadA4Preview profile={preview} /> : letterheadPreview}</PreviewCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
