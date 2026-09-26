'use client';

/**
 * The Expenses module shell.
 *
 * Two things this fixes over the fixed-rail version it replaces. Padding is owned here and only
 * here — every page used to add `px-4 sm:px-6 lg:px-8` of its own on top of the shell's `p-6`,
 * which stacked into ~56px of dead margin down each side and left the create form floating in the
 * middle of the screen. And there was no mobile treatment at all: a 56px rail sat pinned to the
 * left of a phone screen with no way to collapse it, so below `lg` the nav is now the floating
 * bottom bar, whose "More" pop-up also carries the report list while Reports is open.
 *
 * The layout and colour language follow the Recurring Payments shell, which is the pattern the
 * rest of the app has converged on — a sidebar card with a gradient brand header, per-item colour
 * chips, and a tinted backdrop. Expenses takes blue→indigo as its identity, the colour its rupee
 * mark already used.
 */

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { BarChart3, ChevronDown, ChevronRight, IndianRupee, LayoutDashboard, Layers, Plus, Settings, type LucideIcon } from 'lucide-react';
import { EXPENSE_REPORTS, EXPENSE_REPORT_GROUPS } from '@/lib/expenses-reports';
import { useAuth } from '@/components/auth/AuthProvider';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SheetClose } from '@/components/ui/sheet';
import { useAuthorization } from '@/hooks/useAuthorization';
import { cn } from '@/lib/utils';

type NavChild = { id: string; label: string; group: string };

type NavItem = {
  href: string;
  label: string;
  caption: string;
  icon: LucideIcon;
  /** Idle icon chip. */
  color: string;
  bg: string;
  /** Active pill. */
  gradient: string;
  glow: string;
  group: string;
  permitted: boolean;
  /**
   * Rendered beneath the item while it is the active section, and folded away as soon as another
   * section is opened. Selection travels in the URL (`?report=`) so a report can be linked to.
   */
  children?: NavChild[];
  /** Query key the children select through. */
  childParam?: string;
};

/** The custom pivot sits in the list alongside the fixed reports; the page knows this id too. */
const PIVOT_ID = 'custom-pivot';

const reportChildren: NavChild[] = [
  ...EXPENSE_REPORTS.map(report => ({ id: report.id, label: report.title, group: report.group })),
  { id: PIVOT_ID, label: 'Custom Pivot', group: 'Custom' },
];

const CHILD_GROUP_ORDER = [...EXPENSE_REPORT_GROUPS, 'Custom'];

/** Headings for each `group` in the phone's "More" pop-up; the sidebar draws the same groups as dividers. */
const GROUP_LABELS: Record<string, string> = {
  overview: 'Overview',
  registers: 'Registers',
  admin: 'Configuration',
};

/** Sub-routes with a nav entry of their own; anything else under /expenses belongs to Overview. */
const NAMED_SUB_ROUTES = ['/expenses/all', '/expenses/reports', '/expenses/settings'];

function matchesPath(pathname: string, href: string) {
  if (href === '/expenses') {
    // Department registers (/expenses/<id>) and the create form are reached from Overview and read
    // as part of it, so Overview stays lit rather than the menu going blank on those pages.
    return pathname === '/expenses' || !NAMED_SUB_ROUTES.some(route => pathname.startsWith(route));
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function ExpensesLayoutShell({ children }: { children: React.ReactNode }) {
  const { can, isLoading: authLoading } = useAuthorization();
  const { permissions } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const safePathname = pathname || '';
  /** Sections the user has folded by hand while still on them. */
  const [collapsedSections, setCollapsedSections] = useState<string[]>([]);
  const iconsOnly = useSidebarIconsOnly();
  /** Icons mode has no room for the report list under Reports, so it opens beside the rail instead. */
  const [childFlyoutOpen, setChildFlyoutOpen] = useState(false);

  const navItems: NavItem[] = [
    {
      href: '/expenses',
      label: 'Overview',
      caption: 'Departments',
      icon: LayoutDashboard,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      gradient: 'from-blue-500 to-indigo-600',
      glow: 'shadow-[0_8px_24px_-8px_rgba(59,130,246,0.55)]',
      group: 'overview',
      permitted: true,
    },
    {
      href: '/expenses/all',
      label: 'Consolidated',
      caption: 'Every department',
      icon: Layers,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      gradient: 'from-violet-500 to-purple-600',
      glow: 'shadow-[0_8px_24px_-8px_rgba(139,92,246,0.55)]',
      group: 'registers',
      permitted: can('View All', 'Expenses.Expense Requests'),
    },
    {
      href: '/expenses/reports',
      label: 'Reports',
      caption: 'Pivot analysis',
      icon: BarChart3,
      color: 'text-fuchsia-600',
      bg: 'bg-fuchsia-50',
      gradient: 'from-fuchsia-500 to-pink-600',
      glow: 'shadow-[0_8px_24px_-8px_rgba(217,70,239,0.55)]',
      group: 'registers',
      permitted: can('View', 'Expenses.Reports'),
      children: reportChildren,
      childParam: 'report',
    },
    {
      href: '/expenses/settings',
      label: 'Settings',
      caption: 'Series & accounts',
      icon: Settings,
      color: 'text-teal-600',
      bg: 'bg-teal-50',
      gradient: 'from-teal-500 to-emerald-600',
      glow: 'shadow-[0_8px_24px_-8px_rgba(20,184,166,0.55)]',
      group: 'admin',
      permitted: can('View', 'Expenses.Settings'),
    },
  ].filter(item => item.permitted);

  /**
   * Raising a request is granted per department (`Expenses.Departments.<deptId>`), and the shell
   * does not load the department list, so this asks whether any department grant carries Create —
   * the grants Overview's "New Request" card reads — without repeating Overview's Firestore read.
   */
  const canCreateAnywhere =
    can('Create', 'Expenses.Departments') ||
    Object.entries(permissions).some(
      ([key, actions]) => key.startsWith('Expenses.Departments.') && Array.isArray(actions) && actions.includes('Create'),
    );

  // The phone's bottom bar: Overview and the consolidated register, raising a request in the
  // middle, and "More" opening the bar's pop-up of every page (and, on Reports, the report list —
  // see `moreContent` below). Each tab only if its sidebar entry is visible too, and none until
  // permissions resolve so the bar does not grow.
  const isVisible = (href: string) => navItems.some(item => item.href === href);
  const bottomTabs: ModuleNavTab[] = authLoading
    ? []
    : [
        { href: '/expenses', label: 'Home', icon: LayoutDashboard, match: path => matchesPath(path, '/expenses') },
        ...(isVisible('/expenses/all')
          ? [{ href: '/expenses/all', label: 'All', icon: Layers, ariaLabel: 'Consolidated register' }]
          : []),
        ...(canCreateAnywhere
          ? [{ href: '/expenses/new-request', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New expense request' }]
          : []),
        ...(isVisible('/expenses/reports') ? [{ href: '/expenses/reports', label: 'Reports', icon: BarChart3 }] : []),
      ];

  const isPrintPage = safePathname.includes('/print');
  if (isPrintPage) return <>{children}</>;

  const brand = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
        <IndianRupee className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold tracking-tight text-slate-800">Expenses</p>
        <p className="text-[11px] leading-tight text-muted-foreground">Requests &amp; Reporting</p>
      </div>
    </div>
  );

  /** A section's children, grouped — inline under it in labels mode, in a flyout in icons mode. */
  const childGroups = (item: NavItem, selectedChild: string | null | undefined, onNavigate?: () => void) =>
    CHILD_GROUP_ORDER.map(group => {
      const inGroup = item.children!.filter(child => child.group === group);
      if (!inGroup.length) return null;
      return (
        <div key={group} className="pt-1 first:pt-0">
          <p className="px-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {group}
          </p>
          {inGroup.map(child => {
            // The first entry is what the page falls back to when nothing is selected.
            const isSelected = selectedChild
              ? selectedChild === child.id
              : child.id === item.children![0].id;
            return (
              <Link
                key={child.id}
                href={`${item.href}?${item.childParam}=${child.id}`}
                onClick={onNavigate}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'block truncate rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  isSelected
                    ? 'bg-fuchsia-50 font-semibold text-fuchsia-700'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900',
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      );
    });

  /**
   * On a phone there is no sidebar to nest a section's children under, so while that section is
   * open the "More" pop-up leads with them, as chips. Each is a `SheetClose`: picking another
   * report only changes the query string, and the bar closes its pop-up by itself only when the
   * path changes.
   */
  const activeParent = authLoading
    ? undefined
    : navItems.find(item => !!item.children?.length && matchesPath(safePathname, item.href));
  const parentChildren = activeParent?.children ?? [];
  const parentSelected = activeParent?.childParam ? searchParams?.get(activeParent.childParam) : null;
  const moreContent = activeParent ? (
    <section aria-label={`${activeParent.label} list`}>
      <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {activeParent.label}
      </p>
      <div className="space-y-2.5 rounded-2xl border border-border/60 bg-muted/30 p-3">
        {CHILD_GROUP_ORDER.map(group => {
          const inGroup = parentChildren.filter(child => child.group === group);
          if (!inGroup.length) return null;
          return (
            <div key={group}>
              <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {inGroup.map(child => {
                  // Same rule as the sidebar: the first entry is what the page falls back to.
                  const isSelected = parentSelected
                    ? parentSelected === child.id
                    : child.id === parentChildren[0].id;
                  return (
                    <SheetClose key={child.id} asChild>
                      <Link
                        href={`${activeParent.href}?${activeParent.childParam}=${child.id}`}
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

  // `compact` is the desktop sidebar in icons mode.
  const navigationLinks = (compact: boolean) => {
    let lastGroup = '';
    return navItems.map(item => {
      const active = matchesPath(safePathname, item.href);
      const showDivider = item.group !== lastGroup && lastGroup !== '';
      lastGroup = item.group;
      const Icon = item.icon;

      // Children belong to the open section only. Opening another section folds them away with
      // no state to keep in sync — the active route is the single thing that decides.
      const expanded = active && !!item.children && !collapsedSections.includes(item.href);
      const selectedChild = item.childParam ? searchParams?.get(item.childParam) : null;

      return (
        <div key={item.href}>
          {showDivider && <div className="my-1 h-px bg-slate-200/70" />}
          <SidebarNavTooltip label={item.label} enabled={compact}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-expanded={item.children && !compact ? expanded : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-200 lg:py-2',
                active
                  ? cn('bg-gradient-to-r text-white', item.gradient, item.glow)
                  : 'text-slate-600 hover:bg-white hover:text-slate-900',
                compact && 'justify-center',
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                  active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg),
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'scale-110 text-white' : item.color)} />
              </span>
              <span className={compact ? 'sr-only' : 'min-w-0 flex-1'}>
                <span className="block truncate leading-tight">{item.label}</span>
                <span
                  className={cn(
                    'block truncate text-[11px] leading-tight',
                    active ? 'text-white/75' : 'text-muted-foreground',
                  )}
                >
                  {item.caption}
                </span>
              </span>
              {item.children && active && !compact && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
                  onClick={event => {
                    // Folding the list is not navigating to it.
                    event.preventDefault();
                    event.stopPropagation();
                    setCollapsedSections(previous =>
                      previous.includes(item.href)
                        ? previous.filter(href => href !== item.href)
                        : [...previous, item.href],
                    );
                  }}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    setCollapsedSections(previous =>
                      previous.includes(item.href)
                        ? previous.filter(href => href !== item.href)
                        : [...previous, item.href],
                    );
                  }}
                  className="shrink-0 rounded p-0.5 hover:bg-white/20"
                >
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !expanded && '-rotate-90')} />
                </span>
              )}
            </Link>
          </SidebarNavTooltip>

          {expanded && !compact && (
            <div className="mt-1 max-h-[46vh] space-y-0.5 overflow-y-auto border-l-2 border-slate-200 pl-2 lg:ml-3">
              {childGroups(item, selectedChild)}
            </div>
          )}

          {/* Icons mode: the list has no room under the chip, so a small trigger opens it beside the rail. */}
          {compact && item.children && active && (
            <Popover open={childFlyoutOpen} onOpenChange={setChildFlyoutOpen}>
              <SidebarNavTooltip label={`${item.label} list`} enabled>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Open the ${item.label} list`}
                    className="mx-auto mt-1 flex h-7 w-9 items-center justify-center rounded-md bg-fuchsia-50 text-fuchsia-700 transition-colors hover:bg-fuchsia-100"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
              </SidebarNavTooltip>
              <PopoverContent side="right" align="start" className="w-64 p-2">
                <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
                  {childGroups(item, selectedChild, () => setChildFlyoutOpen(false))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      );
    });
  };

  return (
    <div className="relative w-full px-3 py-4 sm:px-5 lg:px-6">
      {/* Tinted backdrop. Sits behind everything and catches no clicks. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/70 via-white to-violet-50/50" />
        <div className="absolute left-[6%] top-[6%] h-56 w-56 rounded-full bg-blue-300/20 blur-3xl" />
        <div className="absolute bottom-[8%] right-[8%] h-64 w-64 rounded-full bg-violet-300/20 blur-3xl" />
      </div>

      {/* `lg:hidden` is a min-width query, so this bar would otherwise print on a wide sheet. */}
      <div className="mb-3 lg:hidden print:hidden">
        <Card className="border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
          <CardContent className="flex items-center gap-3 px-3 py-2.5">
            {brand}
          </CardContent>
        </Card>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[232px_minmax(0,1fr)]'} lg:items-start`}>
        <TooltipProvider delayDuration={150}>
          <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block print:hidden">
            <Card className="overflow-hidden border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
              <div className={cn('border-b border-white/50 bg-gradient-to-r from-blue-500/10 to-violet-500/5 px-4 py-3', iconsOnly && 'px-2')}>
                {iconsOnly ? (
                  <div className="flex justify-center" title="Expenses">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
                      <IndianRupee className="h-4 w-4 text-white" />
                    </div>
                    <span className="sr-only">Expenses — Requests &amp; Reporting</span>
                  </div>
                ) : (
                  brand
                )}
              </div>
              <CardContent className="max-h-[calc(100vh-var(--app-header-offset,4rem)-9rem)] space-y-0.5 overflow-y-auto p-2">
                {navigationLinks(iconsOnly)}
              </CardContent>
            </Card>
          </aside>
        </TooltipProvider>

        {/* min-w-0: a grid item defaults to min-width:auto, so without it the consolidated
            register's ~2000px table would widen the column and push the page sideways. */}
        <main className="min-w-0">
          {children}
          <footer className="mt-6 flex items-center border-t border-slate-200/70 px-1 py-3 text-xs text-muted-foreground print:hidden">
            <span>Copyright © 2025 SEL. All Rights Reserved.</span>
          </footer>
        </main>
      </div>

      <ModuleBottomNav
        tabs={bottomTabs}
        pages={authLoading ? undefined : navItems}
        groupLabels={GROUP_LABELS}
        moreContent={moreContent}
        moduleName="Expenses"
      />
    </div>
  );
}
