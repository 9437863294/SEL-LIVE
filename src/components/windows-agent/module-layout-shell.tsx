'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  BellRing,
  CalendarClock,
  Gauge,
  HardDrive,
  KeyRound,
  Menu,
  MonitorSmartphone,
  Package,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { WINDOWS_AGENT_ROUTES } from '@/lib/windows-agent';
import {
  WINDOWS_AGENT_RESOURCES,
  canManagePolicies,
  canManageVersions,
  canOpenWindowsAgent,
  canSendNotifications,
  canViewAttendance,
  canViewAudit,
  canViewDevices,
  canViewLiveBoard,
  canViewOwnActivity,
  canViewPolicies,
  resolveActivityScope,
} from '@/lib/windows-agent-permissions';
import { hasPermission } from '@/lib/access-control';
import { WindowsAgentProvider, useWindowsAgent } from './hooks';

/**
 * The module's chrome (§33's menu), modelled on Office Hub's so the two feel the same.
 *
 * ── Two things about the navigation that are not styling decisions ─────────────────────────────
 *
 * **Every section is gated, and the gating is the same function the page uses.** A link to a page
 * somebody cannot open is worse than no link: they click it, get refused, and raise a ticket. The
 * gates below call into `windows-agent-permissions.ts`, which is also what each page checks, so a
 * visible link and an openable page cannot drift apart.
 *
 * **"My activity" is always there.** §37 gives an employee their own record and §52 asks the
 * system to be transparent to the people it measures. Someone with no administrative permission
 * at all still reaches this module through that one link — which is the point, and why it sits in
 * its own group at the top rather than at the bottom of a list of things they cannot open.
 */

type Gate =
  | 'always'
  | 'self'
  | 'dashboard'
  | 'live'
  | 'devices'
  | 'sessions'
  | 'attendance'
  | 'applications'
  | 'reports'
  | 'notifications'
  | 'policies'
  | 'versions'
  | 'audit';

interface Section {
  href: string;
  label: string;
  description: string;
  icon: typeof Gauge;
  group: 'mine' | 'monitor' | 'reports' | 'config';
  gate: Gate;
  exact?: boolean;

  /**
   * The icon tile's colours, and the active row's gradient.
   *
   * Per item rather than per group, matching the Insurance module this now looks like. Colour
   * is doing real work in a fourteen-item list: it is what lets somebody who uses "Devices"
   * every morning find it by shape rather than by reading four headings.
   */
  tile: string;
  tint: string;
  active: string;
}

const SECTIONS: Section[] = [
  {
    href: WINDOWS_AGENT_ROUTES.myActivity,
    label: 'My activity',
    description: 'Your own hours, applications and sign-ins.',
    icon: UserRound,
    group: 'mine',
    gate: 'self',
    tile: 'bg-violet-100',
    tint: 'text-violet-600',
    active: 'from-violet-500 to-purple-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.monitoringPolicy,
    label: 'What is recorded',
    description: 'Exactly what the agent collects, and what it never does.',
    icon: ShieldCheck,
    group: 'mine',
    gate: 'always',
    tile: 'bg-emerald-100',
    tint: 'text-emerald-600',
    active: 'from-emerald-500 to-teal-600',
  },

  {
    href: WINDOWS_AGENT_ROUTES.dashboard,
    label: 'Dashboard',
    description: 'Today across the fleet.',
    icon: Gauge,
    group: 'monitor',
    gate: 'dashboard',
    tile: 'bg-blue-100',
    tint: 'text-blue-600',
    active: 'from-blue-500 to-indigo-600',
    exact: true,
  },
  {
    href: WINDOWS_AGENT_ROUTES.live,
    label: 'Live users',
    description: 'Who is at their desk right now.',
    icon: Activity,
    group: 'monitor',
    gate: 'live',
    tile: 'bg-cyan-100',
    tint: 'text-cyan-600',
    active: 'from-cyan-500 to-sky-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.users,
    label: 'Employee activity',
    description: 'One person’s day, hour by hour.',
    icon: Users,
    group: 'monitor',
    gate: 'sessions',
    tile: 'bg-indigo-100',
    tint: 'text-indigo-600',
    active: 'from-indigo-500 to-blue-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.devices,
    label: 'Devices',
    description: 'Enrolled computers and their agents.',
    icon: HardDrive,
    group: 'monitor',
    gate: 'devices',
    tile: 'bg-teal-100',
    tint: 'text-teal-600',
    active: 'from-teal-500 to-cyan-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.access,
    label: 'Computer access',
    description: 'Which computers each person may sign in on.',
    icon: KeyRound,
    group: 'monitor',
    gate: 'devices',
    tile: 'bg-amber-100',
    tint: 'text-amber-600',
    active: 'from-amber-500 to-orange-500',
  },
  {
    href: WINDOWS_AGENT_ROUTES.sessions,
    label: 'Sessions',
    description: 'Every sign-in and sign-out.',
    icon: CalendarClock,
    group: 'monitor',
    gate: 'sessions',
    tile: 'bg-sky-100',
    tint: 'text-sky-600',
    active: 'from-sky-500 to-blue-600',
  },

  {
    href: WINDOWS_AGENT_ROUTES.attendance,
    label: 'Attendance',
    description: 'First login, last logout, hours by day.',
    icon: CalendarClock,
    group: 'reports',
    gate: 'attendance',
    tile: 'bg-orange-100',
    tint: 'text-orange-600',
    active: 'from-orange-500 to-amber-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.applications,
    label: 'Applications',
    description: 'Where the time went, by program.',
    icon: MonitorSmartphone,
    group: 'reports',
    gate: 'applications',
    tile: 'bg-fuchsia-100',
    tint: 'text-fuchsia-600',
    active: 'from-fuchsia-500 to-pink-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.reports,
    label: 'Reports',
    description: 'Departments, applications and attendance.',
    icon: BarChart3,
    group: 'reports',
    gate: 'reports',
    tile: 'bg-rose-100',
    tint: 'text-rose-600',
    active: 'from-rose-500 to-red-600',
    exact: true,
  },

  {
    href: WINDOWS_AGENT_ROUTES.notifications,
    label: 'Notifications',
    description: 'Send desktop alerts and see what was delivered.',
    icon: BellRing,
    group: 'config',
    gate: 'notifications',
    tile: 'bg-yellow-100',
    tint: 'text-yellow-700',
    active: 'from-yellow-500 to-amber-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.policies,
    label: 'Policies',
    description: 'Thresholds, tracking and working hours.',
    icon: SlidersHorizontal,
    group: 'config',
    gate: 'policies',
    tile: 'bg-slate-100',
    tint: 'text-slate-600',
    active: 'from-slate-500 to-slate-700',
  },
  {
    href: WINDOWS_AGENT_ROUTES.versions,
    label: 'Agent versions',
    description: 'Published builds and rollout rings.',
    icon: Package,
    group: 'config',
    gate: 'versions',
    tile: 'bg-lime-100',
    tint: 'text-lime-700',
    active: 'from-lime-500 to-green-600',
  },
  {
    href: WINDOWS_AGENT_ROUTES.audit,
    label: 'Audit log',
    description: 'Every administrative action, append-only.',
    icon: ScrollText,
    group: 'config',
    gate: 'audit',
    tile: 'bg-stone-100',
    tint: 'text-stone-600',
    active: 'from-stone-500 to-stone-700',
  },
];

const GROUP_LABELS: Record<Section['group'], string> = {
  mine: 'You',
  monitor: 'Monitoring',
  reports: 'Reports',
  config: 'Administration',
};

const GROUP_ORDER: Section['group'][] = ['mine', 'monitor', 'reports', 'config'];

/** Where the collapsed/expanded preference is kept. Per browser, not per user. */
const NAV_COLLAPSED_KEY = 'sel.windowsAgent.navCollapsed';

export default function WindowsAgentLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <WindowsAgentProvider>
      <ShellBody>{children}</ShellBody>
    </WindowsAgentProvider>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const { viewer, loading, canOpenModule } = useWindowsAgent();
  const pathname = usePathname() || '';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  /**
   * Remember whether the sidebar was collapsed.
   *
   * Read in an effect rather than in `useState`'s initialiser: the server renders this too, and
   * reading `localStorage` during the first render makes the client's markup differ from the
   * server's, which React reports as a hydration error. Starting expanded and correcting on
   * mount costs one frame and is the supported way round it.
   */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
    } catch {
      // Private browsing, or storage disabled by policy. Expanded is a fine default.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // As above — not remembering the preference is not worth an error.
    }
  }, [collapsed]);

  // AppShell already strips the application header for a print route; this is a nested layout, so
  // without this the printed report would carry the module's sidebar too. `print:hidden` alone is
  // not enough — print lays out at ~816px, which is below `lg`, so the mobile bar would un-hide
  // itself in the printout.
  if (pathname.includes('/print')) return <>{children}</>;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }

  if (!canOpenModule) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Windows Agent</CardTitle>
            <CardDescription>
              You do not have access to this module. It needs at least one Windows Agent
              permission — ask an administrator to grant one in Role Management.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const visible = SECTIONS.filter((section) => isVisible(section.gate, viewer));

  /**
   * One row. A tile, a label when there is room, and a tooltip that always has something to say.
   *
   * The description used to sit under every label and be truncated to "Your own hours,
   * applications and sign-i…", fourteen times down the page. It is the same sentence either
   * way; as a tooltip it is readable and the list is legible.
   */
  function NavRow({ section, expanded }: { section: Section; expanded: boolean }) {
    const active = section.exact
      ? pathname === section.href
      : pathname.startsWith(section.href);
    const Icon = section.icon;

    return (
      <Tooltip key={section.href}>
        <TooltipTrigger asChild>
          <Link
            href={section.href}
            prefetch={false}
            onClick={() => setSheetOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group relative flex items-center rounded-lg transition-all duration-200',
              expanded ? 'gap-2.5 px-2 py-1.5' : 'justify-center p-1.5',
              active
                ? cn('bg-gradient-to-r text-white shadow-sm', section.active)
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                active ? 'bg-white/25' : cn(section.tile, 'group-hover:scale-105'),
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-white' : section.tint)} aria-hidden />
            </span>
            {expanded ? (
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{section.label}</span>
            ) : null}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs">
          {/* Collapsed, the label is the only thing missing; expanded, the description is. */}
          {expanded ? null : <p className="text-xs font-semibold">{section.label}</p>}
          <p className="text-xs text-muted-foreground">{section.description}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  function renderNav(expanded: boolean) {
    return (
      <nav className={cn('space-y-1', expanded ? 'px-2' : 'px-1.5')}>
        {GROUP_ORDER.map((group, index) => {
          const items = visible.filter((section) => section.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className={index === 0 ? undefined : 'pt-3'}>
              {expanded ? (
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {GROUP_LABELS[group]}
                </p>
              ) : (
                // Collapsed there is no room for a heading, but the grouping still carries
                // meaning — a hairline keeps it rather than running fourteen icons together.
                index === 0 ? null : <div className="mx-auto mb-2 h-px w-6 bg-border" aria-hidden />
              )}
              <div className="space-y-0.5">
                {items.map((section) => (
                  <NavRow key={section.href} section={section} expanded={expanded} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* ── Below lg: a title bar and a drawer ────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          </span>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Windows Agent</h1>
            <p className="text-xs text-muted-foreground">Attendance &amp; activity</p>
          </div>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open the Windows Agent menu">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 overflow-y-auto p-0">
            <SheetHeader className="border-b px-4 py-3 text-left">
              <SheetTitle className="text-sm">Windows Agent</SheetTitle>
              <SheetDescription className="text-xs">
                Attendance, activity and desktop alerts
              </SheetDescription>
            </SheetHeader>
            {/* Always expanded in the drawer: it slid out because somebody wants to read it. */}
            <div className="py-3">{renderNav(true)}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* ── lg and up: a sidebar that collapses to a rail ─────────────────────────────── */}
      <aside
        className={cn(
          'fixed left-0 top-16 z-30 hidden h-[calc(100vh-4rem)] flex-col border-r',
          'bg-background/95 shadow-sm backdrop-blur-sm transition-[width] duration-300 lg:flex',
          collapsed ? 'w-[4.25rem]' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 border-b px-3 py-3',
            collapsed && 'justify-center',
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-4 w-4 text-primary" aria-hidden />
          </span>
          {collapsed ? null : (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">Windows Agent</p>
              <p className="truncate text-xs text-muted-foreground">Attendance &amp; activity</p>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-3">{renderNav(!collapsed)}</div>

        <div className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground',
              'transition-colors hover:bg-muted/60 hover:text-foreground',
              collapsed && 'justify-center',
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* min-w-0 is load-bearing: without it a wide table refuses to shrink and pushes the
          whole page sideways instead of scrolling inside its own container. */}
      <div
        className={cn(
          'min-w-0 transition-[padding] duration-300',
          collapsed ? 'lg:pl-[4.25rem]' : 'lg:pl-64',
        )}
      >
        <main className="min-w-0 p-3 sm:p-6">{children}</main>
      </div>
    </TooltipProvider>
  );
}

function isVisible(gate: Gate, viewer: Parameters<typeof canOpenWindowsAgent>[0]): boolean {
  switch (gate) {
    case 'always':
      return true;
    case 'self':
      return canViewOwnActivity(viewer);
    case 'dashboard':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.dashboard, 'View');
    case 'live':
      return canViewLiveBoard(viewer);
    case 'devices':
      return canViewDevices(viewer);
    case 'sessions':
      // The register of other people's sessions, so it follows the activity scope rather than a
      // page permission: somebody who may only see themselves has "My activity" instead.
      return resolveActivityScope(viewer).kind !== 'SELF' && resolveActivityScope(viewer).kind !== 'NONE';
    case 'attendance':
      return canViewAttendance(viewer);
    case 'applications':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.applications, 'View');
    case 'reports':
      return hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.reports, 'View');
    case 'notifications':
      return (
        canSendNotifications(viewer) ||
        hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.notifications, 'View')
      );
    case 'policies':
      return canViewPolicies(viewer) || canManagePolicies(viewer);
    case 'versions':
      return (
        canManageVersions(viewer) ||
        hasPermission(viewer.permissions, WINDOWS_AGENT_RESOURCES.versions, 'View')
      );
    case 'audit':
      return canViewAudit(viewer);
    default:
      return false;
  }
}
