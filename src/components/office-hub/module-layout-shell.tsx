'use client';

/**
 * The module's chrome: sidebar on a desktop, a slide-out sheet on a phone (§53, §54).
 *
 * Modelled on `@/components/e-approval/module-layout-shell` so that a user who knows their way
 * around one module knows their way around this one — the nav grouping, the active-link treatment
 * and the mobile sheet all behave identically. What differs is the section list and its gating.
 *
 * Two behaviours worth knowing:
 *
 *   • **A print route gets the page to itself.** `AppShell` already strips the app header for
 *     `/print`, but this is a *nested* layout, so it would otherwise wrap the printed minutes in the
 *     module's own sidebar. Hiding the pieces with `print:hidden` is not enough either: the mobile
 *     bar is `lg:hidden`, and print lays out at paper width (~816px), which is *below* `lg` — so the
 *     bar nobody sees on screen un-hides itself in the printout.
 *
 *   • **The nav is gated, and the guide never is.** A user who cannot find anything is exactly the
 *     user who needs the guide, so it renders for everyone with access to the module.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  FileText,
  Gauge,
  Gavel,
  LayoutTemplate,
  ListTodo,
  Menu,
  Search,
  Settings,
  ShieldAlert,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { OFFICE_HUB_BASE_PATH } from '@/lib/office-hub';
import { OfficeHubProvider, useOfficeHub } from './hooks';
import { OfficeHubErrorBoundary } from './error-boundary';
import { OfficeHubCommandPalette } from './global-search';

type Gate =
  | 'always'
  | 'dashboard'
  | 'calendar'
  | 'meetings'
  | 'tasks'
  | 'teams'
  | 'decisions'
  | 'actionItems'
  | 'employees'
  | 'reports'
  | 'workload'
  | 'overview'
  | 'templates'
  | 'settings'
  | 'import';

const SECTIONS: {
  href: string;
  label: string;
  icon: typeof Gauge;
  color: string;
  bg: string;
  group: 'work' | 'registers' | 'insight' | 'config';
  gate: Gate;
  /** Matched with `startsWith` for detail routes; the dashboard is exact-match only. */
  exact?: boolean;
}[] = [
  { href: OFFICE_HUB_BASE_PATH, label: 'Dashboard', icon: Gauge, color: 'text-sky-600', bg: 'bg-sky-100', group: 'work', gate: 'dashboard', exact: true },
  { href: `${OFFICE_HUB_BASE_PATH}/calendar`, label: 'Calendar', icon: CalendarDays, color: 'text-indigo-600', bg: 'bg-indigo-100', group: 'work', gate: 'calendar' },
  { href: `${OFFICE_HUB_BASE_PATH}/meetings`, label: 'Meetings', icon: ClipboardList, color: 'text-violet-600', bg: 'bg-violet-100', group: 'work', gate: 'meetings' },
  { href: `${OFFICE_HUB_BASE_PATH}/tasks`, label: 'Tasks', icon: ListTodo, color: 'text-emerald-600', bg: 'bg-emerald-100', group: 'work', gate: 'tasks' },

  { href: `${OFFICE_HUB_BASE_PATH}/decisions`, label: 'Decision Register', icon: Gavel, color: 'text-amber-600', bg: 'bg-amber-100', group: 'registers', gate: 'decisions' },
  { href: `${OFFICE_HUB_BASE_PATH}/action-items`, label: 'Action Items', icon: CheckSquare, color: 'text-teal-600', bg: 'bg-teal-100', group: 'registers', gate: 'actionItems' },
  { href: `${OFFICE_HUB_BASE_PATH}/teams`, label: 'Teams', icon: Users, color: 'text-fuchsia-600', bg: 'bg-fuchsia-100', group: 'registers', gate: 'teams' },
  { href: `${OFFICE_HUB_BASE_PATH}/employees`, label: 'Employees', icon: UserRound, color: 'text-cyan-600', bg: 'bg-cyan-100', group: 'registers', gate: 'employees' },

  { href: `${OFFICE_HUB_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, color: 'text-blue-600', bg: 'bg-blue-100', group: 'insight', gate: 'reports' },
  { href: `${OFFICE_HUB_BASE_PATH}/workload`, label: 'Workload', icon: FileText, color: 'text-orange-600', bg: 'bg-orange-100', group: 'insight', gate: 'workload' },
  { href: `${OFFICE_HUB_BASE_PATH}/overview`, label: 'Management Overview', icon: Gauge, color: 'text-rose-600', bg: 'bg-rose-100', group: 'insight', gate: 'overview' },
  { href: `${OFFICE_HUB_BASE_PATH}/search`, label: 'Search', icon: Search, color: 'text-slate-600', bg: 'bg-slate-200', group: 'insight', gate: 'always' },

  { href: `${OFFICE_HUB_BASE_PATH}/templates`, label: 'Templates', icon: LayoutTemplate, color: 'text-indigo-600', bg: 'bg-indigo-100', group: 'config', gate: 'templates' },
  { href: `${OFFICE_HUB_BASE_PATH}/import`, label: 'Import Employees', icon: Upload, color: 'text-emerald-600', bg: 'bg-emerald-100', group: 'config', gate: 'import' },
  { href: `${OFFICE_HUB_BASE_PATH}/settings`, label: 'Settings', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-200', group: 'config', gate: 'settings' },
  { href: `${OFFICE_HUB_BASE_PATH}/help`, label: 'Guide', icon: BookOpen, color: 'text-amber-600', bg: 'bg-amber-100', group: 'config', gate: 'always' },
];

const GROUP_LABELS: Record<string, string> = {
  work: 'My Work',
  registers: 'Registers',
  insight: 'Insight',
  config: 'Configuration',
};

export default function OfficeHubLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <OfficeHubProvider>
      <OfficeHubLayoutShellInner>{children}</OfficeHubLayoutShellInner>
    </OfficeHubProvider>
  );
}

function OfficeHubLayoutShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const { capabilities, isLoading } = useOfficeHub();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Before the access check, so a print route never renders module chrome at all.
  if (pathname.includes('/print')) return <>{children}</>;

  const gates: Record<Gate, boolean> = {
    always: true,
    dashboard: capabilities.canViewDashboard,
    calendar: capabilities.canViewCalendar,
    meetings: capabilities.canViewMeetings,
    tasks: capabilities.canViewTasks,
    teams: capabilities.canViewTeams,
    decisions: capabilities.canViewDecisions,
    actionItems: capabilities.canViewActionItems,
    employees: capabilities.canViewEmployees,
    reports: capabilities.canViewReports,
    workload: capabilities.canViewWorkload,
    overview: capabilities.canViewManagementOverview,
    templates: capabilities.canViewTemplates,
    settings: capabilities.canViewSettings,
    import: capabilities.canImportEmployees,
  };

  const available = SECTIONS.filter((section) => gates[section.gate]);

  // Longest match first, so `/office-hub/meetings` does not also light up the dashboard link.
  const current = [...available]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) =>
      section.exact ? pathname === section.href : pathname === section.href || pathname.startsWith(`${section.href}/`),
    );

  const navigation = (onNavigate?: () => void) => {
    let lastGroup = '';
    return available.map((section) => {
      const active = current?.href === section.href;
      const Icon = section.icon;
      const showGroup = section.group !== lastGroup;
      lastGroup = section.group;
      return (
        <div key={section.href}>
          {showGroup && (
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 first:pt-1">
              {GROUP_LABELS[section.group]}
            </p>
          )}
          <Link
            href={section.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-200 lg:py-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
              active
                ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-[0_8px_24px_-8px_rgba(79,70,229,0.5)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-all duration-200',
                active ? 'bg-white/20 ring-white/30' : cn('ring-black/[0.03] group-hover:scale-105', section.bg),
              )}
            >
              <Icon className={cn('h-4 w-4 transition-transform', active ? 'scale-110 text-white' : section.color)} />
            </span>
            <span className="truncate">{section.label}</span>
          </Link>
        </div>
      );
    });
  };

  if (isLoading) {
    return (
      <div className="w-full px-3 py-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <Skeleton className="hidden h-[28rem] w-full rounded-xl lg:block" />
          <div className="space-y-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!capabilities.canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Office Hub.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2 py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
            <p className="text-sm text-muted-foreground">Contact your administrator to request access.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative w-full px-3 py-2 sm:px-6 sm:py-4 lg:px-8 xl:px-12 2xl:px-20">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50/60 via-white to-indigo-50/60" />

      <div className="mb-2 sm:mb-3 lg:hidden">
        <Card>
          <CardContent className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10 shrink-0 gap-2 bg-white/90 px-3 text-sm font-medium">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-[88vw] max-w-[300px] flex-col border-r border-white/70 bg-slate-50 p-0"
              >
                <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow">
                      <CalendarDays className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">Office Hub</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{navigation(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
                <CalendarDays className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight tracking-tight">Office Hub</p>
                <p className="truncate text-[11px] leading-tight text-muted-foreground">
                  {current?.label || 'Meetings & Tasks'}
                </p>
              </div>
            </div>
            <div className="ml-auto shrink-0">
              <OfficeHubCommandPalette />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden">
            <div className="border-b border-white/50 bg-gradient-to-r from-sky-500/10 to-indigo-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
                  <CalendarDays className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Office Hub</p>
                  <p className="text-[11px] text-muted-foreground">Meet · Decide · Assign</p>
                </div>
              </div>
            </div>
            <div className="border-b border-white/50 px-2 py-2">
              <OfficeHubCommandPalette />
            </div>
            <CardContent className="max-h-[calc(100vh-14rem)] overflow-y-auto p-2">
              <nav aria-label="Office Hub sections">{navigation()}</nav>
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 w-full overflow-x-hidden">
          {/*
            One boundary per module rather than per page: a render failure inside a register should
            leave the nav usable so the user can go somewhere else, which a boundary at the page
            level cannot do (§2's error-boundary requirement).
          */}
          <OfficeHubErrorBoundary>{children}</OfficeHubErrorBoundary>
        </main>
      </div>
    </div>
  );
}
