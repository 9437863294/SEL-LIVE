'use client';

/**
 * The Expenses module shell: its menu and gates on the shared `ModuleShell`, which draws the
 * sidebar, the phone's header and floating bottom bar, and owns the padding (pages add none).
 *
 * Reports is one entry: the reports page lists every report in its group (`ExpenseReportsHub`),
 * and an open report switches to another from its own header, so neither the sidebar nor the
 * phone's "More" pop-up carries the list.
 */

import * as React from 'react';
import { useMemo } from 'react';
import { BarChart3, IndianRupee, LayoutDashboard, Layers, Plus, Settings } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleShell, type ModuleNavGroup, type ModuleNavTab } from '@/components/shared/module-shell';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCompanyProfile } from '@/hooks/use-company-profile';

const REPORTS_HREF = '/expenses/reports';

/** Headings for each `group`, in the sidebar and the phone's "More" pop-up. */
const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  registers: 'Registers',
  admin: 'Configuration',
};

/** Sub-routes with a nav entry of their own; anything else under /expenses belongs to Overview. */
const NAMED_SUB_ROUTES = ['/expenses/new-request', '/expenses/all', '/expenses/reports', '/expenses/settings', '/expenses/audit-log'];

function matchesPath(pathname: string, href: string) {
  if (href === '/expenses') {
    // Department registers (/expenses/<id>) are reached from Overview and read as part of it, so
    // Overview stays lit rather than the menu going blank on those pages. The create form has an
    // entry of its own now, and lights that instead.
    return pathname === '/expenses' || !NAMED_SUB_ROUTES.some(route => pathname.startsWith(route));
  }
  // The Audit Log is a card on the Settings page, not a menu entry of its own, so Settings stays lit on it.
  if (href === '/expenses/settings' && (pathname === '/expenses/audit-log' || pathname.startsWith('/expenses/audit-log/'))) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function ExpensesLayoutShell({ children }: { children: React.ReactNode }) {
  const { can, isLoading: authLoading } = useAuthorization();
  const { permissions } = useAuth();
  const { profile } = useCompanyProfile();

  /**
   * Raising a request is granted per department (`Expenses.Departments.<deptId>`), and the shell
   * does not load the department list, so this asks whether any department grant carries Create —
   * the grants Overview's "New Request" card reads — without repeating Overview's Firestore read.
   * The sidebar entry and the bottom bar's New tab both hang off it, so they appear together.
   */
  const canCreateAnywhere =
    can('Create', 'Expenses.Departments') ||
    Object.entries(permissions).some(
      ([key, actions]) => key.startsWith('Expenses.Departments.') && Array.isArray(actions) && actions.includes('Create'),
    );

  const canReports = can('View', 'Expenses.Reports');

  const groups = useMemo<ModuleNavGroup[]>(
    () => [
      {
        id: 'overview',
        label: GROUP_LABELS.overview,
        items: [
          { id: 'overview', href: '/expenses', label: 'Overview', icon: LayoutDashboard, tone: 'blue', match: path => matchesPath(path, '/expenses') },
          { id: 'new-request', href: '/expenses/new-request', label: 'New Request', icon: Plus, tone: 'emerald', visible: !authLoading && canCreateAnywhere },
        ],
      },
      {
        id: 'registers',
        label: GROUP_LABELS.registers,
        items: [
          { id: 'all', href: '/expenses/all', label: 'Consolidated', icon: Layers, tone: 'violet', visible: can('View All', 'Expenses.Expense Requests') },
          { id: 'reports', href: REPORTS_HREF, label: 'Reports', icon: BarChart3, tone: 'fuchsia', visible: canReports, match: path => matchesPath(path, REPORTS_HREF) },
        ],
      },
      {
        id: 'admin',
        label: GROUP_LABELS.admin,
        items: [
          {
            id: 'settings',
            href: '/expenses/settings',
            label: 'Settings',
            icon: Settings,
            tone: 'teal',
            match: path => matchesPath(path, '/expenses/settings'),
            // Field & Data Control and the Audit Log are cards on the Settings page, so whoever may open
            // one of them reaches it through Settings.
            visible:
              can('View', 'Expenses.Settings') ||
              can('View', 'Expenses.Field Control') ||
              can('View', 'Expenses.Data Control') ||
              can('View', 'Expenses.Audit Log') ||
              can('View', 'Settings.Audit Logs'),
          },
        ],
      },
    ],
    [can, authLoading, canCreateAnywhere, canReports],
  );

  // The phone's bottom bar: Overview and the consolidated register, raising a request in the
  // middle, and Reports. Each tab only if its sidebar entry is visible too, and none until
  // permissions resolve so the bar does not grow.
  const canAll = can('View All', 'Expenses.Expense Requests');
  const bottomTabs: ModuleNavTab[] = authLoading
    ? []
    : [
        { href: '/expenses', label: 'Home', icon: LayoutDashboard, match: path => matchesPath(path, '/expenses') },
        ...(canAll
          ? [{ href: '/expenses/all', label: 'All', icon: Layers, ariaLabel: 'Consolidated register' }]
          : []),
        ...(canCreateAnywhere
          ? [{ href: '/expenses/new-request', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New expense request' }]
          : []),
        ...(canReports ? [{ href: REPORTS_HREF, label: 'Reports', icon: BarChart3, match: (path: string) => matchesPath(path, REPORTS_HREF) }] : []),
      ];

  return (
    <ModuleShell
      title="Expenses"
      subtitle="Requests & Reporting"
      icon={IndianRupee}
      groups={groups}
      mobileTabs={bottomTabs}
    >
      {children}
      <footer className="mt-6 flex items-center border-t border-slate-200/70 px-1 py-3 text-xs text-muted-foreground print:hidden">
        <span>Copyright © 2025 {profile.shortName || profile.legalName}. All Rights Reserved.</span>
      </footer>
    </ModuleShell>
  );
}
