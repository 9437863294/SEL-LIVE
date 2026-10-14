'use client';

import { useMemo, type ReactNode } from 'react';
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
  Truck,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';
import type { VmTone } from './vm-ui';

const MODULE = 'Vehicle Management';

// ─── Sections ─────────────────────────────────────────────────────────────────

type Section = { id: string; href: string; label: string; resource: string; icon: LucideIcon; tone: VmTone; group: string };

const sections: Section[] = [
  { id: 'overview',           href: '/vehicle-management',                label: 'Overview',        resource: '',                          icon: Gauge,       tone: 'emerald', group: 'core' },
  { id: 'renewals',           href: '/vehicle-management/renewals',       label: 'Renewals Hub',    resource: '',                          icon: RefreshCw,   tone: 'rose', group: 'core' },
  { id: 'renewal-history',    href: '/vehicle-management/renewals/history', label: 'Renewal History', resource: '',                        icon: History,     tone: 'slate', group: 'core' },
  { id: 'vehicle-health',     href: '/vehicle-management/vehicle-health', label: 'Vehicle Health',  resource: 'Vehicle Master',            icon: Activity,    tone: 'emerald', group: 'core' },
  { id: 'vehicle-master',     href: '/vehicle-management/vehicle-master', label: 'Vehicle Master',  resource: 'Vehicle Master',            icon: CarFront,    tone: 'blue', group: 'fleet' },
  { id: 'insurance-workflow', href: '/vehicle-management/insurance/workflow', label: 'Insurance Workflow', resource: 'Insurance Management', icon: GitBranch, tone: 'violet', group: 'compliance' },
  { id: 'insurance',          href: '/vehicle-management/insurance',      label: 'Insurance',       resource: 'Insurance Management',     icon: Shield,      tone: 'violet', group: 'compliance' },
  { id: 'puc',                href: '/vehicle-management/puc',            label: 'PUC',             resource: 'PUC Management',            icon: Leaf,        tone: 'green', group: 'compliance' },
  { id: 'fitness',            href: '/vehicle-management/fitness',        label: 'Fitness',         resource: 'Fitness Certificate Management', icon: BadgeCheck, tone: 'indigo', group: 'compliance' },
  { id: 'road-tax',           href: '/vehicle-management/road-tax',       label: 'Road Tax',        resource: 'Road Tax Management',       icon: Landmark,    tone: 'amber', group: 'compliance' },
  { id: 'permit',             href: '/vehicle-management/permit',         label: 'Permit',          resource: 'Permit Management',         icon: ScrollText,  tone: 'orange', group: 'compliance' },
  { id: 'maintenance',        href: '/vehicle-management/maintenance',    label: 'Maintenance',     resource: 'Maintenance Management',    icon: Wrench,      tone: 'red', group: 'ops' },
  { id: 'fuel',               href: '/vehicle-management/fuel',           label: 'Fuel',            resource: 'Fuel Management',           icon: Fuel,        tone: 'sky', group: 'ops' },
  { id: 'driver',             href: '/vehicle-management/driver',         label: 'Driver Master',   resource: 'Driver Management',         icon: User,        tone: 'teal', group: 'ops' },
  { id: 'trips',              href: '/vehicle-management/trips',          label: 'Trip Management', resource: 'Trip Management',           icon: LocateFixed, tone: 'blue', group: 'ops' },
  { id: 'documents',          href: '/vehicle-management/documents',      label: 'Documents',       resource: 'Document Management',       icon: FileArchive, tone: 'slate', group: 'ops' },
  { id: 'reports',            href: '/vehicle-management/reports',        label: 'Reports',         resource: 'Reports',                   icon: BarChart3,   tone: 'indigo', group: 'ops' },
  { id: 'settings',           href: '/vehicle-management/settings',       label: 'Settings',        resource: 'Settings',                  icon: Settings,    tone: 'slate', group: 'ops' },
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

type Can = ReturnType<typeof useAuthorization>['can'];

/** View, Add or Edit on the section's resource opens it. */
const canResource = (can: Can, resource: string) =>
  can('View', `${MODULE}.${resource}`) || can('Add', `${MODULE}.${resource}`) || can('Edit', `${MODULE}.${resource}`);

const canViewModuleWith = (can: Can) =>
  can('View Module', MODULE) || sections.some((item) => Boolean(item.resource) && canResource(can, item.resource));

/** A section without a resource is open to anyone in the module. */
const canSee = (can: Can, item: Section) => (item.resource ? canResource(can, item.resource) : canViewModuleWith(can));

export default function VehicleManagementLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  const { can, isLoading } = useAuthorization();
  const canViewModule = canViewModuleWith(can);

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const byGroup = new Map<string, ModuleNavGroup>();
    for (const item of sections) {
      const group = byGroup.get(item.group) ?? { id: item.group, label: groupLabels[item.group] || item.group, items: [] };
      group.items.push({ id: item.id, href: item.href, label: item.label, icon: item.icon, tone: item.tone, visible: canSee(can, item) });
      byGroup.set(item.group, group);
    }
    return [...byGroup.values()];
  }, [can]);

  // Only tabs whose sidebar row is visible. Not on the driver app's screens, which are not in this
  // menu at all: they are the pages Driver Management re-exports, and that module's bar serves them.
  // An empty tab list keeps the bottom bar off the screen.
  const isDriverAppRoute = pathname.startsWith('/vehicle-management/driver-mobile');
  const mobileTabs = isDriverAppRoute
    ? []
    : bottomTabPriority.filter((tab) => sections.some((item) => item.href === tab.href && canSee(can, item)));

  return (
    <ModuleShell
      title={MODULE}
      subtitle="Command Center"
      icon={Truck}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{ loading: isLoading, allowed: canViewModule }}
    >
      {/* The module's own scope: the grey panel look and the phone touch targets in globals.css
          key off `vm-module-root`, and wide registers keep one line per cell and scroll sideways. */}
      <div className="vm-module-root w-full overflow-x-hidden vm-reveal [&_table]:min-w-max [&_table_th]:whitespace-nowrap [&_table_td]:whitespace-nowrap">
        {children}
      </div>
    </ModuleShell>
  );
}
