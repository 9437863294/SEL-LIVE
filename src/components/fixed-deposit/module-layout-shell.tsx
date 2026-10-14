'use client';

import { useMemo, type ReactNode } from 'react';
import {
  BadgeIndianRupee,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  FileDown,
  FileText,
  FileUp,
  Landmark,
  LayoutDashboard,
  ListTree,
  Plus,
  RefreshCcw,
  Replace,
  Settings2,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

const MODULE = 'Fixed Deposit Management';

type Section = { id: string; href: string; label: string; resource: string; icon: LucideIcon; tone: ModuleNavTone; match?: (path: string) => boolean };

const sections: Section[] = [
  { id: 'dashboard', href: '/fixed-deposit', label: 'Dashboard', resource: 'Dashboard', icon: BarChart3, tone: 'cyan', match: (path) => path === '/fixed-deposit' || path === '/fixed-deposit/dashboard' },
  { id: 'new', href: '/fixed-deposit/new', label: 'Create New FD', resource: 'FD Register', icon: FilePlus2, tone: 'emerald' },
  { id: 'register', href: '/fixed-deposit/register', label: 'FD Register', resource: 'FD Register', icon: ListTree, tone: 'blue' },
  { id: 'maturity-calendar', href: '/fixed-deposit/maturity-calendar', label: 'Maturity Calendar', resource: 'Maturity Calendar', icon: CalendarClock, tone: 'amber' },
  { id: 'available', href: '/fixed-deposit/available', label: 'Available FDs', resource: 'Available FDs', icon: CheckCircle2, tone: 'teal' },
  { id: 'assignments', href: '/fixed-deposit/assignments', label: 'BG / LC Assignments', resource: 'Assignments', icon: Landmark, tone: 'indigo' },
  { id: 'renewals', href: '/fixed-deposit/renewals', label: 'Renewals', resource: 'Renewals', icon: RefreshCcw, tone: 'sky' },
  { id: 'closures', href: '/fixed-deposit/closures', label: 'Closures', resource: 'Closures', icon: Replace, tone: 'rose' },
  { id: 'releases', href: '/fixed-deposit/releases', label: 'Assignment Releases', resource: 'Releases', icon: Unlink, tone: 'orange' },
  { id: 'approvals', href: '/fixed-deposit/approvals', label: 'Pending Approvals', resource: 'Approvals', icon: ClipboardCheck, tone: 'violet' },
  { id: 'reports', href: '/fixed-deposit/reports', label: 'Reports', resource: 'Reports', icon: FileText, tone: 'blue' },
  { id: 'import', href: '/fixed-deposit/import', label: 'Import & Reconcile', resource: 'Import & Reconciliation', icon: FileUp, tone: 'emerald' },
  { id: 'export', href: '/fixed-deposit/export', label: 'Export Centre', resource: 'FD Register', icon: FileDown, tone: 'fuchsia' },
  { id: 'settings', href: '/fixed-deposit/settings', label: 'Settings', resource: 'Settings', icon: Settings2, tone: 'slate' },
];

type Can = ReturnType<typeof useAuthorization>['can'];

/** The menu entry's permission: the dashboard for anyone in the module, the rest by View or Add on their resource. */
const canSee = (can: Can, item: Section) => item.resource === 'Dashboard' || can('View', `${MODULE}.${item.resource}`) || can('Add', `${MODULE}.${item.resource}`);

export default function FixedDepositLayoutShell({ children }: { children: ReactNode }) {
  const { can, isLoading } = useAuthorization();
  const canViewModule = can('View Module', MODULE) || sections.some((item) => can('View', `${MODULE}.${item.resource}`));
  const canCreate = can('Add', `${MODULE}.FD Register`);

  const groups = useMemo<ModuleNavGroup[]>(() => [{ id: 'main', items: sections.map((item) => ({ ...item, visible: canSee(can, item) })) }], [can]);

  // The phone's bottom bar: the dashboard, the register, creating an FD in the middle, approvals,
  // and "More" opening the pop-up of every page. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) => sections.some((item) => item.href === href && canSee(can, item));
  const mobileTabs: ModuleNavTab[] = [
    { href: '/fixed-deposit', label: 'Home', icon: LayoutDashboard, match: (path) => path === '/fixed-deposit' || path === '/fixed-deposit/dashboard' },
    ...(isVisible('/fixed-deposit/register') ? [{ href: '/fixed-deposit/register', label: 'Register', icon: ListTree }] : []),
    ...(canCreate ? [{ href: '/fixed-deposit/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Create new fixed deposit' }] : []),
    ...(isVisible('/fixed-deposit/approvals') ? [{ href: '/fixed-deposit/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  return (
    <ModuleShell
      title={MODULE}
      subtitle="Treasury Control"
      icon={BadgeIndianRupee}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{ loading: isLoading, allowed: canViewModule }}
    >
      {children}
    </ModuleShell>
  );
}
