'use client';

import { useMemo, type ReactNode } from 'react';
import {
  Banknote,
  CarFront,
  Fuel,
  Gauge,
  Inbox,
  ListFilter,
  ReceiptText,
  Route,
  Settings,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { TripClaimsProvider, useTripClaims } from './trips/trip-claims-provider';

// ─── Per-section config ──────────────────────────────────────────────────────

/**
 * How a section is opened:
 * - `everyone`: every signed-in user — recording and claiming your own trips needs no permission.
 * - `approver` / `payer`: named on an approval / the payment stage in Settings › Workflow (or
 *   holding Trip Claims · Override Workflow), or with a claim waiting for them now.
 * - `viewAll` / `settings`: Trip Claims · View All / Trip Settings · View.
 * - otherwise a Driver Management resource, as before (the driver app).
 */
type Access = 'everyone' | 'approver' | 'payer' | 'viewAll' | 'settings' | { resource: string };
type Section = { id: string; href: string; label: string; access: Access; icon: LucideIcon; tone: ModuleNavTone; group: string };

const sections: Section[] = [
  { id: 'overview',        href: '/driver-management',                 label: 'Overview',         access: 'everyone', icon: Gauge,       tone: 'cyan',    group: 'core' },
  { id: 'my-trips',        href: '/driver-management/my-trips',        label: 'My Trips',         access: 'everyone', icon: Route,       tone: 'teal',    group: 'mine' },
  { id: 'my-claims',       href: '/driver-management/my-claims',       label: 'My Claims',        access: 'everyone', icon: ReceiptText, tone: 'indigo',  group: 'mine' },
  { id: 'approvals',       href: '/driver-management/approvals',       label: 'Approvals',        access: 'approver', icon: Inbox,       tone: 'amber',   group: 'workflow' },
  { id: 'payments',        href: '/driver-management/payments',        label: 'Payments',         access: 'payer',    icon: Banknote,    tone: 'emerald', group: 'workflow' },
  { id: 'claims',          href: '/driver-management/claims',          label: 'All Claims',       access: 'viewAll',  icon: ReceiptText, tone: 'blue',    group: 'workflow' },
  // The driver app, for drivers of company vehicles. GPS recording is no longer here: it moved onto
  // My Trips, because the journey measured and the journey claimed are one journey. The old Driver
  // Mobile hub is the Overview's driver panel now, and Trip Management lives in Vehicle Management
  // only (every old address redirects — next.config.ts).
  { id: 'vehicle-details', href: '/driver-management/vehicle-details', label: 'My Vehicle',       access: { resource: 'Assigned Vehicle Details' }, icon: CarFront, tone: 'blue', group: 'driver' },
  { id: 'trip-log',        href: '/driver-management/trip-log',        label: 'GPS Trip Log',     access: { resource: 'Driver Trips' }, icon: ListFilter, tone: 'indigo', group: 'driver' },
  { id: 'fuel',            href: '/driver-management/fuel',            label: 'Fuel Entries',     access: { resource: 'Driver Fuel' }, icon: Fuel, tone: 'amber', group: 'driver' },
  { id: 'settings',        href: '/driver-management/settings',        label: 'Settings',         access: 'settings', icon: Settings,    tone: 'slate',   group: 'admin' },
];

// Group headings in the sidebar and the phone's "More" pop-up.
const groupLabels: Record<string, string> = {
  core: 'Control Center',
  mine: 'My Trips & Claims',
  workflow: 'Approvals & Payments',
  driver: 'Company Vehicle Driver',
  admin: 'Administration',
};

const legacyResourceMap: Record<string, string[]> = {
  // The retired hub's grant still opens the vehicle page, as that page's own check allows.
  'Assigned Vehicle Details': ['Vehicle Management.Driver Mobile', 'Driver Management.Driver Mobile Hub'],
  'Driver Fuel':            ['Vehicle Management.Driver Mobile Fuel'],
  'Driver Trips':           ['Vehicle Management.Driver Mobile Trip'],
};

const driverSelfResources = new Set(['Assigned Vehicle Details', 'Driver Fuel', 'Driver Trips']);

// The phone's bottom bar leads with these, in this order, under their short names; every other
// page the user can open follows them, and "More" opens the full menu. Everyone gets their own
// trips and claims first; an approver or payer their queue; a driver their day after that.
// This module is also the driver app (AppShell drops the app header for it in the Android WebView),
// and none of its pages has a bottom bar of its own, so this is the only one on screen. The shell's
// phone header card is the driver app's only title bar.
const bottomTabPriority: ModuleNavTab[] = [
  { href: '/driver-management',              label: 'Home',     icon: Gauge, exact: true, ariaLabel: 'Overview' },
  { href: '/driver-management/my-trips',     label: 'My trips', icon: Route, ariaLabel: 'My trips' },
  { href: '/driver-management/approvals',    label: 'Approve',  icon: Inbox, ariaLabel: 'Approvals' },
  { href: '/driver-management/payments',     label: 'Pay',      icon: Banknote, ariaLabel: 'Payments' },
  { href: '/driver-management/my-claims',    label: 'Claims',   icon: ReceiptText, ariaLabel: 'My claims' },
  { href: '/driver-management/fuel',         label: 'Fuel',     icon: Fuel, ariaLabel: 'Fuel entries' },
];

function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { can, isLoading } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { data: trips } = useTripClaims();

  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const canResource = (resource: string) => {
      if (can('View', `Driver Management.${resource}`)) return true;
      if (can('Add', `Driver Management.${resource}`)) return true;
      if (can('Edit', `Driver Management.${resource}`)) return true;
      const legacy = legacyResourceMap[resource] || [];
      if (legacy.some((entry) => can('View', entry) || can('Add', entry) || can('Edit', entry))) return true;
      return isAssignedDriver && driverSelfResources.has(resource);
    };
    const access = trips?.access;
    const visible = (section: Section): boolean => {
      switch (section.access) {
        case 'everyone':
          return true;
        case 'approver':
          return Boolean(trips && (trips.named.approval || access?.override || trips.inbox.approvals > 0));
        case 'payer':
          return Boolean(trips && (trips.named.payment || access?.override || trips.inbox.payments > 0));
        case 'viewAll':
          return Boolean(access?.viewAll);
        case 'settings':
          return Boolean(access?.settingsView);
        default:
          return canResource(section.access.resource);
      }
    };
    const badge = (id: string) => (id === 'approvals' ? trips?.inbox.approvals : id === 'payments' ? trips?.inbox.payments : null);
    const byGroup = new Map<string, ModuleNavGroup>();
    for (const item of sections) {
      const group = byGroup.get(item.group) ?? { id: item.group, label: groupLabels[item.group] || item.group, items: [] };
      group.items.push({ id: item.id, href: item.href, label: item.label, icon: item.icon, tone: item.tone, visible: visible(item), badge: badge(item.id) });
      byGroup.set(item.group, group);
    }
    return [...byGroup.values()];
  }, [can, isAssignedDriver, trips]);

  const visibleHrefs = groups.flatMap((group) => group.items.filter((item) => item.visible).map((item) => item.href));
  const mobileTabs = bottomTabPriority.filter((tab) => visibleHrefs.includes(tab.href));

  return (
    <ModuleShell
      title="Driver Management"
      subtitle="Trips, Claims & Driver App"
      icon={Truck}
      groups={groups}
      mobileTabs={mobileTabs}
      // Every signed-in user records their own trips here; each page checks anything beyond that.
      gate={{ loading: isLoading || (isDriverLoading && !user), allowed: Boolean(user) }}
    >
      <div className="vm-reveal">{children}</div>
    </ModuleShell>
  );
}

export default function DriverManagementLayoutShell({ children }: { children: ReactNode }) {
  return (
    <TripClaimsProvider>
      <Shell>{children}</Shell>
    </TripClaimsProvider>
  );
}
