'use client';

import * as React from 'react';
import { LayoutDashboard } from 'lucide-react';
import { ModuleBottomNav, type ModuleMoreLink, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { EMPLOYEE_GROUPS, EMPLOYEE_NAV, useEmployeeAccess } from '@/components/employee/employee-ui';

/** The module's own routes, so `/employee/<id>` can be told apart from them. */
const MODULE_HREFS = new Set(['/employee', ...EMPLOYEE_NAV.map(item => item.href)]);

/** An employee's profile: one segment under `/employee` that is not one of the module's screens. */
const isProfilePath = (path: string) => /^\/employee\/[^/]+$/.test(path) && !MODULE_HREFS.has(path);

/**
 * The phone's bottom bar for Employee Management.
 *
 * Built from the module map in `employee-ui`, so it cannot drift from the hub or the sub-nav: the hub
 * first, then the hub's own "Start here" screens under their sub-nav names. "More" opens the bar's
 * own sheet, since the module has no menu to hand over to, listing what the sub-nav lists, grouped
 * the way the hub groups it. Gated by the same `useEmployeeAccess`, and held back while it resolves
 * for the same reason the sub-nav is. Every screen reads what greytHR holds, so there is no create
 * tab.
 */
export function EmployeeBottomNav() {
  const access = useEmployeeAccess();

  const { tabs, moreLinks, hasAny } = React.useMemo(() => {
    const permitted = EMPLOYEE_NAV.filter(item => !item.navHidden && !item.comingSoon && access.permits(item));

    const tabs: ModuleNavTab[] = [
      { href: '/employee', label: 'Home', icon: LayoutDashboard, exact: true, ariaLabel: 'Employee Management overview' },
      ...permitted
        .filter(item => item.group === 'primary')
        .map(item => ({
          href: item.href,
          label: item.short,
          icon: item.icon,
          ariaLabel: item.label,
          // A profile is opened from the roster and goes back to it, so the roster stays lit there.
          match:
            item.key === 'manage'
              ? (path: string) => path === item.href || path.startsWith(`${item.href}/`) || isProfilePath(path)
              : undefined,
        })),
    ];

    const moreLinks: ModuleMoreLink[] = [
      { href: '/employee', label: 'Overview', icon: LayoutDashboard, group: EMPLOYEE_GROUPS[0].title, exact: true },
      ...EMPLOYEE_GROUPS.flatMap(group =>
        permitted
          .filter(item => item.group === group.key)
          .map(item => ({ href: item.href, label: item.label, icon: item.icon, group: group.title })),
      ),
    ];

    return { tabs, moreLinks, hasAny: permitted.length > 0 };
  }, [access]);

  // Nothing to offer until the permissions land, and nothing at all to somebody the hub turns away.
  if (access.isLoading || !hasAny) return null;

  return <ModuleBottomNav tabs={tabs} moreLinks={moreLinks} moduleName="Employee Management" />;
}

export default EmployeeBottomNav;
