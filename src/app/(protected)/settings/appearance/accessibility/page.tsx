'use client';

import { useSyncExternalStore } from 'react';
import { CheckCircle2, Contrast, Keyboard, Sparkles, Type } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/appearance/AppearanceGallery';
import { ChoiceGroup, SettingsSection } from '@/components/appearance/controls';
import { usePreferenceEditor } from '@/components/appearance/use-preference-editor';
import type { ContrastPreference, MotionPreference, TextSize } from '@/lib/appearance/model';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function useDeviceReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(REDUCED_QUERY);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

/**
 * Accessibility choices. These sit at the top of the precedence order: high contrast replaces the
 * company theme's colours for this user, and reduced motion applies whatever any theme says.
 */
export default function AccessibilityPage() {
  const { effective, defaults, ready, set, clear, inherited } = usePreferenceEditor();
  const deviceReduced = useDeviceReducedMotion();
  if (!ready) return <Skeleton className="h-96 rounded-xl" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div className="min-w-0 space-y-4">
        <SettingsSection title="Contrast" icon={Contrast} description="High contrast uses black and white surfaces, strong borders and a thicker focus outline — in light and dark.">
          <ChoiceGroup<ContrastPreference>
            label="Colour contrast"
            value={effective.contrast}
            options={[
              { value: 'standard', label: 'Standard', description: 'Your company theme.' },
              { value: 'high', label: 'High contrast', description: 'Overrides the theme for you.' },
            ]}
            onChange={(value) => set('contrast', value)}
            companyDefault="standard"
            inherited={inherited('contrast')}
            onReset={() => clear('contrast')}
            columns={2}
          />
        </SettingsSection>

        <SettingsSection
          title="Motion"
          icon={Sparkles}
          description={deviceReduced ? 'This device is set to reduce motion, and SEL Live follows it.' : 'This device is not asking for reduced motion.'}
        >
          <ChoiceGroup<MotionPreference>
            label="Animations"
            value={effective.motion}
            options={[
              { value: 'system', label: 'Follow device', description: deviceReduced ? 'Currently reduced.' : 'Currently animated.' },
              { value: 'reduced', label: 'Always reduce', description: 'Whatever the device says.' },
            ]}
            onChange={(value) => set('motion', value)}
            companyDefault="system"
            inherited={inherited('motion')}
            onReset={() => clear('motion')}
            columns={2}
          />
        </SettingsSection>

        <SettingsSection title="Text size" icon={Type} description="Scales the whole interface, spacing included, so large text is never clipped.">
          <ChoiceGroup<TextSize>
            label="Text size"
            value={effective.textSize}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'default', label: 'Default' },
              { value: 'large', label: 'Large' },
            ]}
            onChange={(value) => set('textSize', value)}
            companyDefault={defaults.textSize}
            inherited={inherited('textSize')}
            onReset={() => clear('textSize')}
          />
        </SettingsSection>
      </div>

      <aside className="min-w-0 space-y-4">
        <SettingsSection title="Keyboard and screen readers" icon={Keyboard}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <kbd className="rounded border px-1 text-xs">Tab</kbd> and <kbd className="rounded border px-1 text-xs">Shift</kbd>+
              <kbd className="rounded border px-1 text-xs">Tab</kbd> move between controls; every one shows a focus outline.
            </li>
            <li>
              In a group of options, the arrow keys move the selection; <kbd className="rounded border px-1 text-xs">Space</kbd> picks.
            </li>
            <li>Tab strips follow the arrow keys too; the bottom bar on phones is a labelled navigation landmark.</li>
            <li>Saving is announced: &quot;Saving…&quot;, &quot;Saved&quot;, or what went wrong.</li>
          </ul>
        </SettingsSection>
        <SettingsSection title="Status is never colour alone" icon={CheckCircle2} description="Approvals and statuses carry a word and an icon as well as a colour.">
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="success">Approved</StatusBadge>
            <StatusBadge tone="warning">Pending</StatusBadge>
            <StatusBadge tone="danger">Rejected</StatusBadge>
            <StatusBadge tone="info">In review</StatusBadge>
          </div>
        </SettingsSection>
      </aside>
    </div>
  );
}
