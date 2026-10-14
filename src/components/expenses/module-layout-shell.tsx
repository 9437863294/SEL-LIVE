'use client';

/**
 * The Expenses module shell: its menu and gates on the shared `ModuleShell`, which draws the
 * sidebar, the phone's header and floating bottom bar, and owns the padding (pages add none).
 *
 * Reports carries the report list as children, selected through `?report=` so a report can be
 * linked to; on a phone the bar's "More" pop-up leads with the same list while Reports is open.
 */

import * as React from 'react';
import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BarChart3, IndianRupee, LayoutDashboard, Layers, Plus, Settings } from 'lucide-react';
import { EXPENSE_REPORTS, EXPENSE_REPORT_GROUPS } from '@/lib/expenses-reports';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleShell, type ModuleNavGroup, type ModuleNavItem, type ModuleNavTab } from '@/components/shared/module-shell';
import { SheetClose } from '@/components/ui/sheet';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCompanyProfile } from '@/hooks/use-company-profile';
import { cn } from '@/lib/utils';

/**
 * A section's sub-entry. Report children select through a query key (`?report=`); a child with
 * an `href` of its own is a page, and is lit by the path instead.
 */
type NavChild = { id: string; label: string; group: string; href?: string };

/** The custom pivot sits in the list alongside the fixed reports; the page knows this id too. */
const PIVOT_ID = 'custom-pivot';

const CHILD_GROUP_ORDER = [...EXPENSE_REPORT_GROUPS, 'Custom'];

/** The report list, in the order its groups are shown. */
const reportChildren: NavChild[] = [
  ...EXPENSE_REPORTS.map(report => ({ id: report.id, label: report.title, group: report.group })),
  { id: PIVOT_ID, label: 'Custom Pivot', group: 'Custom' },
].sort((a, b) => CHILD_GROUP_ORDER.indexOf(a.group) - CHILD_GROUP_ORDER.indexOf(b.group));

const REPORTS_HREF = '/expenses/reports';
const REPORT_PARAM = 'report';

/** Where a child links to. */
const childHref = (parentHref: string, childParam: string | undefined, child: NavChild) =>
  child.href ?? `${parentHref}?${childParam}=${child.id}`;

/**
 * Whether a child is the one open. A page child is lit by the path; a query child by its key, with
 * the first entry standing in when nothing is selected (that is what the page falls back to).
 */
const isChildSelected = (
  child: NavChild,
  children: NavChild[],
  selected: string | null | undefined,
  pathname: string,
) => {
  if (child.href) return pathname === child.href || pathname.startsWith(`${child.href}/`);
  return selected ? selected === child.id : child.id === children[0].id;
};

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const safePathname = pathname || '';
  const selectedReport = searchParams?.get(REPORT_PARAM) ?? null;

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

  const groups = useMemo<ModuleNavGroup[]>(() => {
    const reportItems: ModuleNavItem[] = reportChildren.map(child => ({
      id: `report:${child.id}`,
      label: child.label,
      href: childHref(REPORTS_HREF, REPORT_PARAM, child),
      // The children share one path, so each is lit by its query key.
      match: (path: string) =>
        (path === REPORTS_HREF || path.startsWith(`${REPORTS_HREF}/`)) &&
        isChildSelected(child, reportChildren, selectedReport, path),
    }));
    return [
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
          { id: 'reports', href: REPORTS_HREF, label: 'Reports', icon: BarChart3, tone: 'fuchsia', visible: canReports, children: reportItems },
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
    ];
  }, [can, authLoading, canCreateAnywhere, canReports, selectedReport]);

  // The phone's bottom bar: Overview and the consolidated register, raising a request in the
  // middle, and "More" opening the bar's pop-up of every page (and, on Reports, the report list —
  // see `moreContent` below). Each tab only if its sidebar entry is visible too, and none until
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
        ...(canReports ? [{ href: REPORTS_HREF, label: 'Reports', icon: BarChart3 }] : []),
      ];

  /**
   * On a phone there is no sidebar to nest the report list under, so while Reports is open the
   * "More" pop-up leads with it, as chips. Each is a `SheetClose`: picking another report only
   * changes the query string, and the bar closes its pop-up by itself only when the path changes.
   */
  const reportsOpen = !authLoading && canReports && matchesPath(safePathname, REPORTS_HREF);
  const moreContent = reportsOpen ? (
    <section aria-label="Reports list">
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        Reports
      </p>
      <div className="space-y-2.5 rounded-2xl border border-border/60 bg-muted/30 p-3">
        {CHILD_GROUP_ORDER.map(group => {
          const inGroup = reportChildren.filter(child => child.group === group);
          if (!inGroup.length) return null;
          return (
            <div key={group}>
              <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {inGroup.map(child => {
                  // Same rule as the sidebar.
                  const isSelected = isChildSelected(child, reportChildren, selectedReport, safePathname);
                  return (
                    <SheetClose key={child.id} asChild>
                      <Link
                        href={childHref(REPORTS_HREF, REPORT_PARAM, child)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isSelected
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border/60 bg-background text-foreground/80 hover:bg-muted/60',
                        )}
                      >
                        {child.label}
                      </Link>
                    </SheetClose>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  ) : undefined;

  return (
    <ModuleShell
      title="Expenses"
      subtitle="Requests & Reporting"
      icon={IndianRupee}
      groups={groups}
      mobileTabs={bottomTabs}
      mobileMoreContent={moreContent}
    >
      {children}
      <footer className="mt-6 flex items-center border-t border-slate-200/70 px-1 py-3 text-xs text-muted-foreground print:hidden">
        <span>Copyright © 2025 {profile.shortName || profile.legalName}. All Rights Reserved.</span>
      </footer>
    </ModuleShell>
  );
}
