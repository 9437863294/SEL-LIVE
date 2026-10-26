'use client';

import { useMemo, type ReactNode } from 'react';
import {
  Banknote,
  CarFront,
  Fuel,
  Gauge,
  Inbox,
  Navigation,
  ReceiptText,
  Users,
  Route,
  Settings,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { FleetProvider, useFleet } from '@/components/fleet/fleet-provider';
import { TripClaimsProvider, useTripClaims } from './trips/trip-claims-provider';

// ─── Per-section config ──────────────────────────────────────────────────────

/**
 * How a section is opened:
 * - `everyone`: every signed-in user — recording and claiming your own trips needs no permission.
 * - `approver`: approves trip claims — named on an approval stage in Settings › Workflow, holding
 *   Trip Claims · Override Workflow, or with a claim waiting — or approves company-vehicle running
 *   and reviews fleet trips (a vehicle's approver or backup, a reporting authority something has
 *   reached, the escalation list, Vehicle Management · Fleet Trips · Review). One Approvals page
 *   holds both (approvals-hub.tsx).
 * - `payer`: named on the payment stage in Settings › Workflow (or holding Override Workflow), or
 *   with a claim waiting to be paid.
 * - `viewAll` / `settings`: Trip Claims · View All / Trip Settings · View.
 * - `fleetDriver`: may drive company vehicles (a Driver Master driver, or anyone while Settings ›
 *   Fleet lets every employee drive), or has a fleet trip running.
 * - otherwise a Driver Management resource, as before (the driver app); `orFleetDriver` also opens
 *   it to everyone who may drive.
 */
type Access = 'everyone' | 'approver' | 'payer' | 'viewAll' | 'settings' | 'fleetDriver' | { resource: string; orFleetDriver?: boolean };
type Section = { id: string; href: string; label: string; access: Access; icon: LucideIcon; tone: ModuleNavTone; group: string; match?: (pathname: string) => boolean };

/** Fleet Trip covers the driver's home and trip pages. */
const isFleetTripPage = (pathname: string) => pathname === '/driver-management/fleet' || pathname.startsWith('/driver-management/fleet/trips');

const sections: Section[] = [
  { id: 'overview',        href: '/driver-management',                 label: 'Overview',         access: 'everyone', icon: Gauge,       tone: 'cyan',    group: 'core' },
  { id: 'my-trips',        href: '/driver-management/my-trips',        label: 'My Trips',         access: 'everyone', icon: Route,       tone: 'teal',    group: 'mine' },
  { id: 'my-claims',       href: '/driver-management/my-claims',       label: 'My Claims',        access: 'everyone', icon: ReceiptText, tone: 'indigo',  group: 'mine' },
  { id: 'approvals',       href: '/driver-management/approvals',       label: 'Approvals',        access: 'approver', icon: Inbox,       tone: 'amber',   group: 'workflow' },
  { id: 'payments',        href: '/driver-management/payments',        label: 'Payments',         access: 'payer',    icon: Banknote,    tone: 'emerald', group: 'workflow' },
  // Beside All Claims and on the same permission: an unclaimed trip appears on no claim, so
  // without this nobody but the employee who recorded it can see it.
  { id: 'all-trips',       href: '/driver-management/all-trips',       label: 'All Trips',        access: 'viewAll',  icon: Users,       tone: 'cyan',    group: 'workflow' },
  { id: 'claims',          href: '/driver-management/claims',          label: 'All Claims',       access: 'viewAll',  icon: ReceiptText, tone: 'blue',    group: 'workflow' },
  // The driver app, for company vehicles. A company-vehicle run is a fleet trip (docs/fleet/PLAN.md):
  // started and ended with odometer photos, tracked in the background, held to the vehicle's daily
  // km limit. Its trip list replaced the old GPS Trip Log, whose address now leads here. Personal
  // vehicles stay on My Trips and claims. The old Driver Mobile hub is the Overview's driver panel,
  // and Trip Management lives in Vehicle Management only (every old address redirects —
  // next.config.ts).
  { id: 'fleet',           href: '/driver-management/fleet',           label: 'Fleet Trip',       access: 'fleetDriver', icon: Navigation, tone: 'sky', group: 'driver', match: isFleetTripPage },
  { id: 'vehicle-details', href: '/driver-management/vehicle-details', label: 'My Vehicle',       access: { resource: 'Assigned Vehicle Details' }, icon: CarFront, tone: 'blue', group: 'driver' },
  { id: 'fuel',            href: '/driver-management/fuel',            label: 'Fuel Entries',     access: { resource: 'Driver Fuel', orFleetDriver: true }, icon: Fuel, tone: 'amber', group: 'driver' },
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
  { href: '/driver-management/fleet',        label: 'Fleet',    icon: Navigation, match: isFleetTripPage, ariaLabel: 'Fleet trip' },
  { href: '/driver-management/fuel',         label: 'Fuel',     icon: Fuel, ariaLabel: 'Fuel entries' },
];

function Shell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { can, isLoading } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const { data: trips } = useTripClaims();
  // Never part of the gate: the fleet bootstrap only adds Fleet Trip, and the fleet side of Approvals, once it loads.
  const { data: fleet } = useFleet();

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
    const fleetDriver = Boolean(fleet && (fleet.canDrive || fleet.openTrip));
    const fleetApprover = Boolean(fleet && (fleet.isApprover || fleet.access.review || fleet.inbox.approvals > 0 || fleet.inbox.reviews > 0));
    const visible = (section: Section): boolean => {
      switch (section.access) {
        case 'everyone':
          return true;
        case 'approver':
          return Boolean(trips && (trips.named.approval || access?.override || trips.inbox.approvals > 0)) || fleetApprover;
        case 'payer':
          return Boolean(trips && (trips.named.payment || access?.override || trips.inbox.payments > 0));
        case 'viewAll':
          return Boolean(access?.viewAll);
        case 'settings':
          return Boolean(access?.settingsView);
        case 'fleetDriver':
          return fleetDriver;
        default:
          return canResource(section.access.resource) || Boolean(section.access.orFleetDriver && fleetDriver);
      }
    };
    const badge = (id: string) => {
      // Claims waiting, plus over-limit requests and fleet trips to review.
      if (id === 'approvals') return trips || fleet ? (trips?.inbox.approvals ?? 0) + (fleet ? fleet.inbox.approvals + fleet.inbox.reviews : 0) : null;
      if (id === 'payments') return trips?.inbox.payments;
      return null;
    };
    const byGroup = new Map<string, ModuleNavGroup>();
    for (const item of sections) {
      const group = byGroup.get(item.group) ?? { id: item.group, label: groupLabels[item.group] || item.group, items: [] };
      group.items.push({ id: item.id, href: item.href, label: item.label, icon: item.icon, tone: item.tone, visible: visible(item), badge: badge(item.id), match: item.match });
      byGroup.set(item.group, group);
    }
    return [...byGroup.values()];
  }, [can, fleet, isAssignedDriver, trips]);

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
      <FleetProvider>
        <Shell>{children}</Shell>
      </FleetProvider>
    </TripClaimsProvider>
  );
}
