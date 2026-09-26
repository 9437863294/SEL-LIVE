'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, History, Loader2, Paintbrush, Rocket, Save, ShieldAlert, SlidersHorizontal, SwatchBook, Undo2, XCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ChoiceGroup, SettingsSection } from '@/components/appearance/controls';
import { floatingNavThemeMeta } from '@/components/navigation/themes';
import { HexColorField } from '@/components/appearance/HexColorField';
import { ThemePreviewFrame } from '@/components/appearance/ThemePreviewFrame';
import { VersionHistory } from '@/components/appearance/VersionHistory';
import { useAppearanceAdmin } from '@/components/appearance/use-appearance-admin';
import { hslToHex, type Hex } from '@/lib/appearance/color';
import { changedPaths } from '@/lib/appearance/diff';
import {
  ACCENTS,
  ALL_ACCENTS,
  CUSTOM_TOKENS,
  DASHBOARD_VIEWS,
  DENSITIES,
  FONTS,
  FONT_META,
  MODULE_GROUPINGS,
  NAV_STYLES,
  RADII,
  SIDEBAR_DEFAULTS,
  SIDEBAR_MODES,
  TEXT_SIZES,
  THEME_MODES,
  cleanText,
  sanitizeConfig,
  type CompanyAppearanceConfig,
  type CompanyDefaults,
  type DarkPresetId,
  type LightPresetId,
} from '@/lib/appearance/model';
import { PRESET_META, SEL_CLASSIC, SEL_MIDNIGHT } from '@/lib/appearance/presets';
import { themeContrastReport } from '@/lib/appearance/resolve';
import { cn } from '@/lib/utils';

const DEVICES = { desktop: { label: 'Desktop', width: 1280 }, tablet: { label: 'Tablet', width: 820 }, mobile: { label: 'Phone', width: 390 } } as const;
type Device = keyof typeof DEVICES;

const TOKEN_LABELS: Record<(typeof CUSTOM_TOKENS)[number], string> = {
  background: 'Page background',
  foreground: 'Text',
  card: 'Cards and dialogs',
  muted: 'Subtle surfaces',
  'muted-foreground': 'Secondary text',
  border: 'Borders and inputs',
  secondary: 'Secondary buttons',
  success: 'Success',
  warning: 'Warning',
  danger: 'Danger',
  'chart-1': 'Chart 1',
  'chart-2': 'Chart 2',
  'chart-3': 'Chart 3',
  'chart-4': 'Chart 4',
  'chart-5': 'Chart 5',
};

const label = (value: string) => value.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function DefaultSelect<K extends keyof CompanyDefaults>({
  field,
  title,
  options,
  config,
  onChange,
  disabled,
  render = label,
}: {
  field: K;
  title: string;
  options: readonly string[];
  config: CompanyAppearanceConfig;
  onChange: (next: CompanyAppearanceConfig) => void;
  disabled?: boolean;
  render?: (value: string) => string;
}) {
  const id = `default-${String(field)}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{title}</Label>
      <Select
        value={String(config.defaults[field])}
        onValueChange={(value) => onChange({ ...config, defaults: { ...config.defaults, [field]: value } })}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {render(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ContrastReport({ config, scheme }: { config: CompanyAppearanceConfig; scheme: 'light' | 'dark' }) {
  const checks = themeContrastReport(config, scheme);
  const failures = checks.filter((c) => !c.pass).length;
  return (
    <div className="rounded-xl border p-3">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {failures ? <XCircle className="h-4 w-4 text-danger" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
        {scheme === 'light' ? 'Light' : 'Dark'} theme: {failures ? `${failures} check${failures > 1 ? 's' : ''} below target` : 'all checks pass'}
      </p>
      <ul className="space-y-1">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5">
              {check.pass ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5 text-danger" aria-hidden="true" />}
              {check.label}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {check.ratio.toFixed(2)}:1 <span className="sr-only">{check.pass ? 'passes' : 'fails'}</span> (needs {check.required}:1)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Theme Management: edit a draft, see it on representative screens before anyone else does,
 * publish it with a note, and restore any earlier version. Publishing changes the company
 * defaults; people who chose for themselves keep their choices.
 */
export default function ThemeManagementPage() {
  const { data, error, loading, saveDraft, publish, restore } = useAppearanceAdmin();
  const [config, setConfig] = useState<CompanyAppearanceConfig | null>(null);
  const [scheme, setScheme] = useState<'light' | 'dark'>('light');
  const [contrast, setContrast] = useState<'standard' | 'high'>('standard');
  const [device, setDevice] = useState<Device>('desktop');
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (data) setConfig(data.draft.config);
  }, [data]);

  const savedDraft = data?.draft.config;
  const dirty = useMemo(() => !!config && !!savedDraft && JSON.stringify({ t: config.theme, d: config.defaults }) !== JSON.stringify({ t: savedDraft.theme, d: savedDraft.defaults }), [config, savedDraft]);
  const pendingChanges = useMemo(() => {
    if (!config || !data) return [];
    return changedPaths({ theme: data.published.theme, defaults: data.published.defaults }, { theme: config.theme, defaults: config.defaults });
  }, [config, data]);

  if (loading && !data) return <Skeleton className="h-96 rounded-xl" />;
  if (error && !data) {
    return (
      <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger/40 p-4 text-sm text-danger">
        <ShieldAlert className="h-4 w-4" aria-hidden="true" /> {error}
      </div>
    );
  }
  if (!data || !config) return null;

  const canEdit = data.rights.editThemes;
  const canPublish = data.rights.publishThemes;
  const edit = (next: CompanyAppearanceConfig) => setConfig(sanitizeConfig(next, config));
  const theme = config.theme;
  const staleDraft = data.draft.basedOnVersion < data.published.version;

  async function doSave() {
    if (!config) return;
    setBusy('save');
    setMessage(null);
    try {
      await saveDraft(config);
      setMessage({ tone: 'success', text: 'Draft saved. Nobody else sees it until it is published.' });
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'The draft could not be saved.' });
    } finally {
      setBusy(null);
    }
  }

  async function doPublish() {
    if (!config) return;
    setBusy('publish');
    setMessage(null);
    try {
      if (dirty) await saveDraft(config);
      const result = await publish(cleanText(note, 200) ?? 'Published theme');
      setPublishOpen(false);
      setNote('');
      setMessage({ tone: 'success', text: `Published as version ${(result.published as { version?: number }).version ?? ''}. New defaults reach everyone who has not chosen their own.` });
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'The theme could not be published.' });
    } finally {
      setBusy(null);
    }
  }

  const baseLight = SEL_CLASSIC;
  const baseDark = SEL_MIDNIGHT;
  const baseHex = (set: typeof SEL_CLASSIC, token: (typeof CUSTOM_TOKENS)[number]): Hex => {
    const [h, s, l] = set[token];
    return hslToHex(h, s, l);
  };

  return (
    <div className="space-y-4">
      {/* Draft status and actions */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            Live: version {data.published.version || 'built-in'} · Draft {data.draft.updatedAt ? `saved ${new Date(data.draft.updatedAt).toLocaleString()} by ${data.draft.updatedBy}` : 'not saved yet'}
            {dirty && <span className="ml-2 rounded-full border border-warning/40 px-1.5 py-0.5 text-[11px] font-medium text-warning">Unsaved changes</span>}
          </p>
          {staleDraft && (
            <p className="mt-0.5 text-xs text-warning">
              This draft started from version {data.draft.basedOnVersion}; version {data.published.version} has been published since. Review it before publishing.
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{pendingChanges.length ? `${pendingChanges.length} change${pendingChanges.length > 1 ? 's' : ''} from what is live.` : 'Matches what is live.'}</p>
        </div>
        {canEdit && (
          <>
            <Button variant="outline" className="gap-1.5" onClick={doSave} disabled={!dirty || busy !== null}>
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Save draft
            </Button>
            <Button variant="ghost" className="gap-1.5" onClick={() => setConfig(data.draft.config)} disabled={!dirty || busy !== null}>
              <Undo2 className="h-4 w-4" aria-hidden="true" /> Discard
            </Button>
          </>
        )}
        {canPublish && (
          <Button className="gap-1.5" onClick={() => setPublishOpen(true)} disabled={!pendingChanges.length || busy !== null}>
            <Rocket className="h-4 w-4" aria-hidden="true" /> Publish
          </Button>
        )}
        {message && (
          <p role="status" className={cn('w-full text-sm font-medium', message.tone === 'success' ? 'text-success' : 'text-danger')}>
            {message.text}
          </p>
        )}
        {!canEdit && <p className="w-full text-xs text-muted-foreground">You can view themes. Editing needs Theme Management: Edit; publishing needs Publish.</p>}
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] 2xl:items-start">
        <div className="min-w-0 space-y-4">
          <SettingsSection title="Presets" icon={SwatchBook} description="The token set used for light and for dark mode.">
            <ChoiceGroup<LightPresetId>
              label="Light mode"
              value={theme.lightPreset}
              options={(['sel-classic', 'high-contrast', 'custom'] as const).map((id) => ({ value: id, label: PRESET_META[id].label, description: PRESET_META[id].description }))}
              onChange={(lightPreset) => edit({ ...config, theme: { ...theme, lightPreset } })}
              disabled={!canEdit}
            />
            <ChoiceGroup<DarkPresetId>
              label="Dark mode"
              value={theme.darkPreset}
              options={(['sel-midnight', 'high-contrast', 'custom'] as const).map((id) => ({ value: id, label: PRESET_META[id].label, description: PRESET_META[id].description }))}
              onChange={(darkPreset) => edit({ ...config, theme: { ...theme, darkPreset } })}
              disabled={!canEdit}
            />
          </SettingsSection>

          {(theme.lightPreset === 'custom' || theme.darkPreset === 'custom') && (
            <SettingsSection title="Custom colours" icon={Paintbrush} description="Hex colours only. Leave a field empty to keep the SEL Classic / Midnight colour. Readable text on status colours is worked out automatically.">
              {(['light', 'dark'] as const)
                .filter((s) => (s === 'light' ? theme.lightPreset : theme.darkPreset) === 'custom')
                .map((s) => (
                  <div key={s}>
                    <p className="mb-2 text-sm font-semibold">{s === 'light' ? 'Light' : 'Dark'} custom theme</p>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {CUSTOM_TOKENS.map((token) => (
                        <HexColorField
                          key={token}
                          label={TOKEN_LABELS[token]}
                          value={theme.custom[s][token]}
                          placeholder={baseHex(s === 'light' ? baseLight : baseDark, token)}
                          disabled={!canEdit}
                          onChange={(hex) => {
                            const overrides = { ...theme.custom[s] };
                            if (hex) overrides[token] = hex;
                            else delete overrides[token];
                            edit({ ...config, theme: { ...theme, custom: { ...theme.custom, [s]: overrides } } });
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </SettingsSection>
          )}

          <SettingsSection title="Colours users may choose" icon={Paintbrush} description="The accents offered on My Appearance. The company colour appears once set.">
            <div className="max-w-xs">
              <HexColorField
                label="Company brand colour"
                value={theme.brandColor ?? undefined}
                placeholder="#c8161d"
                disabled={!canEdit}
                onChange={(hex) => edit({ ...config, theme: { ...theme, brandColor: hex ?? null } })}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Approved accents</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {ALL_ACCENTS.map((id) => {
                  const available = id !== 'brand' || !!theme.brandColor;
                  const checked = theme.approvedAccents.includes(id);
                  const swatch = id === 'brand' ? theme.brandColor ?? '#999999' : ACCENTS[id].light;
                  return (
                    <label key={id} className={cn('flex items-center gap-2 rounded-lg border p-2 text-sm', !available && 'opacity-50')}>
                      <Checkbox
                        checked={checked}
                        disabled={!canEdit || !available}
                        onCheckedChange={(value) =>
                          edit({ ...config, theme: { ...theme, approvedAccents: value ? [...theme.approvedAccents, id] : theme.approvedAccents.filter((a) => a !== id) } })
                        }
                      />
                      <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: swatch }} aria-hidden="true" />
                      {id === 'brand' ? 'Company' : ACCENTS[id].label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Approved fonts</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {FONTS.map((id) => (
                  <label key={id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                    <Checkbox
                      checked={theme.approvedFonts.includes(id)}
                      disabled={!canEdit}
                      onCheckedChange={(value) =>
                        edit({ ...config, theme: { ...theme, approvedFonts: value ? [...theme.approvedFonts, id] : theme.approvedFonts.filter((f) => f !== id) } })
                      }
                    />
                    {FONT_META[id].label}
                  </label>
                ))}
              </div>
            </fieldset>
          </SettingsSection>

          <SettingsSection title="Company defaults" icon={SlidersHorizontal} description="What everyone gets until they choose for themselves. Changing these never overwrites a personal choice.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DefaultSelect field="mode" title="Theme" options={THEME_MODES} config={config} onChange={edit} disabled={!canEdit} render={(v) => (v === 'system' ? 'Follow device' : label(v))} />
              <DefaultSelect field="accent" title="Accent" options={theme.approvedAccents} config={config} onChange={edit} disabled={!canEdit} render={(v) => (v === 'brand' ? 'Company' : ACCENTS[v as keyof typeof ACCENTS]?.label ?? v)} />
              <DefaultSelect field="font" title="Font" options={theme.approvedFonts} config={config} onChange={edit} disabled={!canEdit} render={(v) => FONT_META[v as keyof typeof FONT_META]?.label ?? v} />
              <DefaultSelect field="density" title="Density" options={DENSITIES} config={config} onChange={edit} disabled={!canEdit} />
              <DefaultSelect field="textSize" title="Text size" options={TEXT_SIZES} config={config} onChange={edit} disabled={!canEdit} />
              <DefaultSelect field="radius" title="Border style" options={RADII} config={config} onChange={edit} disabled={!canEdit} />
              <DefaultSelect field="tableDensity" title="Table rows" options={DENSITIES} config={config} onChange={edit} disabled={!canEdit} />
              <DefaultSelect field="navStyle" title="Mobile navigation" options={NAV_STYLES} config={config} onChange={edit} disabled={!canEdit} render={(v) => floatingNavThemeMeta[v as keyof typeof floatingNavThemeMeta]?.label ?? v} />
              <DefaultSelect field="dashboardView" title="Home opens on" options={DASHBOARD_VIEWS} config={config} onChange={edit} disabled={!canEdit} render={(v) => ({ last: 'Last used', work: 'Your work', modules: 'Modules' })[v] ?? v} />
              <DefaultSelect field="sidebarDefault" title="Sidebars start" options={SIDEBAR_DEFAULTS} config={config} onChange={edit} disabled={!canEdit} render={(v) => (v === 'auto' ? "Each module's own" : label(v))} />
              <DefaultSelect field="sidebarMode" title="Module menus" options={SIDEBAR_MODES} config={config} onChange={edit} disabled={!canEdit} render={(v) => (v === 'icons' ? 'Compact icons' : 'Full labels')} />
              <DefaultSelect field="moduleGrouping" title="Launcher grouping" options={MODULE_GROUPINGS} config={config} onChange={edit} disabled={!canEdit} render={(v) => (v === 'category' ? 'By category' : 'One list')} />
              <DefaultSelect field="dashboardCardDensity" title="Dashboard cards" options={DENSITIES} config={config} onChange={edit} disabled={!canEdit} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['stickyHeader', 'breadcrumbs'] as const).map((field) => (
                <label key={field} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  {field === 'stickyHeader' ? 'Sticky page header' : 'Breadcrumbs'}
                  <Switch checked={config.defaults[field]} disabled={!canEdit} onCheckedChange={(value) => edit({ ...config, defaults: { ...config.defaults, [field]: value } })} />
                </label>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection title="Readability" icon={CheckCircle2} description="Contrast of this draft's key pairs against WCAG targets.">
            <div className="grid gap-3 md:grid-cols-2">
              <ContrastReport config={config} scheme="light" />
              <ContrastReport config={config} scheme="dark" />
            </div>
          </SettingsSection>
        </div>

        <div className="min-w-0 space-y-3 2xl:sticky 2xl:top-[calc(var(--app-header-offset,4rem)+1rem)]">
          <div className="flex flex-wrap items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold">Preview{dirty ? ' (unsaved changes included)' : ''}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Select value={scheme} onValueChange={(v) => setScheme(v as 'light' | 'dark')}>
                <SelectTrigger className="h-8 w-28" aria-label="Preview scheme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
              <Select value={contrast} onValueChange={(v) => setContrast(v as 'standard' | 'high')}>
                <SelectTrigger className="h-8 w-36" aria-label="Preview contrast">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard contrast</SelectItem>
                  <SelectItem value="high">High contrast</SelectItem>
                </SelectContent>
              </Select>
              <Select value={device} onValueChange={(v) => setDevice(v as Device)}>
                <SelectTrigger className="h-8 w-28" aria-label="Preview width">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DEVICES) as Device[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DEVICES[d].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ThemePreviewFrame
            key={`${scheme}-${contrast}`}
            config={config}
            scheme={scheme}
            contrast={contrast}
            width={DEVICES[device].width}
            title={`Draft theme preview, ${scheme} mode, ${contrast} contrast, ${DEVICES[device].label} width`}
          />
        </div>
      </div>

      <SettingsSection title="Published versions" icon={History} description="Restore any version's theme, or everything including branding. Each publish and restore is in Settings → Audit Logs.">
        <VersionHistory
          versions={data.versions}
          currentVersion={data.published.version}
          scopes={[
            { scope: 'theme', label: 'Restore theme' },
            { scope: 'all', label: 'Restore everything' },
          ]}
          canRestore={(scope) => canPublish && (scope !== 'all' || data.rights.editBranding)}
          onRestore={restore}
        />
      </SettingsSection>

      <AlertDialog open={publishOpen} onOpenChange={(open) => busy === null && setPublishOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this theme?</AlertDialogTitle>
            <AlertDialogDescription>
              It becomes version {data.published.version + 1} for everyone. People who have chosen their own theme, accent or density keep their choices.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="max-h-40 overflow-y-auto rounded-lg border p-2 text-xs">
              <p className="mb-1 font-semibold">Changes ({pendingChanges.length})</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                {pendingChanges.slice(0, 30).map((path) => (
                  <li key={path}>{path}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="publish-note">Note for the history</Label>
              <Input id="publish-note" value={note} maxLength={200} placeholder="e.g. Brand refresh: teal accent by default" onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(event) => {
                event.preventDefault();
                void doPublish();
              }}
            >
              {busy === 'publish' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
