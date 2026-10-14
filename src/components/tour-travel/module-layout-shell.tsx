'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  Plane,
  Plus,
  ReceiptIndianRupee,
  Settings,
  Undo2,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab, type ModuleNavTone } from '@/components/shared/module-shell';

/** The permission module name; must match the key in `permissionModules`. */
export const TT_PERMISSION_MODULE = 'Tour, Travel & Expense';

type NavItem = {
  id: string;
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  tone: ModuleNavTone;
  group: string;
  match?: (path: string) => boolean;
};

const dashboardMatch = (path: string) => path === '/tour-travel' || path === '/tour-travel/dashboard';

/**
 * Navigation for the module, grouped in the order a tour actually moves: what's mine, what needs a
 * decision, where the money is, then configuration.
 */
const navItems: NavItem[] = [
  { id: 'dashboard', href: '/tour-travel', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, tone: 'sky', group: 'overview', match: dashboardMatch },
  { id: 'my-travel', href: '/tour-travel/my-travel', label: 'My Travel', resource: 'Tour Requests', icon: UserRound, tone: 'cyan', group: 'overview' },

  { id: 'requests', href: '/tour-travel/requests', label: 'Tour Requests', resource: 'Tour Requests', icon: Plane, tone: 'blue', group: 'tours' },

  { id: 'approvals', href: '/tour-travel/approvals', label: 'Approvals', resource: 'Approvals', icon: ClipboardCheck, tone: 'amber', group: 'control' },

  { id: 'advances', href: '/tour-travel/advances', label: 'Travel Advances', resource: 'Advances', icon: Wallet, tone: 'violet', group: 'money' },
  { id: 'claims', href: '/tour-travel/claims', label: 'Expense Claims', resource: 'Claims', icon: ReceiptIndianRupee, tone: 'emerald', group: 'money' },
  { id: 'payments', href: '/tour-travel/payments', label: 'Reimbursements', resource: 'Payments', icon: Coins, tone: 'teal', group: 'money' },
  { id: 'recoveries', href: '/tour-travel/recoveries', label: 'Recoveries', resource: 'Recoveries', icon: Undo2, tone: 'rose', group: 'money' },

  { id: 'settings', href: '/tour-travel/settings', label: 'Settings', resource: 'Settings', icon: Settings, tone: 'slate', group: 'settings' },
];
// Travel Desk (bookings), Travel Calendar and Reports are Phase 2/3 of the module plan; their
// permission resources already exist in `permissionModules` so the routes can be added without a
// role migration, but they are kept out of the nav until they're built rather than shipped as
// links to nothing.

/** Headings for each `group`, in the sidebar and in the phone's "More" pop-up. */
const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  tours: 'Tours',
  control: 'Decisions',
  money: 'Money',
  settings: 'Configuration',
};
const GROUP_ORDER = ['overview', 'tours', 'control', 'money', 'settings'];

function matchesPath(pathname: string, href: string) {
  if (href === '/tour-travel') return dashboardMatch(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TourTravelLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();

  /**
   * Every employee needs their own travel, whatever their role — a module that only opened for
   * permission holders would make expense claims unreachable for exactly the people who file them.
   * So "My Travel" and the request form are available to anyone who can see the module at all, and
   * the role check governs the organization-wide registers instead.
   */
  const visibleItems = useMemo(
    () =>
      navItems.filter(item => {
        if (item.href === '/tour-travel' || item.href === '/tour-travel/my-travel') return true;
        return can('View', `${TT_PERMISSION_MODULE}.${item.resource}`);
      }),
    [can],
  );

  const groups = useMemo<ModuleNavGroup[]>(
    () =>
      GROUP_ORDER.map(group => ({
        id: group,
        label: GROUP_LABELS[group],
        items: navItems
          .filter(item => item.group === group)
          .map(item => ({
            id: item.id,
            href: item.href,
            label: item.label,
            icon: item.icon,
            tone: item.tone,
            match: item.match,
            visible: visibleItems.includes(item),
          })),
      })),
    [visibleItems],
  );

  const canViewModule = can('View Module', TT_PERMISSION_MODULE);
  const currentPageAllowed =
    // The tour request form and a user's own records sit under routes the register permission
    // doesn't cover, so they're matched by prefix rather than by an exact nav entry.
    safePathname.startsWith('/tour-travel/my-travel') ||
    safePathname === '/tour-travel/requests/new' ||
    visibleItems.some(item => matchesPath(safePathname, item.href));

  // The phone's bottom bar: my own travel, raising a tour in the middle, the approval queue, and
  // "More" opening the bar's pop-up of every visible page. Dashboard, My Travel and the request
  // form are open to every module user (see above); Approvals only if its sidebar entry is visible
  // too.
  const bottomTabs: ModuleNavTab[] = [
    { href: '/tour-travel', label: 'Home', icon: LayoutDashboard, match: dashboardMatch },
    { href: '/tour-travel/my-travel', label: 'My Travel', icon: UserRound },
    { href: '/tour-travel/requests/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New tour request' },
    ...(visibleItems.some(item => item.href === '/tour-travel/approvals')
      ? [{ href: '/tour-travel/approvals', label: 'Approvals', icon: ClipboardCheck }]
      : []),
  ];

  return (
    // `tt-module-root` carries the module's mobile rules (44px tap targets, scrollable tab strips,
    // safe-area padding, compact card padding) — see globals.css.
    <div className="tour-travel-theme tt-module-root w-full">
      <ModuleShell
        title="Tour & Travel"
        subtitle="Travel & Expense Manager"
        icon={Plane}
        groups={groups}
        mobileTabs={bottomTabs}
        gate={{
          loading: authLoading,
          allowed: canViewModule,
          deniedMessage: 'You do not have permission to access Tour, Travel & Expense.',
          pageAllowed: currentPageAllowed,
          pageDeniedMessage: 'You do not have permission to view this page.',
        }}
      >
        {children}
      </ModuleShell>
    </div>
  );
}
