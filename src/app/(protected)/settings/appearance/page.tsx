'use client';

import { Monitor, Moon, Palette, RotateCcw, Rows3, Sparkles, Type } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AppearanceGallery } from '@/components/appearance/AppearanceGallery';
import { ChoiceGroup, SettingsSection, type Choice } from '@/components/appearance/controls';
import { usePreferenceEditor } from '@/components/appearance/use-preference-editor';
import { ThemeModeControl } from '@/components/theme/ThemeModeControl';
import {
  ACCENTS,
  FONT_META,
  type AccentId,
  type DashboardView,
  type Density,
  type FontId,
  type MotionPreference,
  type RadiusStyle,
  type TextSize,
} from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

const FONT_FAMILIES: Record<FontId, string> = {
  inter: 'var(--font-inter), ui-sans-serif, system-ui',
  roboto: 'var(--font-roboto-face), ui-sans-serif, system-ui',
  atkinson: 'var(--font-atkinson-face), ui-sans-serif, system-ui',
  system: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

const densityOptions: Choice<Density>[] = [
  { value: 'comfortable', label: 'Comfortable', description: 'More room around controls and cards.' },
  { value: 'standard', label: 'Standard', description: 'The balanced default.' },
  { value: 'compact', label: 'Compact', description: 'Fits more on screen.' },
];

const bars = (gap: string) => (
  <span className={cn('flex flex-col', gap)}>
    <span className="h-1.5 w-full rounded-full bg-muted-foreground/30" />
    <span className="h-1.5 w-4/5 rounded-full bg-muted-foreground/30" />
    <span className="h-1.5 w-3/5 rounded-full bg-muted-foreground/30" />
  </span>
);

export default function MyAppearancePage() {
  const editor = usePreferenceEditor();
  const { effective, defaults, company, resolvedMode, ready, preferences, set, clear, inherited, resetPreferences } = editor;

  if (!ready) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="hidden h-96 rounded-xl xl:block" />
      </div>
    );
  }

  const accentOptions: Choice<AccentId>[] = company.theme.approvedAccents.map((id) => {
    const hex = id === 'brand' ? company.theme.brandColor ?? '#7c3aed' : ACCENTS[id][resolvedMode];
    return {
      value: id,
      label: id === 'brand' ? `${company.branding.shortName} brand` : ACCENTS[id].label,
      preview: <span className="block h-6 w-6 rounded-full ring-2 ring-background ring-offset-1" style={{ background: hex }} />,
    };
  });

  const fontOptions: Choice<FontId>[] = company.theme.approvedFonts.map((id) => ({
    value: id,
    label: FONT_META[id].label,
    description: FONT_META[id].description,
    preview: (
      <span className="block text-lg leading-none" style={{ fontFamily: FONT_FAMILIES[id] }}>
        Aa 0123 ₹
      </span>
    ),
  }));

  const hasChoices = Object.keys(preferences).length > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
      <div className="min-w-0 space-y-4">
        <SettingsSection
          title="Theme"
          icon={Moon}
          description="Light, dark, or follow this device. Follow device switches as soon as your phone or computer does."
          action={
            !inherited('mode') ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => clear('mode')}>
                <RotateCcw className="h-3 w-3" aria-hidden="true" /> Use company default
              </Button>
            ) : (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Company default</span>
            )
          }
        >
          <ThemeModeControl />
        </SettingsSection>

        <SettingsSection title="Colour and shape" icon={Palette} description="The accent colours buttons, links, the active tab and focus rings.">
          <ChoiceGroup
            label="Accent colour"
            description="Only colours your company has approved are offered."
            value={effective.accent}
            options={accentOptions}
            onChange={(value) => set('accent', value)}
            companyDefault={defaults.accent}
            inherited={inherited('accent')}
            onReset={() => clear('accent')}
            columns={4}
          />
          <ChoiceGroup<RadiusStyle>
            label="Border style"
            value={effective.radius}
            options={[
              { value: 'soft', label: 'Soft', preview: <span className="block h-7 w-12 rounded-[0.8rem] border-2 border-foreground/40" /> },
              { value: 'standard', label: 'Standard', preview: <span className="block h-7 w-12 rounded-[0.5rem] border-2 border-foreground/40" /> },
              { value: 'sharp', label: 'Sharp', preview: <span className="block h-7 w-12 rounded-[0.2rem] border-2 border-foreground/40" /> },
            ]}
            onChange={(value) => set('radius', value)}
            companyDefault={defaults.radius}
            inherited={inherited('radius')}
            onReset={() => clear('radius')}
          />
        </SettingsSection>

        <SettingsSection title="Text and spacing" icon={Type} description="Large text scales the whole interface, so nothing is clipped at any density.">
          <ChoiceGroup<TextSize>
            label="Text size"
            value={effective.textSize}
            options={[
              { value: 'small', label: 'Small', preview: <span className="block text-[13px] font-semibold leading-none">Aa</span> },
              { value: 'default', label: 'Default', preview: <span className="block text-[16px] font-semibold leading-none">Aa</span> },
              { value: 'large', label: 'Large', preview: <span className="block text-[20px] font-semibold leading-none">Aa</span> },
            ]}
            onChange={(value) => set('textSize', value)}
            companyDefault={defaults.textSize}
            inherited={inherited('textSize')}
            onReset={() => clear('textSize')}
          />
          <ChoiceGroup<Density>
            label="Display density"
            description="Control heights and card padding across every module."
            value={effective.density}
            options={densityOptions.map((o) => ({ ...o, preview: bars(o.value === 'compact' ? 'gap-0.5' : o.value === 'standard' ? 'gap-1' : 'gap-1.5') }))}
            onChange={(value) => set('density', value)}
            companyDefault={defaults.density}
            inherited={inherited('density')}
            onReset={() => clear('density')}
          />
          <ChoiceGroup
            label="Interface font"
            value={effective.font}
            options={fontOptions}
            onChange={(value) => set('font', value)}
            companyDefault={defaults.font}
            inherited={inherited('font')}
            onReset={() => clear('font')}
            columns={2}
          />
        </SettingsSection>

        <SettingsSection title="Tables and dashboard" icon={Rows3}>
          <ChoiceGroup<Density>
            label="Table row density"
            description="Row height in data tables built on the shared table."
            value={effective.tableDensity}
            options={densityOptions}
            onChange={(value) => set('tableDensity', value)}
            companyDefault={defaults.tableDensity}
            inherited={inherited('tableDensity')}
            onReset={() => clear('tableDensity')}
          />
          <ChoiceGroup<DashboardView>
            label="Default dashboard view"
            description="Which tab the home page opens on."
            value={effective.dashboardView}
            options={[
              { value: 'last', label: 'Last used', description: 'Reopen whichever tab you used last.' },
              { value: 'work', label: 'Your work', description: 'Always start with your work board.' },
              { value: 'modules', label: 'Modules', description: 'Always start with the module launcher.' },
            ]}
            onChange={(value) => set('dashboardView', value)}
            companyDefault={defaults.dashboardView}
            inherited={inherited('dashboardView')}
            onReset={() => clear('dashboardView')}
          />
        </SettingsSection>

        <SettingsSection title="Motion" icon={Sparkles} description="Reduced motion removes slides, fades and animated counters.">
          <ChoiceGroup<MotionPreference>
            label="Animations"
            value={effective.motion}
            options={[
              { value: 'system', label: 'Follow device', description: 'Animate unless this device asks for reduced motion.' },
              { value: 'reduced', label: 'Reduced', description: 'Keep motion to a minimum everywhere.' },
            ]}
            onChange={(value) => set('motion', value)}
            inherited={inherited('motion')}
            onReset={() => clear('motion')}
            companyDefault="system"
            columns={2}
          />
        </SettingsSection>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
          <div>
            <p className="text-sm font-semibold">Reset my preferences</p>
            <p className="text-xs text-muted-foreground">Go back to your company&apos;s defaults for everything on these pages.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={!hasChoices} className="gap-1.5">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset to company defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset your appearance?</AlertDialogTitle>
                <AlertDialogDescription>
                  Theme, accent, text size, density, layout and navigation choices go back to your company&apos;s defaults, on every
                  device you use. Your work and permissions are not affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={resetPreferences}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <aside className="min-w-0 xl:sticky xl:top-[calc(var(--app-header-offset,4rem)+1rem)]" aria-label="Live preview">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
          Live preview — the whole app changes as you choose
        </div>
        <div className="max-h-none overflow-visible rounded-2xl border bg-background p-3 xl:max-h-[calc(100vh-var(--app-header-offset,4rem)-6rem)] xl:overflow-y-auto">
          <AppearanceGallery sections={['dashboard', 'table', 'approval', 'notifications']} />
        </div>
      </aside>
    </div>
  );
}
