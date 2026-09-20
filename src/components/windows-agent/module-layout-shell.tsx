'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  BarChart3,
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
}

const SECTIONS: Section[] = [
  {
    href: WINDOWS_AGENT_ROUTES.myActivity,
    label: 'My activity',
    description: 'Your own hours, applications and sign-ins.',
    icon: UserRound,
    group: 'mine',
    gate: 'self',
  },
  {
    href: WINDOWS_AGENT_ROUTES.monitoringPolicy,
    label: 'What is recorded',
    description: 'Exactly what the agent collects, and what it never does.',
    icon: ShieldCheck,
    group: 'mine',
    gate: 'always',
  },

  {
    href: WINDOWS_AGENT_ROUTES.dashboard,
    label: 'Dashboard',
    description: 'Today across the fleet.',
    icon: Gauge,
    group: 'monitor',
    gate: 'dashboard',
    exact: true,
  },
  {
    href: WINDOWS_AGENT_ROUTES.live,
    label: 'Live users',
    description: 'Who is at their desk right now.',
    icon: Activity,
    group: 'monitor',
    gate: 'live',
  },
  {
    href: WINDOWS_AGENT_ROUTES.users,
    label: 'Employee activity',
    description: 'One person’s day, hour by hour.',
    icon: Users,
    group: 'monitor',
    gate: 'sessions',
  },
  {
    href: WINDOWS_AGENT_ROUTES.devices,
    label: 'Devices',
    description: 'Enrolled computers and their agents.',
    icon: HardDrive,
    group: 'monitor',
    gate: 'devices',
  },
  {
    href: WINDOWS_AGENT_ROUTES.sessions,
    label: 'Sessions',
    description: 'Every sign-in and sign-out.',
    icon: CalendarClock,
    group: 'monitor',
    gate: 'sessions',
  },

  {
    href: WINDOWS_AGENT_ROUTES.attendance,
    label: 'Attendance',
    description: 'First login, last logout, hours by day.',
    icon: CalendarClock,
    group: 'reports',
    gate: 'attendance',
  },
  {
    href: WINDOWS_AGENT_ROUTES.applications,
    label: 'Applications',
    description: 'Where the time went, by program.',
    icon: MonitorSmartphone,
    group: 'reports',
    gate: 'applications',
  },
  {
    href: WINDOWS_AGENT_ROUTES.reports,
    label: 'Reports',
    description: 'Departments, applications and attendance.',
    icon: BarChart3,
    group: 'reports',
    gate: 'reports',
    exact: true,
  },

  {
    href: WINDOWS_AGENT_ROUTES.notifications,
    label: 'Notifications',
    description: 'Send desktop alerts and see what was delivered.',
    icon: BellRing,
    group: 'config',
    gate: 'notifications',
  },
  {
    href: WINDOWS_AGENT_ROUTES.policies,
    label: 'Policies',
    description: 'Thresholds, tracking and working hours.',
    icon: SlidersHorizontal,
    group: 'config',
    gate: 'policies',
  },
  {
    href: WINDOWS_AGENT_ROUTES.versions,
    label: 'Agent versions',
    description: 'Published builds and rollout rings.',
    icon: Package,
    group: 'config',
    gate: 'versions',
  },
  {
    href: WINDOWS_AGENT_ROUTES.audit,
    label: 'Audit log',
    description: 'Every administrative action, append-only.',
    icon: ScrollText,
    group: 'config',
    gate: 'audit',
  },
];

const GROUP_LABELS: Record<Section['group'], string> = {
  mine: 'You',
  monitor: 'Monitoring',
  reports: 'Reports',
  config: 'Administration',
};

const GROUP_ORDER: Section['group'][] = ['mine', 'monitor', 'reports', 'config'];

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

  const nav = (
    <nav className="space-y-6">
      {GROUP_ORDER.map((group) => {
        const items = visible.filter((section) => section.group === group);
        if (!items.length) return null;
        return (
          <div key={group}>
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {GROUP_LABELS[group]}
            </p>
            <div className="space-y-0.5">
              {items.map((section) => {
                const active = section.exact
                  ? pathname === section.href
                  : pathname.startsWith(section.href);
                const Icon = section.icon;
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    prefetch={false}
                    onClick={() => setSheetOpen(false)}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate">{section.label}</span>
                      <span className="block truncate text-xs text-muted-foreground/80">
                        {section.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="mx-auto w-full max-w-[100rem] p-3 sm:p-6">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div>
          <h1 className="text-lg font-semibold">Windows Agent</h1>
          <p className="text-xs text-muted-foreground">Attendance, activity and desktop alerts</p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open the Windows Agent menu">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 overflow-y-auto">
            <SheetHeader className="text-left">
              <SheetTitle>Windows Agent</SheetTitle>
              <SheetDescription>Attendance, activity and desktop alerts</SheetDescription>
            </SheetHeader>
            <div className="mt-6">{nav}</div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="mt-3 flex gap-6 lg:mt-0">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-4">
            <div className="mb-5 flex items-center gap-2 px-3">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold leading-tight">Windows Agent</p>
                <p className="text-xs text-muted-foreground">Attendance &amp; activity</p>
              </div>
            </div>
            {nav}
          </div>
        </aside>

        {/* min-w-0 is load-bearing: without it a wide table inside a flex child refuses to shrink
            and pushes the whole page horizontally instead of scrolling within its own container. */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
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
