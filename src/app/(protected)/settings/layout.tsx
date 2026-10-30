'use client';

import { useMemo } from 'react';
import {
  Activity, Briefcase, Building2, Clock, Construction, DatabaseZap, Hash, LayoutDashboard,
  LogIn, MailCheck, MapPinned, MonitorSmartphone, Package, Palette, Settings2,
  ShieldCheck, User as UserIcon, Users,
} from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { canOpenAccessManagement } from '@/lib/access-control';
import { COMPANY_PROFILE_RESOURCE } from '@/lib/company-profile';
import { REPORTING_COPY_RESOURCE } from '@/lib/reporting-copy';
import { useAuthorization } from '@/hooks/useAuthorization';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { can, isLoading } = useAuthorization();
  const { profile } = useCompanyProfile();

  // Each item's `visible` is the rule its page applies on arrival, so nobody loses the link to a
  // page they may open — and every page has one: the overview is figures, not a second menu.
  const groups = useMemo<ModuleNavGroup[]>(() => [
    {
      id: 'home',
      items: [
        { id: 'overview', href: '/settings', icon: LayoutDashboard, label: 'Overview', tone: 'slate' },
      ],
    },
    {
      id: 'personal',
      label: 'Personal',
      items: [
        { id: 'profile', href: '/settings/profile', icon: UserIcon, label: 'Profile', visible: can('View', 'Settings.Profile'), tone: 'violet' },
        { id: 'appearance', href: '/settings/appearance', icon: Palette, label: 'Appearance', visible: true /* personal: every user sets their own appearance */, tone: 'pink' },
        // Your own idle timeout (it is stored on your user record), for those allowed to change it.
        { id: 'login-expiry', href: '/settings/login-expiry', icon: LogIn, label: 'Login Expiry', visible: can('View', 'Settings.Login Expiry'), tone: 'orange' },
      ],
    },
    {
      id: 'organisation',
      label: 'Organisation',
      items: [
        { id: 'company-profile', href: '/settings/company-profile', icon: Building2, label: 'Company Profile', visible: can('View', COMPANY_PROFILE_RESOURCE) || can('Edit', COMPANY_PROFILE_RESOURCE), tone: 'slate' },
        { id: 'department', href: '/settings/department', icon: Briefcase, label: 'Departments', visible: can('View', 'Settings.Manage Department'), tone: 'sky' },
        { id: 'project', href: '/settings/project', icon: Construction, label: 'Projects', visible: can('View', 'Settings.Manage Project'), tone: 'amber' },
        { id: 'employees', href: '/employee', icon: Users, label: 'Employees', visible: can('View', 'Settings.Employee Management'), tone: 'green' },
      ],
    },
    {
      id: 'access',
      label: 'Access',
      items: [
        // One entry, because there is now one screen: Access Management absorbed the separate Users
        // and Roles screens. Still reachable by anyone who could open either of those, which is what
        // `canOpenAccessManagement`'s fallback encodes.
        { id: 'access-management', href: '/settings/access-management', icon: ShieldCheck, label: 'Access', visible: canOpenAccessManagement(can), tone: 'red' },
        { id: 'session-management', href: '/settings/session-management', icon: MonitorSmartphone, label: 'Sessions', visible: true, tone: 'indigo' },
        { id: 'location-tracking', href: '/settings/location-tracking', icon: MapPinned, label: 'Location', visible: can('View', 'Settings.Location Tracking'), tone: 'emerald' },
        { id: 'audit-logs', href: '/settings/audit-logs', icon: Activity, label: 'Audit Logs', visible: can('View', 'Settings.Audit Logs') || can('View', 'Settings.User Management') || can('View', 'Settings.Role Management'), tone: 'violet' },
      ],
    },
    {
      id: 'config',
      label: 'Config',
      items: [
        { id: 'serial-no-configuration', href: '/settings/serial-no-configuration', icon: Hash, label: 'Serial Nos.', visible: can('View', 'Settings.Serial No. Config'), tone: 'violet' },
        { id: 'working-hours', href: '/settings/working-hours', icon: Clock, label: 'Working Hrs', visible: can('View', 'Settings.Working Hrs'), tone: 'teal' },
        { id: 'store-stock', href: '/store-stock-management/settings', icon: Package, label: 'Store & Stock', visible: can('View Module', 'Store & Stock Management'), tone: 'violet' },
      ],
    },
    {
      id: 'system',
      label: 'System',
      items: [
        { id: 'email-authorization', href: '/settings/email-authorization', icon: MailCheck, label: 'Email Auth', visible: can('View', 'Settings.Email Authorization'), tone: 'cyan' },
        { id: 'reporting-database', href: '/settings/reporting-database', icon: DatabaseZap, label: 'Reporting DB', visible: can('View', REPORTING_COPY_RESOURCE), tone: 'cyan' },
      ],
    },
  ], [can]);

  // The phone's bottom bar leads with the overview and the pages people come to Settings for, each
  // only when its rail entry is shown; every other permitted page follows them, and "More" opens the
  // bar's pop-up of them all, under the rail's group headings.
  const mobileTabs = useMemo<ModuleNavTab[]>(() => {
    const permitted = (href: string) => groups.some(group => group.items.some(item => item.href === href && item.visible !== false));
    return [
      { href: '/settings', label: 'Overview', icon: LayoutDashboard, exact: true, ariaLabel: 'Settings overview' },
      ...(permitted('/settings/profile') ? [{ href: '/settings/profile', label: 'Profile', icon: UserIcon }] : []),
      ...(permitted('/settings/access-management')
        ? [{ href: '/settings/access-management', label: 'Access', icon: ShieldCheck, ariaLabel: 'Access management' }]
        : []),
      ...(permitted('/settings/session-management') ? [{ href: '/settings/session-management', label: 'Sessions', icon: MonitorSmartphone }] : []),
      ...(permitted('/settings/appearance') ? [{ href: '/settings/appearance', label: 'Theme', icon: Palette, ariaLabel: 'Appearance' }] : []),
    ];
  }, [groups]);

  return (
    // The gate only waits for permissions: until they are in, every item above reads "hidden", so the
    // menu would grow under the pointer and each page would flash its own placeholder.
    <ModuleShell title="Settings" icon={Settings2} groups={groups} mobileTabs={mobileTabs} gate={{ loading: isLoading, allowed: true }}>
      {children}
      <footer className="mt-6 flex items-center border-t border-border/40 px-2 py-3 text-xs text-muted-foreground">
        <span>Copyright © 2025 {profile.shortName}. All Rights Reserved.</span>
      </footer>
    </ModuleShell>
  );
}
