'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CarFront,
  FileArchive,
  Fuel,
  Gauge,
  GitBranch,
  History,
  LocateFixed,
  Landmark,
  Leaf,
  RefreshCw,
  Settings,
  ScrollText,
  Shield,
  ShieldAlert,
  Truck,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import {
  SIDEBAR_ICONS_DIVIDER,
  SIDEBAR_ICONS_GRID,
  SidebarNavTooltip,
  useSidebarIconsOnly,
} from '@/components/navigation/use-sidebar-mode';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleMobileHeader } from '@/components/shared/page-header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { VM_ACCENT_FILL, VM_TONES, type VmTone } from './vm-ui';

// ─── Sections ─────────────────────────────────────────────────────────────────

const sections: Array<{ href: string; label: string; resource: string; icon: LucideIcon; tone: VmTone; group: string }> = [
  { href: '/vehicle-management',                label: 'Overview',        resource: '',                          icon: Gauge,       tone: 'emerald', group: 'core' },
  { href: '/vehicle-management/renewals',       label: 'Renewals Hub',    resource: '',                          icon: RefreshCw,   tone: 'rose', group: 'core' },
  { href: '/vehicle-management/renewals/history', label: 'Renewal History', resource: '',                        icon: History,     tone: 'slate', group: 'core' },
  { href: '/vehicle-management/vehicle-health', label: 'Vehicle Health',  resource: 'Vehicle Master',            icon: Activity,    tone: 'emerald', group: 'core' },
  { href: '/vehicle-management/vehicle-master', label: 'Vehicle Master',  resource: 'Vehicle Master',            icon: CarFront,    tone: 'blue', group: 'fleet' },
  { href: '/vehicle-management/insurance/workflow', label: 'Insurance Workflow', resource: 'Insurance Management', icon: GitBranch, tone: 'violet', group: 'compliance' },
  { href: '/vehicle-management/insurance',      label: 'Insurance',       resource: 'Insurance Management',     icon: Shield,      tone: 'violet', group: 'compliance' },
  { href: '/vehicle-management/puc',            label: 'PUC',             resource: 'PUC Management',            icon: Leaf,        tone: 'green', group: 'compliance' },
  { href: '/vehicle-management/fitness',        label: 'Fitness',         resource: 'Fitness Certificate Management', icon: BadgeCheck, tone: 'indigo', group: 'compliance' },
  { href: '/vehicle-management/road-tax',       label: 'Road Tax',        resource: 'Road Tax Management',       icon: Landmark,    tone: 'amber', group: 'compliance' },
  { href: '/vehicle-management/permit',         label: 'Permit',          resource: 'Permit Management',         icon: ScrollText,  tone: 'orange', group: 'compliance' },
  { href: '/vehicle-management/maintenance',    label: 'Maintenance',     resource: 'Maintenance Management',    icon: Wrench,      tone: 'red', group: 'ops' },
  { href: '/vehicle-management/fuel',           label: 'Fuel',            resource: 'Fuel Management',           icon: Fuel,        tone: 'sky', group: 'ops' },
  { href: '/vehicle-management/driver',         label: 'Driver Master',   resource: 'Driver Management',         icon: User,        tone: 'teal', group: 'ops' },
  { href: '/vehicle-management/trips',          label: 'Trip Management', resource: 'Trip Management',           icon: LocateFixed, tone: 'blue', group: 'ops' },
  { href: '/vehicle-management/documents',      label: 'Documents',       resource: 'Document Management',       icon: FileArchive, tone: 'slate', group: 'ops' },
  { href: '/vehicle-management/reports',        label: 'Reports',         resource: 'Reports',                   icon: BarChart3,   tone: 'indigo', group: 'ops' },
  { href: '/vehicle-management/settings',       label: 'Settings',        resource: 'Settings',                  icon: Settings,    tone: 'slate', group: 'ops' },
];

const groupLabels: Record<string, string> = {
  core: 'Command Center',
  fleet: 'Fleet',
  compliance: 'Compliance',
  ops: 'Operations & Reports',
};

// The phone's bottom bar leads with these, in this order, under their short names; every other
// page the user can open follows them, and "More" opens the full grouped menu. There is no create
// route to put in the middle — each register adds its records on its own page.
const bottomTabPriority: ModuleNavTab[] = [
  { href: '/vehicle-management',              label: 'Home',     icon: Gauge, exact: true, ariaLabel: 'Overview' },
  { href: '/vehicle-management/renewals',     label: 'Renewals', icon: RefreshCw, ariaLabel: 'Renewals hub' },
  { href: '/vehicle-management/vehicle-master', label: 'Vehicles', icon: CarFront, ariaLabel: 'Vehicle master' },
  { href: '/vehicle-management/trips',        label: 'Trips',    icon: LocateFixed, ariaLabel: 'Trip management' },
  { href: '/vehicle-management/fuel',         label: 'Fuel',     icon: Fuel },
  { href: '/vehicle-management/maintenance',  label: 'Service',  icon: Wrench, ariaLabel: 'Maintenance' },
  { href: '/vehicle-management/reports',      label: 'Reports',  icon: BarChart3 },
];

export default function VehicleManagementLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const iconsOnly = useSidebarIconsOnly();

  const canViewModule =
    can('View Module', 'Vehicle Management') ||
    sections.some(
      (item) =>
        Boolean(item.resource) &&
        (can('View', `Vehicle Management.${item.resource}`) ||
          can('Add', `Vehicle Management.${item.resource}`) ||
          can('Edit', `Vehicle Management.${item.resource}`))
    );

  const availableSections = sections.filter((item) => {
    if (!item.resource) return canViewModule;
    if (can('View', `Vehicle Management.${item.resource}`)) return true;
    if (can('Add', `Vehicle Management.${item.resource}`)) return true;
    if (can('Edit', `Vehicle Management.${item.resource}`)) return true;
    return false;
  });
  const currentSection = [...availableSections]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => safePathname === item.href || (item.href !== '/vehicle-management' && safePathname.startsWith(item.href)));

  // Only tabs whose sidebar row is visible. Not on the driver app's screens, which are not in this
  // menu at all: they are the pages Driver Management re-exports, and that module's bar serves them.
  const bottomTabs = bottomTabPriority.filter((tab) => availableSections.some((item) => item.href === tab.href));
  const isDriverAppRoute = safePathname.startsWith('/vehicle-management/driver-mobile');

  // The desktop sidebar's rows; `compact` is its icons mode. Phones use the bottom bar's pop-up.
  const navigationLinks = (compact = false) => {
    let lastGroup = '';
    return availableSections.map((item, index) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/vehicle-management' && safePathname.startsWith(item.href));
      const Icon = item.icon;
      const showGroupTitle = item.group !== lastGroup;
      lastGroup = item.group;
      const groupLabel = groupLabels[item.group] || item.group;

      return (
        <div key={item.href}>
          {showGroupTitle &&
            (compact ? (
              // No room for a heading: a hairline keeps the grouping, the name stays for screen readers.
              <>
                {index > 0 && <div className={SIDEBAR_ICONS_DIVIDER} aria-hidden />}
                <p className="sr-only">{groupLabel}</p>
              </>
            ) : (
              <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 first:pt-1">
                {groupLabel}
              </p>
            ))}
          <SidebarNavTooltip label={item.label} enabled={compact}>
            <Link
              href={item.href}
              // Renewal History also lights Renewals Hub; only the page itself is current.
              aria-current={currentSection?.href === item.href ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 lg:py-1.5 text-sm font-medium transition-colors',
                active
                  ? cn(VM_ACCENT_FILL, 'font-semibold shadow-[0_6px_16px_-8px_var(--sel-tab-glow)]')
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                compact && 'justify-center'
              )}
            >
              {/* Each section's own colour on its chip; the current page wears the user's accent. */}
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset transition-colors',
                  active ? 'bg-white/20 ring-white/30' : VM_TONES[item.tone].chip
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
            </Link>
          </SidebarNavTooltip>
        </div>
      );
    });
  };

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Vehicle Management.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="vm-module-root relative w-full px-2 py-2 sm:px-6 sm:py-4 lg:px-8 [&_table]:min-w-max [&_table_th]:whitespace-nowrap [&_table_td]:whitespace-nowrap">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl vm-neutral-backdrop" />

      {/* Mobile header: logo, title and current section. Navigation is the bottom bar and its "More" pop-up. */}
      <ModuleMobileHeader
        icon={Truck}
        title="Vehicle Management"
        subtitle={currentSection?.label || 'Command Center'}
        hideFrom="lg"
      />

      {/* Desktop grid */}
      <div className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[240px_minmax(0,1fr)]'} lg:items-start`}>
        <TooltipProvider delayDuration={150}>
          <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block">
            <Card className="overflow-hidden vm-panel-strong vm-reveal">
              {/* Sidebar header */}
              <div
                className={cn('border-b border-slate-200 px-4 py-3', iconsOnly && 'px-2')}
                title={iconsOnly ? 'Vehicle Management' : undefined}
              >
                <div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}>
                  <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg shadow-sm', VM_ACCENT_FILL)}>
                    <Truck className="h-4 w-4" />
                  </div>
                  <div className={iconsOnly ? 'sr-only' : undefined}>
                    <p className="text-sm font-semibold tracking-tight text-slate-800">Vehicle Management</p>
                    <p className="text-[11px] text-muted-foreground">Command Center</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-2 overflow-y-auto max-h-[calc(100vh-var(--app-header-offset,4rem)-8rem)]">
                {navigationLinks(iconsOnly)}
              </CardContent>
            </Card>
          </aside>
        </TooltipProvider>

        <main className="min-w-0 w-full overflow-x-hidden vm-reveal">{children}</main>
      </div>

      {!isDriverAppRoute && (
        <ModuleBottomNav tabs={bottomTabs} pages={availableSections} groupLabels={groupLabels} moduleName="Vehicle Management" />
      )}
    </div>
  );
}
