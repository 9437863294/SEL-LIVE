'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutGrid, PanelLeft, Pin, PinOff, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChoiceGroup, SettingsSection, SwitchRow } from '@/components/appearance/controls';
import { usePreferenceEditor } from '@/components/appearance/use-preference-editor';
import { FloatingNavShowcase } from '@/components/navigation/FloatingNavShowcase';
import { useAuthorization } from '@/hooks/useAuthorization';
import { permissionModules } from '@/lib/permissions';
import type { Density, ModuleGrouping, SidebarDefault, SidebarMode } from '@/lib/appearance/model';
import { cn } from '@/lib/utils';

/**
 * Layout and navigation preferences. Everything here changes how permitted things are arranged —
 * hiding a module tidies the launcher, it does not remove access, and pinning one the user cannot
 * open would show nothing: the launcher only ever lists modules the user may open, and every
 * route, API and Firestore rule keeps enforcing the same permissions as before.
 */
export default function LayoutNavigationPage() {
  const { effective, defaults, ready, set, clear, inherited, setLayout, clearLayout, layoutInherited } = usePreferenceEditor();
  const { can } = useAuthorization();
  const layout = effective.layout;

  // The modules this user may open — the same test the launcher makes.
  const permitted = useMemo(() => Object.keys(permissionModules).filter((name) => can('View Module', name)), [can]);

  if (!ready) return <Skeleton className="h-96 rounded-xl" />;

  const pinned = layout.pinnedModules.filter((name) => permitted.includes(name));
  const hidden = new Set(layout.hiddenModules);
  const togglePin = (name: string) =>
    setLayout('pinnedModules', pinned.includes(name) ? pinned.filter((n) => n !== name) : [...pinned, name]);
  const toggleHidden = (name: string) =>
    setLayout('hiddenModules', hidden.has(name) ? layout.hiddenModules.filter((n) => n !== name) : [...layout.hiddenModules, name]);
  const movePinned = (name: string, by: -1 | 1) => {
    const index = pinned.indexOf(name);
    const target = index + by;
    if (index < 0 || target < 0 || target >= pinned.length) return;
    const next = [...pinned];
    [next[index], next[target]] = [next[target], next[index]];
    setLayout('pinnedModules', next);
  };
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
        icon={Pin}
        description="Pin the modules you use most, hide the ones you never open. This only arranges your own launcher — it never changes what you can open."
      >
        <ChoiceGroup<ModuleGrouping>
          label="Grouping"
          value={layout.moduleGrouping}
          options={[
            { value: 'none', label: 'One list', description: 'Your own order; drag to rearrange.' },
            { value: 'category', label: 'By category', description: 'Finance, projects, people…' },
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
        <div>
          <p className="mb-2 text-sm font-semibold">Your modules</p>
          {permitted.length === 0 ? (
            <p className="text-sm text-muted-foreground">You do not have access to any modules yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border" aria-label="Modules you can open">
              {[...pinned, ...permitted.filter((n) => !pinned.includes(n))].map((name) => {
                const isPinned = pinned.includes(name);
                const isHidden = hidden.has(name);
                const position = pinned.indexOf(name);
                return (
                  <li key={name} className={cn('flex flex-wrap items-center gap-2 px-3 py-2', isHidden && 'bg-muted/40')}>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className={cn('font-medium', isHidden && 'text-muted-foreground line-through')}>{name}</span>
                      {isPinned && <span className="ml-2 text-xs text-muted-foreground">Pinned #{position + 1}</span>}
                      {isHidden && <span className="ml-2 text-xs text-muted-foreground">Hidden from launcher</span>}
                    </span>
                    {isPinned && (
                      <>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${name} up`} disabled={position === 0} onClick={() => movePinned(name, -1)}>
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${name} down`} disabled={position === pinned.length - 1} onClick={() => movePinned(name, 1)}>
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button type="button" variant={isPinned ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5" aria-pressed={isPinned} onClick={() => togglePin(name)} disabled={isHidden}>
                      {isPinned ? <PinOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Pin className="h-3.5 w-3.5" aria-hidden="true" />}
                      {isPinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" aria-pressed={isHidden} onClick={() => toggleHidden(name)}>
                      {isHidden ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
                      {isHidden ? 'Show' : 'Hide'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
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
