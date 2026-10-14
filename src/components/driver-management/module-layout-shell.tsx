'use client';

import { useMemo, type ReactNode } from 'react';
import {
  CarFront,
  ClipboardCheck,
  Fuel,
  Gauge,
  ListFilter,
  LocateFixed,
  ReceiptText,
  Route,
  Truck,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

// ─── Per-section config ──────────────────────────────────────────────────────

type Section = { id: string; href: string; label: string; resource: string; icon: LucideIcon; tone: ModuleNavTone; group: string };

const sections: Section[] = [
  { id: 'overview',        href: '/driver-management',               label: 'Overview',         resource: '',                 icon: Gauge,       tone: 'cyan',    group: 'core' },
  { id: 'mobile-hub',      href: '/driver-management/mobile-hub',    label: 'Driver Mobile',    resource: 'Driver Mobile Hub', icon: User,       tone: 'violet',  group: 'driver' },
  { id: 'vehicle-details', href: '/driver-management/vehicle-details', label: 'Vehicle Details', resource: 'Assigned Vehicle Details', icon: CarFront, tone: 'blue', group: 'driver' },
  { id: 'fuel',            href: '/driver-management/fuel',          label: 'Driver Fuel',      resource: 'Driver Fuel',      icon: Fuel,        tone: 'amber',   group: 'driver' },
  { id: 'daily-status',    href: '/driver-management/daily-status',  label: 'Daily Status',     resource: 'Driver Daily Status', icon: Gauge,    tone: 'emerald', group: 'driver' },
  { id: 'trips',           href: '/driver-management/trips',         label: 'Driver Trips',     resource: 'Driver Trips',     icon: LocateFixed, tone: 'sky',     group: 'trips' },
  { id: 'trip-log',        href: '/driver-management/trip-log',      label: 'Trip Log',         resource: 'Driver Trips',     icon: ListFilter,  tone: 'indigo',  group: 'trips' },
  { id: 'employee-trips',  href: '/driver-management/employee-trips', label: 'Employee Trips',  resource: 'Employee Trip Log', icon: ReceiptText, tone: 'teal',   group: 'trips' },
  { id: 'trip-management', href: '/driver-management/trip-management', label: 'Trip Management', resource: 'Trip Management', icon: LocateFixed, tone: 'blue',   group: 'trips' },
];

// Group headings in the sidebar and the phone's "More" pop-up.
const groupLabels: Record<string, string> = {
  core: 'Control Center',
  driver: 'Driver',
  trips: 'Trips',
};

const legacyResourceMap: Record<string, string[]> = {
  'Driver Mobile Hub':      ['Vehicle Management.Driver Mobile'],
  'Assigned Vehicle Details': ['Vehicle Management.Driver Mobile'],
  'Driver Fuel':            ['Vehicle Management.Driver Mobile Fuel'],
  'Driver Daily Status':    ['Vehicle Management.Driver Daily Status'],
  'Driver Trips':           ['Vehicle Management.Driver Mobile Trip'],
  'Employee Trip Log':      ['Vehicle Management.Employee Trip Reimbursement'],
  'Trip Management':        ['Vehicle Management.Trip Management'],
};

const driverSelfResources = new Set([
  'Driver Mobile Hub', 'Assigned Vehicle Details', 'Driver Fuel',
  'Driver Daily Status', 'Driver Trips', 'Employee Trip Log',
]);

// The phone's bottom bar leads with these, in this order, under their short names; every other
// page the user can open follows them, and "More" opens the full menu. A driver gets their day —
// trips, the daily status, fuel; a transport coordinator without the driver screens falls through
// to the management pages.
// This module is the driver app (AppShell drops the app header for it in the Android WebView),
// and none of its pages has a bottom bar of its own, so this is the only one on screen. The shell's
// phone header card is the driver app's only title bar.
const bottomTabPriority: ModuleNavTab[] = [
  { href: '/driver-management',                 label: 'Home',     icon: Gauge, exact: true, ariaLabel: 'Overview' },
  { href: '/driver-management/trips',           label: 'Trips',    icon: LocateFixed, ariaLabel: 'Driver trips' },
  { href: '/driver-management/daily-status',    label: 'Status',   icon: ClipboardCheck, ariaLabel: 'Daily status' },
  { href: '/driver-management/fuel',            label: 'Fuel',     icon: Fuel, ariaLabel: 'Driver fuel' },
  { href: '/driver-management/trip-management', label: 'Manage',   icon: Route, ariaLabel: 'Trip management' },
  { href: '/driver-management/employee-trips',  label: 'Claims',   icon: ReceiptText, ariaLabel: 'Employee trip reimbursement' },
  { href: '/driver-management/trip-log',        label: 'Trip log', icon: ListFilter },
];

export default function DriverManagementLayoutShell({ children }: { children: ReactNode }) {
  const { can, isLoading } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();

  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canViewModule =
    can('View Module', 'Driver Management') ||
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Driver Management.Employee Trip Log') ||
    can('Add', 'Driver Management.Employee Trip Log') ||
    can('Edit', 'Driver Management.Employee Trip Log') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Add', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Edit', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const canViewSection = (resource: string) => {
      if (!resource) return canViewModule;
      if (can('View', `Driver Management.${resource}`)) return true;
      if (can('Add', `Driver Management.${resource}`)) return true;
      if (can('Edit', `Driver Management.${resource}`)) return true;
      const legacy = legacyResourceMap[resource] || [];
      if (legacy.some((entry) => can('View', entry) || can('Add', entry) || can('Edit', entry))) return true;
      if (isAssignedDriver && driverSelfResources.has(resource)) return true;
      return false;
    };
    const byGroup = new Map<string, ModuleNavGroup>();
    for (const item of sections) {
      const group = byGroup.get(item.group) ?? { id: item.group, label: groupLabels[item.group] || item.group, items: [] };
      group.items.push({ id: item.id, href: item.href, label: item.label, icon: item.icon, tone: item.tone, visible: canViewSection(item.resource) });
      byGroup.set(item.group, group);
    }
    return [...byGroup.values()];
  }, [can, canViewModule, isAssignedDriver]);

  const visibleHrefs = groups.flatMap((group) => group.items.filter((item) => item.visible).map((item) => item.href));
  const mobileTabs = bottomTabPriority.filter((tab) => visibleHrefs.includes(tab.href));

  return (
    <ModuleShell
      title="Driver Management"
      subtitle="Control Center"
      icon={Truck}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{ loading: isLoading || isDriverLoading, allowed: canViewModule }}
    >
      <div className="vm-reveal">{children}</div>
    </ModuleShell>
  );
}
