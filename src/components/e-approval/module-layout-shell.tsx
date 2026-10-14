'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  Eye,
  FilePlus2,
  FileStack,
  FileText,
  Gauge,
  History,
  Inbox,
  Plus,
  Settings,
  Stamp,
  UserCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { EApprovalModuleProvider, useEApprovalPermissions } from './hooks';

type NavKey =
  | 'always'
  | 'create'
  | 'inbox'
  | 'mine'
  | 'department'
  | 'all'
  | 'reports'
  | 'delegations'
  | 'settings';

type Section = { id: string; href: string; label: string; icon: LucideIcon; tone: ModuleNavTone; group: string; gate: NavKey };

const sections: Section[] = [
  { id: 'dashboard', href: E_APPROVAL_BASE_PATH, label: 'Dashboard', icon: Gauge, tone: 'sky', group: 'work', gate: 'always' },
  { id: 'create', href: `${E_APPROVAL_BASE_PATH}/create`, label: 'Create Approval', icon: FilePlus2, tone: 'emerald', group: 'work', gate: 'create' },
  { id: 'inbox', href: `${E_APPROVAL_BASE_PATH}/inbox`, label: 'My Inbox', icon: Inbox, tone: 'indigo', group: 'work', gate: 'inbox' },
  { id: 'created-by-me', href: `${E_APPROVAL_BASE_PATH}/created-by-me`, label: 'Created by Me', icon: FileText, tone: 'violet', group: 'work', gate: 'mine' },
  // Ungated beyond module access: anybody can be put in CC, including people who may not raise requests.
  { id: 'copied-to-me', href: `${E_APPROVAL_BASE_PATH}/copied-to-me`, label: 'Copied to Me', icon: Eye, tone: 'sky', group: 'work', gate: 'always' },
  { id: 'drafts', href: `${E_APPROVAL_BASE_PATH}/drafts`, label: 'Drafts', icon: FileStack, tone: 'slate', group: 'work', gate: 'mine' },
  { id: 'my-activity', href: `${E_APPROVAL_BASE_PATH}/my-activity`, label: 'My Activity', icon: History, tone: 'emerald', group: 'work', gate: 'mine' },

  { id: 'department', href: `${E_APPROVAL_BASE_PATH}/department`, label: 'Department Inbox', icon: Building2, tone: 'amber', group: 'registers', gate: 'department' },
  { id: 'all', href: `${E_APPROVAL_BASE_PATH}/all`, label: 'All Approvals', icon: BadgeCheck, tone: 'teal', group: 'registers', gate: 'all' },
  { id: 'completed', href: `${E_APPROVAL_BASE_PATH}/completed`, label: 'Completed', icon: CheckCircle2, tone: 'emerald', group: 'registers', gate: 'mine' },
  { id: 'rejected', href: `${E_APPROVAL_BASE_PATH}/rejected`, label: 'Rejected', icon: XCircle, tone: 'rose', group: 'registers', gate: 'mine' },

  { id: 'delegations', href: `${E_APPROVAL_BASE_PATH}/delegations`, label: 'Delegations', icon: UserCheck, tone: 'fuchsia', group: 'config', gate: 'delegations' },
  { id: 'reports', href: `${E_APPROVAL_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, tone: 'blue', group: 'config', gate: 'reports' },
  { id: 'settings', href: `${E_APPROVAL_BASE_PATH}/settings`, label: 'Settings', icon: Settings, tone: 'slate', group: 'config', gate: 'settings' },
  // Ungated on purpose: the person who cannot find anything is exactly the person who needs the guide.
  { id: 'help', href: `${E_APPROVAL_BASE_PATH}/help`, label: 'Guide', icon: BookOpen, tone: 'rose', group: 'config', gate: 'always' },
];

const groupLabels: Record<string, string> = {
  work: 'My Work',
  registers: 'Registers',
  config: 'Configuration',
};

export default function EApprovalLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <EApprovalModuleProvider>
      <EApprovalLayoutShellInner>{children}</EApprovalLayoutShellInner>
    </EApprovalModuleProvider>
  );
}

/**
 * Split from the provider so `useEApprovalPermissions` (via `useAuthorization`, not this module's
 * context) and the nav's own state are unaffected by where the provider sits — and so the provider
 * wraps every route this layout renders, including the access-denied screen.
 */
function EApprovalLayoutShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const permissions = useEApprovalPermissions();

  const { canCreate, canViewDepartment, canViewAll, canViewReports, canViewDelegations, canManageSettings } = permissions;
  const gates = useMemo<Record<NavKey, boolean>>(
    () => ({
      always: true,
      create: canCreate,
      inbox: true,
      mine: true,
      department: canViewDepartment,
      all: canViewAll,
      reports: canViewReports,
      delegations: canViewDelegations,
      settings: canManageSettings,
    }),
    [canCreate, canViewDepartment, canViewAll, canViewReports, canViewDelegations, canManageSettings],
  );

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      Object.keys(groupLabels).map((group) => ({
        id: group,
        label: groupLabels[group],
        items: sections.filter((item) => item.group === group).map((item) => ({ ...item, visible: gates[item.gate] })),
      })),
    [gates],
  );

  // The phone's bottom bar: the inbox and the files I raised either side of creating one, and
  // "More" opening the bar's pop-up of every page, grouped as the sidebar groups them. Each tab
  // only if its sidebar entry is visible too.
  const isVisible = (href: string) => sections.some((item) => item.href === href && gates[item.gate]);
  const mobileTabs: ModuleNavTab[] = [
    { href: E_APPROVAL_BASE_PATH, label: 'Home', icon: Gauge, exact: true },
    ...(isVisible(`${E_APPROVAL_BASE_PATH}/inbox`)
      ? [{ href: `${E_APPROVAL_BASE_PATH}/inbox`, label: 'Inbox', icon: Inbox, ariaLabel: 'My inbox' }]
      : []),
    ...(isVisible(`${E_APPROVAL_BASE_PATH}/create`)
      ? [{ href: `${E_APPROVAL_BASE_PATH}/create`, label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Create approval' }]
      : []),
    ...(isVisible(`${E_APPROVAL_BASE_PATH}/created-by-me`)
      ? [{ href: `${E_APPROVAL_BASE_PATH}/created-by-me`, label: 'Mine', icon: FileText, ariaLabel: 'Created by me' }]
      : []),
  ];

  return (
    <ModuleShell
      title="E-Approval"
      subtitle="E-Notesheet"
      icon={Stamp}
      groups={groups}
      mobileTabs={mobileTabs}
      // A print route gets the page to itself before any access check, as it always has: the
      // Approval Note page checks its own access, and the module chrome must never print.
      gate={pathname.includes('/print') ? undefined : { loading: permissions.isLoading, allowed: permissions.canViewModule }}
    >
      {children}
    </ModuleShell>
  );
}
