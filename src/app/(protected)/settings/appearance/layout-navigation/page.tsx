'use client';

import { LayoutDashboard, LayoutGrid, PanelLeft, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChoiceGroup, SettingsSection, SwitchRow } from '@/components/appearance/controls';
import { usePreferenceEditor } from '@/components/appearance/use-preference-editor';
import { FloatingNavShowcase } from '@/components/navigation/FloatingNavShowcase';
import type { Density, ModuleGrouping, SidebarDefault, SidebarMode } from '@/lib/appearance/model';

/**
 * Layout and navigation preferences. Everything here changes how permitted things are arranged —
 * the launcher only ever lists modules the user may open, and every route, API and Firestore rule
 * keeps enforcing the same permissions as before.
 */
export default function LayoutNavigationPage() {
  const { effective, defaults, ready, set, clear, inherited, setLayout, clearLayout, layoutInherited } = usePreferenceEditor();
  const layout = effective.layout;

  if (!ready) return <Skeleton className="h-96 rounded-xl" />;

  const densityOptions = [
    { value: 'comfortable' as Density, label: 'Comfortable' },
    { value: 'standard' as Density, label: 'Standard' },
    { value: 'compact' as Density, label: 'Compact' },
  ];

  return (
    <div className="space-y-4">
      <SettingsSection title="Sidebars" icon={PanelLeft} description="How module menus open on larger screens. Phones always use the menu sheet and bottom bar.">
        <ChoiceGroup<SidebarDefault>
          label="Collapsible sidebars start"
          value={layout.sidebarDefault}
          options={[
            { value: 'auto', label: "Each module's own", description: 'Open the way each sidebar was designed.' },
            { value: 'expanded', label: 'Expanded', description: 'Labels showing.' },
            { value: 'collapsed', label: 'Collapsed', description: 'A slim icon rail.' },
          ]}
          onChange={(value) => setLayout('sidebarDefault', value)}
          companyDefault={defaults.sidebarDefault}
          inherited={layoutInherited('sidebarDefault')}
          onReset={() => clearLayout('sidebarDefault')}
          columns={3}
        />
        <ChoiceGroup<SidebarMode>
          label="Module menus"
          description="The menu beside each module's pages."
          value={layout.sidebarMode}
          options={[
            { value: 'labels', label: 'Full labels', description: 'Icon and name for every page.' },
            { value: 'icons', label: 'Compact icons', description: 'Icons only; names on hover and focus.' },
          ]}
          onChange={(value) => setLayout('sidebarMode', value)}
          companyDefault={defaults.sidebarMode}
          inherited={layoutInherited('sidebarMode')}
          onReset={() => clearLayout('sidebarMode')}
          columns={2}
        />
      </SettingsSection>

      <SettingsSection title="Page chrome" icon={LayoutGrid}>
        <SwitchRow
          label="Sticky page header"
          description="Keep the top bar in view while you scroll."
          checked={layout.stickyHeader}
          onCheckedChange={(value) => setLayout('stickyHeader', value)}
          inherited={layoutInherited('stickyHeader')}
          onReset={() => clearLayout('stickyHeader')}
        />
        <SwitchRow
          label="Breadcrumbs"
          description="Show where you are — Home › Module › Page — under the top bar."
          checked={layout.breadcrumbs}
          onCheckedChange={(value) => setLayout('breadcrumbs', value)}
          inherited={layoutInherited('breadcrumbs')}
          onReset={() => clearLayout('breadcrumbs')}
        />
      </SettingsSection>

      <SettingsSection
        title="Home launcher"
        icon={LayoutDashboard}
        description="How the Modules tab on the home page arranges your cards. This only arranges your own launcher — it never changes what you can open."
      >
        <ChoiceGroup<ModuleGrouping>
          label="Grouping"
          value={layout.moduleGrouping}
          options={[
            { value: 'none', label: 'One list', description: 'Your own order; drag to rearrange.' },
            { value: 'category', label: 'By group', description: "Under your company's module groups." },
          ]}
          onChange={(value) => setLayout('moduleGrouping', value)}
          companyDefault={defaults.moduleGrouping}
          inherited={layoutInherited('moduleGrouping')}
          onReset={() => clearLayout('moduleGrouping')}
          columns={2}
        />
        <ChoiceGroup<Density>
          label="Dashboard card density"
          value={layout.dashboardCardDensity}
          options={densityOptions}
          onChange={(value) => setLayout('dashboardCardDensity', value)}
          companyDefault={defaults.dashboardCardDensity}
          inherited={layoutInherited('dashboardCardDensity')}
          onReset={() => clearLayout('dashboardCardDensity')}
        />
      </SettingsSection>

      <SettingsSection
        title="Mobile navigation style"
        icon={Smartphone}
        description="The floating bar at the bottom of each module on phones and tablets."
        action={
          !inherited('navStyle') ? (
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => clear('navStyle')}>
              Use company default
            </Button>
          ) : undefined
        }
      >
        <FloatingNavShowcase value={effective.navStyle} onChange={(value) => set('navStyle', value)} />
      </SettingsSection>
    </div>
  );
}
