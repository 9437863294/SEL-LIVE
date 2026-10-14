'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  FileText,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS } from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

const MODULE = 'Site Account Statement';

/*
 * accessMode controls who can see each nav entry:
 *   'admin'         – only canViewAll (super-admin)
 *   'rbac'          – has explicit RBAC permission for the resource
 *   'member+rbac'   – project member (any role) OR explicit RBAC
 *   'module'        – any user who can access the module at all (Dashboard)
 *
 * Settings uses a dedicated check, so its accessMode is ignored.
 */
type AccessMode = 'admin' | 'rbac' | 'member+rbac' | 'module';

const sections: {
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
  group: string;
  accessMode: AccessMode;
}[] = [
  { href: '/site-account-statement',                    label: 'Dashboard',          resource: 'Dashboard',        icon: LayoutDashboard, tone: 'emerald', group: 'core',         accessMode: 'module'     },
  { href: '/site-account-statement/payments',           label: 'Payments Received',  resource: 'Payments',         icon: TrendingUp,      tone: 'blue',    group: 'transactions', accessMode: 'member+rbac' },
  { href: '/site-account-statement/expenses',           label: 'Site Expenses',      resource: 'Expenses',         icon: TrendingDown,    tone: 'rose',    group: 'transactions', accessMode: 'member+rbac' },
  { href: '/site-account-statement/budget',             label: 'Site Fund Budget',   resource: 'Budget',           icon: Target,          tone: 'emerald', group: 'transactions', accessMode: 'rbac'       },
  { href: '/site-account-statement/tender-forecast',    label: 'Tender Forecast',    resource: 'Tender Forecast',  icon: BarChart3,       tone: 'teal',    group: 'transactions', accessMode: 'rbac'       },
  { href: '/site-account-statement/reports/receipts',  label: 'Receipt Report',     resource: 'Reports',          icon: FileText,        tone: 'teal',    group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/expenses',  label: 'Expense Report',     resource: 'Reports',          icon: Receipt,         tone: 'orange',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/statement', label: 'Account Statement',  resource: 'Reports',          icon: BookOpen,        tone: 'violet',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/summary',   label: 'Project Summary',    resource: 'Reports',          icon: BarChart3,       tone: 'indigo',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/category',  label: 'Category Analysis',  resource: 'Reports',          icon: PieChart,        tone: 'purple',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/cashflow',  label: 'Cash Flow',          resource: 'Reports',          icon: Activity,        tone: 'sky',     group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/person',    label: 'Person Expenses',    resource: 'Reports',          icon: Users,           tone: 'pink',    group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/balance',   label: 'Balance Status',     resource: 'Reports',          icon: ShieldCheck,     tone: 'green',   group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/daywise',             label: 'Day-wise Statement', resource: 'Reports', icon: CalendarDays,  tone: 'cyan',    group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/monthly-comparison', label: 'Month Comparison',   resource: 'Reports', icon: ArrowLeftRight, tone: 'fuchsia', group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/budget',            label: 'Budget Report',      resource: 'Reports', icon: Target,         tone: 'emerald', group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/settings',          label: 'Settings',           resource: 'Project Settings', icon: Settings,        tone: 'slate',   group: 'master',       accessMode: 'rbac'       },
];

/** Section headings, keyed by each entry's `group`. */
const GROUP_LABELS: Record<string, string> = {
  core: 'Overview',
  transactions: 'Transactions',
  reports: 'Reports',
  master: 'Settings',
};

const SETTINGS_HREF = '/site-account-statement/settings';

/** The Settings entry also stays lit on the pages its hub's cards open. */
const isSettingsPath = (path: string) =>
  path === SETTINGS_HREF ||
  path.startsWith(`${SETTINGS_HREF}/`) ||
  path.startsWith('/site-account-statement/expense-categories') ||
  path.startsWith('/site-account-statement/budget-alerts') ||
  path.startsWith('/site-account-statement/tender-budget');

export default function SiteAccountStatementShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const { user } = useAuth();

  // Separate state: is the user actually assigned to a project (any role)?
  // We always check this — previously the check was skipped for RBAC users,
  // which caused all RBAC users to be treated as project members for nav purposes.
  const [isProjectMember, setIsProjectMember] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);

  const canViewAll = can('View', `${MODULE}.All Projects`);

  const hasRbacAccess =
    canViewAll ||
    can('View Module', MODULE) ||
    sections.some(s => Boolean(s.resource) && (
      can('View', `${MODULE}.${s.resource}`) ||
      can('Add',  `${MODULE}.${s.resource}`)
    )) ||
    ['Budget Alerts', 'Expense Categories', 'Total Budget', 'FY Budget', 'Monthly Budget', 'Category Budget'].some(r =>
      can('View', `${MODULE}.${r}`) ||
      can('Add',  `${MODULE}.${r}`) ||
      can('Edit', `${MODULE}.${r}`)
    );

  useEffect(() => {
    if (!user?.id) { setMembershipChecked(true); return; }
    const col = collection(db, SAS_COLLECTIONS.projects);
    Promise.all([
      getDocs(query(col, where('assignedPersonId', '==', user.id))),
      getDocs(query(col, where('altUserId',        '==', user.id))),
      getDocs(query(col, where('viewerId',         '==', user.id))),
    ])
      .then(([a, b, c]) => setIsProjectMember(!a.empty || !b.empty || !c.empty))
      .finally(() => setMembershipChecked(true));
  }, [user?.id, canViewAll]);

  const canViewModule = hasRbacAccess || isProjectMember;

  const availableSections = useMemo(() => {
    if (!membershipChecked) return [];
    // Determine which sections the current user can access.
    const canAccessSection = (item: typeof sections[0]): boolean => {
      // Settings: requires explicit Settings-family RBAC
      if (item.href === SETTINGS_HREF) {
        return ['Project Settings', 'Expense Categories', 'Budget Alerts', 'Tender Budget', 'Field Control', 'Date Control'].some(r =>
          can('View', `${MODULE}.${r}`) || can('Add', `${MODULE}.${r}`) || can('Edit', `${MODULE}.${r}`)
        );
      }

      // Site Fund Budget: role management is granular (Total / FY / Monthly / Category
      // Budget), so the nav link shows up if the role has ANY of those, not just the
      // coarse "Budget" resource.
      if (item.href === '/site-account-statement/budget') {
        return ['Budget', 'Total Budget', 'FY Budget', 'Monthly Budget', 'Category Budget'].some(r =>
          can('View', `${MODULE}.${r}`) || can('Add', `${MODULE}.${r}`) || can('Edit', `${MODULE}.${r}`)
        );
      }

      switch (item.accessMode) {
        case 'module':
          return canViewModule;
        case 'member+rbac':
          return (
            isProjectMember ||
            can('View', `${MODULE}.${item.resource}`) ||
            can('Add',  `${MODULE}.${item.resource}`) ||
            can('Edit', `${MODULE}.${item.resource}`)
          );
        case 'rbac':
          return (
            can('View', `${MODULE}.${item.resource}`) ||
            can('Add',  `${MODULE}.${item.resource}`) ||
            can('Edit', `${MODULE}.${item.resource}`)
          );
        default:
          return false;
      }
    };
    return sections.filter(canAccessSection);
  }, [can, canViewModule, isProjectMember, membershipChecked]);

  // Check whether the CURRENT page is in the user's allowed set.
  const isCurrentPageAccessible =
    !membershipChecked ||
    availableSections.some(s =>
      s.href === SETTINGS_HREF
        ? isSettingsPath(safePathname)
        : safePathname === s.href || (s.href !== '/site-account-statement' && safePathname.startsWith(s.href + '/'))
    );

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const out: ModuleNavGroup[] = [];
    for (const { group, accessMode: _accessMode, resource: _resource, ...item } of availableSections) {
      const navItem = { ...item, id: item.href, ...(item.href === SETTINGS_HREF ? { match: isSettingsPath } : {}) };
      const last = out[out.length - 1];
      if (last && last.id === group) last.items.push(navItem);
      else out.push({ id: group, label: GROUP_LABELS[group], items: [navItem] });
    }
    return out;
  }, [availableSections]);

  // The phone's bottom bar: the two ledgers entered from site and the statement they add up to, with
  // "More" opening the pop-up of every page. Each tab only if its sidebar entry is visible too. Expenses
  // and payments are added from a dialog on their own page, so there is no create tab.
  const isVisible = (href: string) => availableSections.some(s => s.href === href);
  const bottomTabs: ModuleNavTab[] = [
    { href: '/site-account-statement', label: 'Home', icon: LayoutDashboard, exact: true },
    ...(isVisible('/site-account-statement/expenses')
      ? [{ href: '/site-account-statement/expenses', label: 'Expenses', icon: TrendingDown, ariaLabel: 'Site expenses' }]
      : []),
    ...(isVisible('/site-account-statement/payments')
      ? [{ href: '/site-account-statement/payments', label: 'Payments', icon: TrendingUp, ariaLabel: 'Payments received' }]
      : []),
    ...(isVisible('/site-account-statement/reports/statement')
      ? [{ href: '/site-account-statement/reports/statement', label: 'Statement', icon: BookOpen, ariaLabel: 'Account statement' }]
      : []),
  ];

  return (
    <ModuleShell
      title={MODULE}
      subtitle="Fund Tracker"
      icon={Wallet}
      groups={groups}
      mobileTabs={bottomTabs}
      gate={{ loading: !membershipChecked, allowed: canViewModule, pageAllowed: isCurrentPageAccessible }}
    >
      {children}
    </ModuleShell>
  );
}
