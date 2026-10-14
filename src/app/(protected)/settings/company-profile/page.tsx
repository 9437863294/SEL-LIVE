'use client';

/**
 * Settings › Company Profile — the company's identity and the shared look of every document,
 * sidebar, table and dialog, plus the app's common words. One draft, one Save (Edit only); each
 * tab previews the draft as it stands. Stored at `settings/companyProfile` through
 * `/api/company-profile`; see src/lib/company-profile.ts.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2, Download, LayoutGrid, Loader2, Plus, RotateCcw, Save, ShieldAlert, Star, Trash2, Type,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/shared/page-header';
import { CompanyFooterLine, CompanyLetterhead, PrintedOnLine, SignatureBlock } from '@/components/shared/company-letterhead';
import { LetterheadA4Preview, LetterheadHtmlEditor } from '@/components/shared/letterhead-designer';
import { useGstRegistrations } from '@/components/expenses/use-gst-registrations';
import { useToast } from '@/hooks/use-toast';
import { useAuthorization } from '@/hooks/useAuthorization';
import { invalidateCompanyProfile } from '@/hooks/use-company-profile';
import { COMPANY_GST_STATE_CODE } from '@/lib/statutory';
import {
  COMPANY_PROFILE_RESOURCE,
  DEFAULT_COMPANY_PROFILE,
  DEFAULT_CUSTOM_LETTERHEAD,
  UI_TEXT_DEFAULTS,
  UI_TEXT_HINTS,
  UI_TEXT_KEYS,
  sanitizeCompanyProfile,
  type CompanyDesign,
  type CompanyGstRegistration,
  type CustomLetterhead,
  type CompanyProfile,
  type UiTextKey,
} from '@/lib/company-profile';
import { cn } from '@/lib/utils';

async function authorizedFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const token = await user.getIdToken();
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The company profile request failed.');
  return data as T;
}

type Option<T extends string> = { value: T; label: string };

/* ── small field helpers ─────────────────────────────────────────────────────────────────────── */

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function ChoiceField<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Option<T>[]; onChange: (value: T) => void; disabled: boolean }) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ToggleField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
      <span className="min-w-0">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  );
}

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

function PreviewCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="min-w-0 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)] xl:self-start">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">The unsaved draft, as it will look.</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

/* ── previews for the layout tab ─────────────────────────────────────────────────────────────── */

function SidebarPreview({ sidebar }: { sidebar: CompanyDesign['sidebar'] }) {
  const width = { narrow: 'w-44', standard: 'w-56', wide: 'w-64' }[sidebar.width];
  const shell = {
    solid: 'bg-slate-900 text-slate-100 border-slate-900',
    soft: 'bg-background border-border/60 shadow-sm',
    minimal: 'bg-transparent border-transparent',
  }[sidebar.style];
  const groups = [
    { label: 'Overview', items: ['Dashboard', 'Reports'] },
    { label: 'Records', items: ['Vouchers', 'Approvals', 'Settings'] },
  ];
  return (
    <div className={cn('max-w-full overflow-hidden rounded-xl border p-2 text-sm', width, shell)}>
      {groups.map((group) => (
        <div key={group.label} className="mb-2">
          {sidebar.showGroupLabels && <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">{group.label}</p>}
          {group.items.map((item) => {
            const active = item === 'Vouchers';
            const indicator = !active
              ? ''
              : sidebar.activeIndicator === 'background'
                ? 'bg-primary text-primary-foreground'
                : sidebar.activeIndicator === 'pill'
                  ? 'rounded-full bg-primary/15 text-primary font-semibold'
                  : 'border-l-4 border-primary font-semibold';
            return (
              <div key={item} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', indicator)}>
                {sidebar.showIcons && <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="truncate">{item}</span>
              </div>
            );
          })}
        </div>
      ))}
      {sidebar.collapsible && <p className="px-2 pt-1 text-[10px] opacity-60">« Collapse</p>}
    </div>
  );
}

function TablePreview({ tables, accent }: { tables: CompanyDesign['tables']; accent: string }) {
  const cell = { auto: 'px-3 py-2', compact: 'px-2 py-1', standard: 'px-3 py-2', comfortable: 'px-4 py-3' }[tables.density];
  const head = { muted: 'bg-muted text-muted-foreground', accent: 'text-white', plain: 'bg-transparent' }[tables.headerStyle];
  const rows = [['PV-0142', '12 Oct 2026', '48,500.00'], ['PV-0143', '13 Oct 2026', '1,20,000.00'], ['PV-0144', '14 Oct 2026', '9,750.00']];
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={cn('w-full min-w-[22rem] text-sm', tables.bordered && 'border')}>
        <thead className={head} style={tables.headerStyle === 'accent' ? { backgroundColor: accent } : undefined}>
          <tr>{['Voucher', 'Date', 'Amount'].map((title) => <th key={title} className={cn(cell, 'text-left font-semibold', tables.bordered && 'border')}>{title}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row[0]} className={cn('border-t', tables.striped && index % 2 === 1 && 'bg-muted/50')}>
              {row.map((value, column) => <td key={column} className={cn(cell, column === 2 && 'text-right tabular-nums', tables.bordered && 'border')}>{value}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {tables.stickyHeader && <p className="mt-1 text-[11px] text-muted-foreground">Headers stay in view while a long table scrolls.</p>}
    </div>
  );
}

function DialogPreview({ dialogs, labels }: { dialogs: CompanyDesign['dialogs']; labels: Record<UiTextKey, string> }) {
  // The real widths (24 / 32 / 42 / 64rem) at a quarter-ish scale, so the preview fits its card.
  const width = { auto: 'max-w-full', sm: 'max-w-[12rem]', md: 'max-w-[16rem]', lg: 'max-w-[21rem]', xl: 'max-w-full' }[dialogs.defaultSize];
  const caption = { auto: 'Each dialog keeps its own size', sm: '24rem wide', md: '32rem wide', lg: '42rem wide', xl: '64rem wide' }[dialogs.defaultSize];
  const footer = { end: 'justify-end', between: 'justify-between', stretch: '[&>*]:flex-1' }[dialogs.footerAlign];
  return (
    <div className={cn('w-full rounded-xl border bg-background p-4 shadow-md', width)}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{caption}</p>
      <p className="font-semibold">{labels.confirmDeleteTitle}</p>
      <p className="mt-1 text-sm text-muted-foreground">{labels.confirmDeleteDescription}</p>
      <div className={cn('mt-4 flex gap-2', footer)}>
        <Button variant="outline" size="sm" type="button">{labels.cancel}</Button>
        <Button variant="destructive" size="sm" type="button">{labels.delete}</Button>
      </div>
    </div>
  );
}

/* ── the page ────────────────────────────────────────────────────────────────────────────────── */

export default function CompanyProfileSettingsPage() {
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
    authorizedFetch<CompanyProfile>('/api/company-profile?stored=1').then(
      (raw) => {
        if (cancelled) return;
        const profile = sanitizeCompanyProfile(raw);
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
  const setLabel = (key: UiTextKey, value: string) => setDraft((current) => (current ? { ...current, labels: { ...current.labels, [key]: value } } : current));
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
      const result = await authorizedFetch<{ profile: CompanyProfile; stored: CompanyProfile }>('/api/company-profile', { method: 'PUT', body: JSON.stringify(draft) });
      const stored = sanitizeCompanyProfile(result.stored);
      setSaved(stored);
      setDraft(stored);
      invalidateCompanyProfile(result.profile);
      toast({ title: 'Company profile saved', description: 'Letterheads, prints and labels now use it.' });
    } catch (error) {
      toast({ title: 'Could not save', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    }
    setIsSaving(false);
  };

  const header = (
    <PageHeader
      title="Company Profile"
      description="The company's details, letterhead, layout and wording — used by every document and module."
      icon={Building2}
      backHref="/settings"
      backLabel="Back to settings"
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

      <Tabs defaultValue="details" className="min-w-0">
        <div className="min-w-0 overflow-x-auto">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Company details</TabsTrigger>
            <TabsTrigger value="letterhead">Letterhead &amp; print</TabsTrigger>
            <TabsTrigger value="layout">Layout: sidebar, tables &amp; dialogs</TabsTrigger>
            <TabsTrigger value="labels">Text labels</TabsTrigger>
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

        {/* ── Layout ── */}
        <TabsContent value="layout" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Module sidebar</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Style" value={draft.design.sidebar.style} disabled={readOnly} onChange={(style) => updateDesign('sidebar', { style })}
                  options={[{ value: 'soft', label: 'Soft panel' }, { value: 'solid', label: 'Solid dark' }, { value: 'minimal', label: 'Minimal' }]} />
                <ChoiceField label="Width" value={draft.design.sidebar.width} disabled={readOnly} onChange={(width) => updateDesign('sidebar', { width })}
                  options={[{ value: 'narrow', label: 'Narrow' }, { value: 'standard', label: 'Standard' }, { value: 'wide', label: 'Wide' }]} />
                <ChoiceField label="Active item" value={draft.design.sidebar.activeIndicator} disabled={readOnly} onChange={(activeIndicator) => updateDesign('sidebar', { activeIndicator })}
                  options={[{ value: 'background', label: 'Filled background' }, { value: 'pill', label: 'Tinted pill' }, { value: 'bar', label: 'Side bar' }]} />
                <ToggleField label="Show icons" checked={draft.design.sidebar.showIcons} disabled={readOnly} onChange={(showIcons) => updateDesign('sidebar', { showIcons })} />
                <ToggleField label="Show group headings" checked={draft.design.sidebar.showGroupLabels} disabled={readOnly} onChange={(showGroupLabels) => updateDesign('sidebar', { showGroupLabels })} />
                <ToggleField label="Collapsible to an icon rail" checked={draft.design.sidebar.collapsible} disabled={readOnly} onChange={(collapsible) => updateDesign('sidebar', { collapsible })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Tables</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Row density" value={draft.design.tables.density} disabled={readOnly} onChange={(density) => updateDesign('tables', { density })}
                  options={[{ value: 'auto', label: 'Automatic (each user’s Appearance setting)' }, { value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'comfortable', label: 'Comfortable' }]} />
                <ChoiceField label="Header row" value={draft.design.tables.headerStyle} disabled={readOnly} onChange={(headerStyle) => updateDesign('tables', { headerStyle })}
                  options={[{ value: 'muted', label: 'Muted' }, { value: 'accent', label: 'Accent colour' }, { value: 'plain', label: 'Plain' }]} />
                <ToggleField label="Striped rows" checked={draft.design.tables.striped} disabled={readOnly} onChange={(striped) => updateDesign('tables', { striped })} />
                <ToggleField label="Cell borders" checked={draft.design.tables.bordered} disabled={readOnly} onChange={(bordered) => updateDesign('tables', { bordered })} />
                <ToggleField label="Sticky header row" checked={draft.design.tables.stickyHeader} disabled={readOnly} onChange={(stickyHeader) => updateDesign('tables', { stickyHeader })} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Dialogs</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ChoiceField label="Width of dialogs that set none" value={draft.design.dialogs.defaultSize} disabled={readOnly} onChange={(defaultSize) => updateDesign('dialogs', { defaultSize })}
                  options={[{ value: 'auto', label: 'Automatic (each dialog’s own size)' }, { value: 'sm', label: 'Small — 24rem' }, { value: 'md', label: 'Medium — 32rem' }, { value: 'lg', label: 'Large — 42rem' }, { value: 'xl', label: 'Extra large — 64rem' }]} />
                <ChoiceField label="Footer buttons" value={draft.design.dialogs.footerAlign} disabled={readOnly} onChange={(footerAlign) => updateDesign('dialogs', { footerAlign })}
                  options={[{ value: 'end', label: 'Right-aligned' }, { value: 'between', label: 'Spread apart' }, { value: 'stretch', label: 'Full width' }]} />
              </CardContent>
            </Card>
          </div>
          <PreviewCard title="Layout preview">
            <div className="min-w-0 space-y-5">
              <SidebarPreview sidebar={preview.design.sidebar} />
              <TablePreview tables={preview.design.tables} accent={preview.design.letterhead.accentColor} />
              <DialogPreview dialogs={preview.design.dialogs} labels={preview.labels} />
            </div>
          </PreviewCard>
        </TabsContent>

        {/* ── Text labels ── */}
        <TabsContent value="labels" className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <Card className="min-w-0">
            <CardHeader className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base"><Type className="h-4 w-4" />Text labels</CardTitle>
                <CardDescription className="text-xs">The words shared by every module. A blank field falls back to the default.</CardDescription>
              </div>
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => update({ labels: { ...UI_TEXT_DEFAULTS } })}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />Reset all
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {UI_TEXT_KEYS.map((key) => (
                <Field key={key} label={UI_TEXT_DEFAULTS[key]} hint={UI_TEXT_HINTS[key] ?? `Key: ${key}`}>
                  <div className="flex gap-1">
                    <Input value={draft.labels[key]} onChange={(e) => setLabel(key, e.target.value)} disabled={readOnly} maxLength={key === 'confirmDeleteDescription' ? 300 : 120} />
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        title="Reset to default"
                        aria-label={`Reset “${UI_TEXT_DEFAULTS[key]}” to default`}
                        disabled={draft.labels[key] === UI_TEXT_DEFAULTS[key]}
                        onClick={() => setLabel(key, UI_TEXT_DEFAULTS[key])}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </Field>
              ))}
            </CardContent>
          </Card>
          <PreviewCard title="Labels preview">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['save', 'cancel', 'edit', 'add', 'export', 'print', 'refresh'] as const).map((key) => (
                  <Button key={key} size="sm" variant={key === 'save' ? 'default' : 'outline'} type="button">{preview.labels[key]}</Button>
                ))}
              </div>
              <Input placeholder={`${preview.labels.search}…`} readOnly />
              <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">{preview.labels.noRecords}</p>
              <DialogPreview dialogs={preview.design.dialogs} labels={preview.labels} />
              <div className="keep-light rounded-lg border bg-white p-3 text-slate-900">
                <SignatureBlock profile={preview} className="mt-0" />
              </div>
            </div>
          </PreviewCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
