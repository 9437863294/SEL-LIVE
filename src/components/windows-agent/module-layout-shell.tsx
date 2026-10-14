'use client';

import { useMemo } from 'react';
import {
  Activity,
  BarChart3,
  BellRing,
  CalendarClock,
  Gauge,
  HardDrive,
  KeyRound,
  MonitorSmartphone,
  Package,
  PhoneCall,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

import {
  ModuleShell,
  type ModuleNavGroup,
  type ModuleNavTab,
  type ModuleNavTone,
} from '@/components/shared/module-shell';
import { WINDOWS_AGENT_ROUTES } from '@/lib/windows-agent';
import {
  WINDOWS_AGENT_RESOURCES,
  canManagePolicies,
  canManageVersions,
  canOpenWindowsAgent,
  canSendNotifications,
  canViewAttendance,
  canViewAudit,
  canViewDevices,
  canViewLiveBoard,
  canViewOwnActivity,
  canViewPolicies,
  resolveActivityScope,
} from '@/lib/windows-agent-permissions';
import { hasPermission } from '@/lib/access-control';
import { WindowsAgentProvider, useWindowsAgent } from './hooks';

/**
 * The module's chrome (§33's menu), on the shared module shell like every other module.
 *
 * ── Two things about the navigation that are not styling decisions ─────────────────────────────
 *
 * **Every section is gated, and the gating is the same function the page uses.** A link to a page
 * somebody cannot open is worse than no link: they click it, get refused, and raise a ticket. The
 * gates below call into `windows-agent-permissions.ts`, which is also what each page checks, so a
 * visible link and an openable page cannot drift apart.
 *
 * **"My activity" is always there.** §37 gives an employee their own record and §52 asks the
 * system to be transparent to the people it measures. Someone with no administrative permission
 * at all still reaches this module through that one link — which is the point, and why it sits in
 * its own group at the top rather than at the bottom of a list of things they cannot open.
 */

type Gate =
  | 'always'
  | 'self'
  | 'dashboard'
  | 'live'
  | 'devices'
  | 'sessions'
  | 'attendance'
  | 'applications'
  | 'reports'
  | 'notifications'
  | 'policies'
  | 'versions'
  | 'audit';

interface Section {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  group: 'mine' | 'monitor' | 'reports' | 'config';
  gate: Gate;
  match?: 'exact' | 'prefix';

  /**
   * The icon tile's colour. Per item rather than per group: colour is doing real work in a
   * sixteen-item list — it is what lets somebody who uses "Devices" every morning find it by
   * shape rather than by reading four headings.
   */
  tone: ModuleNavTone;
}

const SECTIONS: Section[] = [
  // "My activity" leads the list (see above), so it is the shell's first item — which would
  // otherwise match its own path only; its day-by-day pages sit under it.
  { id: 'my-activity', href: WINDOWS_AGENT_ROUTES.myActivity, label: 'My activity', icon: UserRound, group: 'mine', gate: 'self', match: 'prefix', tone: 'violet' },
  { id: 'work-calls', href: WINDOWS_AGENT_ROUTES.workCalls, label: 'Work calls', icon: PhoneCall, group: 'mine', gate: 'always', match: 'exact', tone: 'cyan' },
  { id: 'monitoring-policy', href: WINDOWS_AGENT_ROUTES.monitoringPolicy, label: 'What is recorded', icon: ShieldCheck, group: 'mine', gate: 'always', tone: 'emerald' },

  { id: 'dashboard', href: WINDOWS_AGENT_ROUTES.dashboard, label: 'Dashboard', icon: Gauge, group: 'monitor', gate: 'dashboard', match: 'exact', tone: 'blue' },
  { id: 'live', href: WINDOWS_AGENT_ROUTES.live, label: 'Live users', icon: Activity, group: 'monitor', gate: 'live', tone: 'cyan' },
  { id: 'users', href: WINDOWS_AGENT_ROUTES.users, label: 'Employee activity', icon: Users, group: 'monitor', gate: 'sessions', tone: 'indigo' },
  { id: 'devices', href: WINDOWS_AGENT_ROUTES.devices, label: 'Devices', icon: HardDrive, group: 'monitor', gate: 'devices', tone: 'teal' },
  { id: 'access', href: WINDOWS_AGENT_ROUTES.access, label: 'Computer access', icon: KeyRound, group: 'monitor', gate: 'devices', tone: 'amber' },
  { id: 'sessions', href: WINDOWS_AGENT_ROUTES.sessions, label: 'Sessions', icon: CalendarClock, group: 'monitor', gate: 'sessions', tone: 'sky' },

  { id: 'attendance', href: WINDOWS_AGENT_ROUTES.attendance, label: 'Attendance', icon: CalendarClock, group: 'reports', gate: 'attendance', tone: 'orange' },
  { id: 'applications', href: WINDOWS_AGENT_ROUTES.applications, label: 'Applications', icon: MonitorSmartphone, group: 'reports', gate: 'applications', tone: 'fuchsia' },
  { id: 'reports', href: WINDOWS_AGENT_ROUTES.reports, label: 'Reports', icon: BarChart3, group: 'reports', gate: 'reports', match: 'exact', tone: 'rose' },

  { id: 'notifications', href: WINDOWS_AGENT_ROUTES.notifications, label: 'Notifications', icon: BellRing, group: 'config', gate: 'notifications', tone: 'yellow' },
  { id: 'policies', href: WINDOWS_AGENT_ROUTES.policies, label: 'Policies', icon: SlidersHorizontal, group: 'config', gate: 'policies', tone: 'slate' },
  { id: 'versions', href: WINDOWS_AGENT_ROUTES.versions, label: 'Agent versions', icon: Package, group: 'config', gate: 'versions', tone: 'lime' },
  { id: 'audit', href: WINDOWS_AGENT_ROUTES.audit, label: 'Audit log', icon: ScrollText, group: 'config', gate: 'audit', tone: 'stone' },
];

const GROUP_LABELS: Record<Section['group'], string> = {
  mine: 'You',
  monitor: 'Monitoring',
  reports: 'Reports',
  config: 'Administration',
};

const GROUP_ORDER: Section['group'][] = ['mine', 'monitor', 'reports', 'config'];

/**
 * The phone's bottom bar leads with these, in this order, under their short names; every other
 * section the viewer can see follows them.
 *
 * Every one is a section above, and a tab shows only when its sidebar row does — so an
 * administrator gets the fleet at a glance plus their own day, and an employee with no
 * administrative permission gets the three pages written for them, work calls among them.
 */
const BOTTOM_TABS: ModuleNavTab[] = [
  { href: WINDOWS_AGENT_ROUTES.dashboard, label: 'Home', icon: Gauge, exact: true, ariaLabel: 'Dashboard' },
  { href: WINDOWS_AGENT_ROUTES.live, label: 'Live', icon: Activity, ariaLabel: 'Live users' },
  { href: WINDOWS_AGENT_ROUTES.workCalls, label: 'Calls', icon: PhoneCall, exact: true, ariaLabel: 'Work calls' },
  { href: WINDOWS_AGENT_ROUTES.myActivity, label: 'My day', icon: UserRound, ariaLabel: 'My activity' },
  { href: WINDOWS_AGENT_ROUTES.monitoringPolicy, label: 'Recorded', icon: ShieldCheck, ariaLabel: 'What is recorded' },
];

export default function WindowsAgentLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <WindowsAgentProvider>
      <ShellBody>{children}</ShellBody>
    </WindowsAgentProvider>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const { viewer, loading } = useWindowsAgent();

  const visible = useMemo(
    () => (loading ? [] : SECTIONS.filter((section) => isVisible(section.gate, viewer))),
    [loading, viewer],
  );

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      GROUP_ORDER.map((group) => ({
        id: group,
        label: GROUP_LABELS[group],
        items: visible
          .filter((section) => section.group === group)
          .map(({ id, href, label, icon, match, tone }) => ({ id, href, label, icon, match, tone })),
      })),
    [visible],
  );

  const mobileTabs = useMemo(
    () => BOTTOM_TABS.filter((tab) => visible.some((section) => section.href === tab.href)),
    [visible],
  );

  /**
   * Denied only when there is nothing at all to show.
   *
   * This used to test `canOpenModule`, which asks whether the viewer holds an *administrative*
   * permission — and three of the sections are deliberately not administrative. "What is
   * recorded" is §52's disclosure and is meant to be readable by the people being measured;
   * "My activity" is §37's self-view, which `windows-agent-permissions.ts` is explicit is not a
   * privilege; "Work calls" is a thing field staff do several times a day.
   *
   * So an ordinary employee was shown "you do not have access to this module" in front of the
   * three pages written for them. Now the sidebar lists whatever they can see — often just those
   * three — and the card appears only when that list is empty.
   */
  return (
    <ModuleShell
      title="Windows Agent"
      subtitle="Attendance & activity"
      icon={KeyRound}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{
        loading,
        allowed: visible.length > 0,
        deniedMessage:
          'You do not have access to this module. It needs at least one Windows Agent permission — ask an administrator to grant one in Settings, Access Management.',
      }}
    >
      {children}
    </ModuleShell>
  );
}

function isVisible(gate: Gate, viewer: Parameters<typeof canOpenWindowsAgent>[0]): boolean {
  switch (gate) {
    case 'always':
      return true;
    case 'self':
      return canViewOwnActivity(viewer);
    case 'dashboard':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.dashboard, 'View');
    case 'live':
      return canViewLiveBoard(viewer);
    case 'devices':
      return canViewDevices(viewer);
    case 'sessions':
      // The register of other people's sessions, so it follows the activity scope rather than a
      // page permission: somebody who may only see themselves has "My activity" instead.
      return resolveActivityScope(viewer).kind !== 'SELF' && resolveActivityScope(viewer).kind !== 'NONE';
    case 'attendance':
      return canViewAttendance(viewer);
    case 'applications':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.applications, 'View');
    case 'reports':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.reports, 'View');
    case 'notifications':
      return (
        canSendNotifications(viewer) ||
        hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.notifications, 'View')
      );
    case 'policies':
      return canViewPolicies(viewer) || canManagePolicies(viewer);
    case 'versions':
      return (
        canManageVersions(viewer) ||
        hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.versions, 'View')
      );
    case 'audit':
      return canViewAudit(viewer);
    default:
      return false;
  }
}
