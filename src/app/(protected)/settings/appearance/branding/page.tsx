'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, History, ImageIcon, Loader2, LogIn, Monitor, Plus, Save, ShieldAlert, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { BrandAssetField } from '@/components/appearance/BrandAssetField';
import { ChoiceGroup, SettingsSection, SwitchRow } from '@/components/appearance/controls';
import { LOGIN_PREVIEW_DEVICES, LoginPreviewFrame, type LoginPreviewDevice } from '@/components/appearance/LoginPreviewFrame';
import { VersionHistory } from '@/components/appearance/VersionHistory';
import { useAppearanceAdmin } from '@/components/appearance/use-appearance-admin';
import {
  LOGIN_DESIGNS,
  LOGIN_DESIGN_META,
  LOGIN_HIGHLIGHT_DESCRIPTION_MAX,
  LOGIN_HIGHLIGHT_LABEL_MAX,
  MAX_LOGIN_HIGHLIGHTS,
  cleanText,
  sanitizeBranding,
  type CompanyBranding,
  type LoginDesignId,
  type LoginHighlight,
} from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

function TextField({
  id,
  label,
  value,
  onChange,
  max,
  disabled,
  multiline,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const Control = multiline ? Textarea : Input;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {value.length}/{max}
        </span>
      </div>
      <Control id={id} value={value} maxLength={max} disabled={disabled} onChange={(event) => onChange(event.target.value)} rows={multiline ? 3 : undefined} />
    </div>
  );
}

/** A thumbnail sketch of each sign-in design, for its option card. Fixed colours, as the designs are. */
function DesignThumb({ design }: { design: LoginDesignId }) {
  const bars = (tone: 'light' | 'dark') => (
    <span className="flex w-full flex-col gap-1">
      <span className={cn('h-1 w-1/2 rounded-full', tone === 'light' ? 'bg-slate-300' : 'bg-white/30')} />
      <span className={cn('h-1.5 w-full rounded-sm', tone === 'light' ? 'bg-slate-200' : 'bg-white/15')} />
      <span className={cn('h-1.5 w-full rounded-sm', tone === 'light' ? 'bg-slate-200' : 'bg-white/15')} />
      <span className="h-1.5 w-full rounded-sm bg-primary" />
    </span>
  );
  const frame = 'keep-light relative flex h-20 w-full overflow-hidden rounded-lg border border-black/5';
  switch (design) {
    case 'horizon':
      return (
        <span className={cn(frame, 'items-center justify-end px-2')} style={{ background: 'linear-gradient(180deg,#050816,#1f1846 60%,#7a2337)' }}>
          <svg viewBox="0 0 100 40" className="absolute inset-x-0 bottom-0 h-3/4 w-full" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
            <path d="M14 40 L18 14 L22 40 M12 19 H24 M11 24 H25 M40 40 L42.5 24 L45 40 M39 27 H46 M60 40 L61.5 31 L63 40 M59.5 33 H64" stroke="#e0e7ff" strokeOpacity="0.7" strokeWidth="0.8" fill="none" />
            <path d="M0 24 Q9 28 18 21 Q30 30 42 26 Q52 32 62 32 Q80 36 100 34" stroke="#fbbf24" strokeOpacity="0.7" strokeWidth="0.5" fill="none" />
            <path d="M0 37 Q50 34 100 36 V40 H0 Z" fill="#05050d" />
          </svg>
          <span className="relative flex w-[42%] rounded-md border border-white/20 bg-[#0a0c22]/60 p-1.5 backdrop-blur-sm">{bars('dark')}</span>
        </span>
      );
    case 'midnight':
      return (
        <span className={cn(frame, 'items-center justify-center bg-[#020617] p-2')}>
          <span className="flex h-full w-full overflow-hidden rounded-md border border-cyan-300/20">
            <span className="flex w-1/2 flex-col items-center justify-center gap-1 bg-gradient-to-br from-cyan-500/20 to-blue-900/30">
              <span className="font-mono text-[10px] font-light text-cyan-300">12:00</span>
            </span>
            <span className="flex flex-1 items-center px-2">{bars('dark')}</span>
          </span>
        </span>
      );
    case 'glass':
      return (
        <span className={cn(frame, 'items-center justify-center bg-[#05060f]')}>
          <span className="absolute -left-3 -top-4 h-12 w-12 rounded-full bg-violet-600/70 blur-md" />
          <span className="absolute -right-2 top-2 h-10 w-10 rounded-full bg-cyan-500/60 blur-md" />
          <span className="absolute -bottom-5 left-1/3 h-12 w-12 rounded-full bg-rose-500/60 blur-md" />
          <span className="relative flex w-[46%] rounded-lg border border-white/20 bg-white/10 p-1.5 backdrop-blur-sm">{bars('dark')}</span>
        </span>
      );
    case 'minimal':
      return (
        <span className={cn(frame, 'flex-col bg-slate-50')}>
          <span className="h-0.5 w-full bg-primary" />
          <span className="flex flex-1 items-center justify-center">
            <span className="flex w-[42%] rounded-md border border-slate-200 bg-white p-1.5 shadow-sm">{bars('light')}</span>
          </span>
        </span>
      );
    case 'blueprint':
      return (
        <span
          className={cn(frame, 'items-center gap-2 p-2')}
          style={{
            backgroundColor: '#0b3a75',
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)',
            backgroundSize: '10px 10px',
          }}
        >
          <svg viewBox="0 0 30 40" className="h-full w-1/2" aria-hidden="true">
            <path d="M8 38 L13.5 8 L15 3 L16.5 8 L22 38 M9 10 H21 M7 15 H23 M10 30 H20 M8 38 L20 30 M22 38 L10 30" stroke="#fff" strokeWidth="0.7" fill="none" />
          </svg>
          <span className="flex flex-1 border border-white/60 bg-[#0a2f5c] p-1.5">
            <span className="flex w-full flex-col gap-1">
              <span className="h-1 w-1/2 bg-white/40" />
              <span className="h-1.5 w-full border border-white/40" />
              <span className="h-1.5 w-full border border-white/40" />
              <span className="h-1.5 w-full bg-white" />
            </span>
          </span>
        </span>
      );
  }
}

/** Up to three short points shown beside the form. A point with no title is dropped on publish. */
function HighlightsEditor({ value, onChange, disabled }: { value: LoginHighlight[]; onChange: (value: LoginHighlight[]) => void; disabled?: boolean }) {
  const set = (index: number, patch: Partial<LoginHighlight>) => onChange(value.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  return (
    <div className="space-y-2.5">
      {value.length === 0 && <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No highlights. Add one to show it beside the form.</p>}
      {value.map((h, i) => (
        <div key={i} className="flex items-start gap-2 rounded-xl border p-3">
          <span className="mt-2 w-5 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <Input aria-label={`Highlight ${i + 1} title`} placeholder="Title" value={h.label} maxLength={LOGIN_HIGHLIGHT_LABEL_MAX} disabled={disabled} onChange={(e) => set(i, { label: e.target.value })} />
            <Input
              aria-label={`Highlight ${i + 1} description`}
              placeholder="One short line (optional)"
              value={h.description}
              maxLength={LOGIN_HIGHLIGHT_DESCRIPTION_MAX}
              disabled={disabled}
              onChange={(e) => set(i, { description: e.target.value })}
            />
          </div>
          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={`Remove highlight ${i + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      {value.length < MAX_LOGIN_HIGHLIGHTS && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={disabled} onClick={() => onChange([...value, { label: '', description: '' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Add highlight
        </Button>
      )}
    </div>
  );
}

/**
 * Company branding: names, logos for light and dark backgrounds, favicon, app icon, and the
 * sign-in page — its design, what it shows, and its words. Saving publishes at once as a new version; any earlier version's branding
 * can be restored from the history below.
 */
export default function CompanyBrandingPage() {
  const { data, error, loading, saveBranding, uploadAsset, restore } = useAppearanceAdmin();
  const [draft, setDraft] = useState<CompanyBranding | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [device, setDevice] = useState<LoginPreviewDevice>('desktop');

  useEffect(() => {
    if (data) setDraft(data.published.branding);
  }, [data]);

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.published.branding), [data, draft]);

  if (loading && !data) return <Skeleton className="h-96 rounded-xl" />;
  if (error && !data) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/40 p-4 text-sm text-danger">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" /> {error}
      </div>
    );
  }
  if (!data || !draft) return null;

  const canEdit = data.rights.editBranding;
  const update = (patch: Partial<CompanyBranding>) => setDraft((current) => (current ? { ...current, ...patch } : current));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await saveBranding(sanitizeBranding(draft), cleanText(note, 200) ?? 'Updated branding');
      setNote('');
      setMessage({ tone: 'success', text: `Published as version ${(result.published as { version?: number }).version ?? ''}. Everyone sees it on their next page load.` });
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Branding could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canEdit && (
        <p className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" /> You can view company branding. Changing it needs the Company Branding: Edit permission.
        </p>
      )}

      <SettingsSection title="Names" icon={Building2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="b-company" label="Company name" value={draft.companyName} max={80} disabled={!canEdit} onChange={(companyName) => update({ companyName })} />
          <TextField id="b-short" label="Short app name" value={draft.shortName} max={24} disabled={!canEdit} onChange={(shortName) => update({ shortName })} />
        </div>
      </SettingsSection>

      <SettingsSection title="Logos and icons" icon={ImageIcon} description="Images are checked for type, size and dimensions, then stored in the company's own storage.">
        <div className="grid gap-3 md:grid-cols-2">
          <BrandAssetField kind="logoLight" value={draft.logoLight} onChange={(logoLight) => update({ logoLight })} upload={uploadAsset} background="light" disabled={!canEdit} description="Top bar in light mode, and the light sign-in design (Minimal)." />
          <BrandAssetField kind="logoDark" value={draft.logoDark} onChange={(logoDark) => update({ logoDark })} upload={uploadAsset} background="dark" disabled={!canEdit} description="Top bar in dark mode, and the dark sign-in designs (Horizon, Midnight, Glass, Blueprint)." />
          <BrandAssetField kind="favicon" value={draft.favicon} onChange={(favicon) => update({ favicon })} upload={uploadAsset} background="light" disabled={!canEdit} description="The browser tab icon." />
          <BrandAssetField
            kind="appIcon"
            value={draft.appIcon}
            onChange={(appIcon) => update({ appIcon })}
            upload={uploadAsset}
            background="light"
            disabled={!canEdit}
            description="Stored for installable web contexts; the Android app's launcher icon is built into the app and is unaffected."
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sign-in page"
        icon={LogIn}
        description="Choose the design everyone sees before they sign in, what it shows, and its words. The preview shows your changes before you publish."
      >
        <ChoiceGroup<LoginDesignId>
          label="Design"
          value={draft.loginDesign}
          columns={3}
          disabled={!canEdit}
          onChange={(loginDesign) => update({ loginDesign })}
          options={LOGIN_DESIGNS.map((id) => ({
            value: id,
            label: LOGIN_DESIGN_META[id].label,
            description: LOGIN_DESIGN_META[id].description,
            preview: <DesignThumb design={id} />,
          }))}
        />

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Preview</p>
              <p className="text-xs text-muted-foreground">As a signed-out visitor sees it, with your unpublished changes.</p>
            </div>
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Preview size">
              {(Object.keys(LOGIN_PREVIEW_DEVICES) as LoginPreviewDevice[]).map((id) => {
                const Icon = id === 'desktop' ? Monitor : Smartphone;
                return (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={device === id ? 'secondary' : 'ghost'}
                    className="h-8 gap-1.5 px-2.5 text-xs"
                    aria-pressed={device === id}
                    onClick={() => setDevice(id)}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {LOGIN_PREVIEW_DEVICES[id].label}
                  </Button>
                );
              })}
            </div>
          </div>
          <LoginPreviewFrame branding={draft} device={device} />
        </div>

        <div className="space-y-2.5">
          <p className="text-sm font-semibold">What to show</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <SwitchRow
              label="Clock"
              description={LOGIN_DESIGN_META[draft.loginDesign].clock ? 'The live time and date.' : `The ${LOGIN_DESIGN_META[draft.loginDesign].label} design has no clock.`}
              checked={draft.loginShowClock}
              disabled={!canEdit}
              onCheckedChange={(loginShowClock) => update({ loginShowClock })}
            />
            <SwitchRow
              label="Highlights"
              description={
                LOGIN_DESIGN_META[draft.loginDesign].highlights
                  ? 'The short points below, on wide screens.'
                  : `The ${LOGIN_DESIGN_META[draft.loginDesign].label} design has no room for highlights.`
              }
              checked={draft.loginShowHighlights}
              disabled={!canEdit}
              onCheckedChange={(loginShowHighlights) => update({ loginShowHighlights })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Headline</p>
              <p className="text-xs text-muted-foreground">
                {LOGIN_DESIGN_META[draft.loginDesign].headline
                  ? 'Beside the form on wide screens.'
                  : `Kept for the other designs — ${LOGIN_DESIGN_META[draft.loginDesign].label} does not show a headline.`}
              </p>
            </div>
            <TextField id="b-headline" label="Headline" value={draft.loginHeadline} max={60} disabled={!canEdit} onChange={(loginHeadline) => update({ loginHeadline })} />
            <TextField id="b-highlight" label="Highlighted words" value={draft.loginHighlight} max={40} disabled={!canEdit} onChange={(loginHighlight) => update({ loginHighlight })} />
            <TextField id="b-sub" label="Supporting line" value={draft.loginSubheadline} max={200} disabled={!canEdit} multiline onChange={(loginSubheadline) => update({ loginSubheadline })} />
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold">Highlights</p>
              <p className="text-xs text-muted-foreground">Up to {MAX_LOGIN_HIGHLIGHTS} short points about what the app does.</p>
            </div>
            <HighlightsEditor value={draft.loginHighlights} disabled={!canEdit} onChange={(loginHighlights) => update({ loginHighlights })} />
          </div>
        </div>
      </SettingsSection>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
          <div className="min-w-[14rem] flex-1 space-y-1.5">
            <Label htmlFor="b-note">What changed (for the history)</Label>
            <Input id="b-note" value={note} maxLength={200} placeholder="e.g. New logo for the 2026 brand refresh" onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button onClick={save} disabled={!dirty || saving} className="gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Publish branding
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(data.published.branding)} disabled={saving}>
              Discard changes
            </Button>
          )}
          {message && (
            <p role="status" className={message.tone === 'success' ? 'w-full text-sm font-medium text-success' : 'w-full text-sm font-medium text-danger'}>
              {message.text}
            </p>
          )}
        </div>
      )}

      <SettingsSection title="History" icon={History} description="Restore the branding from any earlier version. Every change is also in Settings → Audit Logs.">
        <VersionHistory
          versions={data.versions}
          currentVersion={data.published.version}
          scopes={[{ scope: 'branding', label: 'Restore branding' }]}
          canRestore={() => data.rights.editBranding}
          onRestore={restore}
        />
      </SettingsSection>
    </div>
  );
}
