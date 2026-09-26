'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, History, ImageIcon, Loader2, LogIn, Save, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { BrandAssetField } from '@/components/appearance/BrandAssetField';
import { SettingsSection } from '@/components/appearance/controls';
import { VersionHistory } from '@/components/appearance/VersionHistory';
import { useAppearanceAdmin } from '@/components/appearance/use-appearance-admin';
import { cleanText, sanitizeBranding, type CompanyBranding } from '@/lib/appearance/model';

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

/**
 * Company branding: names, logos for light and dark backgrounds, favicon, app icon, and the
 * sign-in page's words. Saving publishes at once as a new version; any earlier version's branding
 * can be restored from the history below.
 */
export default function CompanyBrandingPage() {
  const { data, error, loading, saveBranding, uploadAsset, restore } = useAppearanceAdmin();
  const [draft, setDraft] = useState<CompanyBranding | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

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
          <BrandAssetField kind="logoLight" value={draft.logoLight} onChange={(logoLight) => update({ logoLight })} upload={uploadAsset} background="light" disabled={!canEdit} description="Shown in the top bar in light mode." />
          <BrandAssetField kind="logoDark" value={draft.logoDark} onChange={(logoDark) => update({ logoDark })} upload={uploadAsset} background="dark" disabled={!canEdit} description="Top bar in dark mode, and the sign-in page." />
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

      <SettingsSection title="Sign-in page" icon={LogIn}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <TextField id="b-headline" label="Headline" value={draft.loginHeadline} max={60} disabled={!canEdit} onChange={(loginHeadline) => update({ loginHeadline })} />
            <TextField id="b-highlight" label="Highlighted words" value={draft.loginHighlight} max={40} disabled={!canEdit} onChange={(loginHighlight) => update({ loginHighlight })} />
            <TextField id="b-sub" label="Supporting line" value={draft.loginSubheadline} max={200} disabled={!canEdit} multiline onChange={(loginSubheadline) => update({ loginSubheadline })} />
          </div>
          <div className="keep-light rounded-2xl bg-slate-950 p-6 text-white" aria-label="Sign-in page preview" role="img">
            {draft.logoDark || draft.logoLight ? (
              // eslint-disable-next-line @next/next/no-img-element -- preview of our own uploaded asset
              <img src={(draft.logoDark ?? draft.logoLight)!.url} alt="" className="mb-4 h-10 w-auto object-contain" />
            ) : (
              <p className="mb-4 text-sm font-semibold tracking-[0.18em] text-cyan-100">{draft.shortName.toUpperCase()}</p>
            )}
            <p className="text-2xl font-bold leading-tight">
              {draft.loginHeadline} <span className="text-cyan-300">{draft.loginHighlight}</span>
            </p>
            <p className="mt-2 text-sm text-slate-300">{draft.loginSubheadline}</p>
            <p className="mt-6 text-[11px] text-slate-400">© {draft.companyName}</p>
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
