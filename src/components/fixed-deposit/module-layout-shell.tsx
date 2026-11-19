'use client';

import { useMemo, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  CircleCheck,
  Download,
  FilePlus2,
  Landmark,
  LayoutDashboard,
  List,
  Lock,
  LockOpen,
  Plus,
  RefreshCcw,
  Shield,
  SlidersHorizontal,
  SquareCheck,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

const MODULE = 'Fixed Deposit Management';

type GroupId = 'overview' | 'portfolio' | 'lifecycle' | 'data';
type Section = { id: string; href: string; label: string; resource: string; icon: LucideIcon; tone: ModuleNavTone; group: GroupId; match?: (path: string) => boolean };

/** Group headings in the sidebar; the dashboard sits alone above them, without one. */
const GROUP_LABELS: Record<GroupId, string | undefined> = {
  overview: undefined,
  portfolio: 'Portfolio',
  lifecycle: 'Lien & Lifecycle',
  data: 'Data',
};

const sections: Section[] = [
  { id: 'dashboard', href: '/fixed-deposit', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, tone: 'violet', group: 'overview', match: (path) => path === '/fixed-deposit' || path === '/fixed-deposit/dashboard' },
  { id: 'new', href: '/fixed-deposit/new', label: 'Create New FD', resource: 'FD Register', icon: FilePlus2, tone: 'emerald', group: 'portfolio' },
  { id: 'register', href: '/fixed-deposit/register', label: 'FD Register', resource: 'FD Register', icon: List, tone: 'blue', group: 'portfolio' },
  { id: 'maturity-calendar', href: '/fixed-deposit/maturity-calendar', label: 'Maturity Calendar', resource: 'Maturity Calendar', icon: CalendarDays, tone: 'orange', group: 'portfolio' },
  { id: 'available', href: '/fixed-deposit/available', label: 'Available FDs', resource: 'Available FDs', icon: CircleCheck, tone: 'teal', group: 'portfolio' },
  { id: 'assignments', href: '/fixed-deposit/assignments', label: 'BG / LC Assignments', resource: 'Assignments', icon: Shield, tone: 'indigo', group: 'lifecycle' },
  { id: 'renewals', href: '/fixed-deposit/renewals', label: 'Renewals', resource: 'Renewals', icon: RefreshCcw, tone: 'sky', group: 'lifecycle' },
  { id: 'closures', href: '/fixed-deposit/closures', label: 'Closures', resource: 'Closures', icon: Lock, tone: 'rose', group: 'lifecycle' },
  { id: 'releases', href: '/fixed-deposit/releases', label: 'Assignment Releases', resource: 'Releases', icon: LockOpen, tone: 'orange', group: 'lifecycle' },
  { id: 'approvals', href: '/fixed-deposit/approvals', label: 'Pending Approvals', resource: 'Approvals', icon: SquareCheck, tone: 'purple', group: 'lifecycle' },
  { id: 'reports', href: '/fixed-deposit/reports', label: 'Reports', resource: 'Reports', icon: BarChart3, tone: 'blue', group: 'data' },
  { id: 'import', href: '/fixed-deposit/import', label: 'Import & Reconcile', resource: 'Import & Reconciliation', icon: Download, tone: 'green', group: 'data' },
  { id: 'export', href: '/fixed-deposit/export', label: 'Export Centre', resource: 'FD Register', icon: Upload, tone: 'pink', group: 'data' },
  { id: 'settings', href: '/fixed-deposit/settings', label: 'Settings', resource: 'Settings', icon: SlidersHorizontal, tone: 'slate', group: 'data' },
];

type Can = ReturnType<typeof useAuthorization>['can'];

/** The menu entry's permission: the dashboard for anyone in the module, the rest by View or Add on their resource. */
const canSee = (can: Can, item: Section) => item.resource === 'Dashboard' || can('View', `${MODULE}.${item.resource}`) || can('Add', `${MODULE}.${item.resource}`);

export default function FixedDepositLayoutShell({ children }: { children: ReactNode }) {
  const { can, isLoading } = useAuthorization();
  const canViewModule = can('View Module', MODULE) || sections.some((item) => can('View', `${MODULE}.${item.resource}`));
  const canCreate = can('Add', `${MODULE}.FD Register`);

  const groups = useMemo<ModuleNavGroup[]>(() => (Object.keys(GROUP_LABELS) as GroupId[]).map((group) => ({
    id: group,
    label: GROUP_LABELS[group],
    items: sections.filter((item) => item.group === group).map((item) => ({ ...item, visible: canSee(can, item) })),
  })), [can]);

  // The phone's bottom bar: the dashboard, the register, creating an FD in the middle, approvals,
  // and "More" opening the pop-up of every page. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) => sections.some((item) => item.href === href && canSee(can, item));
  const mobileTabs: ModuleNavTab[] = [
    { href: '/fixed-deposit', label: 'Home', icon: LayoutDashboard, match: (path) => path === '/fixed-deposit' || path === '/fixed-deposit/dashboard' },
    ...(isVisible('/fixed-deposit/register') ? [{ href: '/fixed-deposit/register', label: 'Register', icon: List }] : []),
    ...(canCreate ? [{ href: '/fixed-deposit/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Create new fixed deposit' }] : []),
    ...(isVisible('/fixed-deposit/approvals') ? [{ href: '/fixed-deposit/approvals', label: 'Approvals', icon: SquareCheck }] : []),
  ];

  return (
    <ModuleShell
      title={MODULE}
      subtitle="Treasury Control"
      icon={Landmark}
      groups={groups}
      mobileTabs={mobileTabs}
      gate={{ loading: isLoading, allowed: canViewModule }}
    >
      {children}
    </ModuleShell>
  );
}
