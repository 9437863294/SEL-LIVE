'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CarFront,
  ClipboardCheck,
  Fuel,
  Gauge,
  ListFilter,
  LocateFixed,
  Menu,
  ReceiptText,
  Route,
  ShieldAlert,
  Truck,
  User,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ─── Per-section color config ────────────────────────────────────────────────

const sections = [
  { href: '/driver-management',               label: 'Overview',         resource: '',                 icon: Gauge,       color: 'text-cyan-600',   bg: 'bg-cyan-50',    group: 'core' },
  { href: '/driver-management/mobile-hub',    label: 'Driver Mobile',    resource: 'Driver Mobile Hub', icon: User,       color: 'text-violet-600', bg: 'bg-violet-50',  group: 'driver' },
  { href: '/driver-management/vehicle-details', label: 'Vehicle Details', resource: 'Assigned Vehicle Details', icon: CarFront, color: 'text-blue-600', bg: 'bg-blue-50', group: 'driver' },
  { href: '/driver-management/fuel',          label: 'Driver Fuel',      resource: 'Driver Fuel',      icon: Fuel,        color: 'text-amber-600',  bg: 'bg-amber-50',   group: 'driver' },
  { href: '/driver-management/daily-status',  label: 'Daily Status',     resource: 'Driver Daily Status', icon: Gauge,    color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'driver' },
  { href: '/driver-management/trips',         label: 'Driver Trips',     resource: 'Driver Trips',     icon: LocateFixed, color: 'text-sky-600',    bg: 'bg-sky-50',     group: 'trips' },
  { href: '/driver-management/trip-log',      label: 'Trip Log',         resource: 'Driver Trips',     icon: ListFilter,  color: 'text-indigo-600', bg: 'bg-indigo-50',  group: 'trips' },
  { href: '/driver-management/employee-trips', label: 'Employee Trips',  resource: 'Employee Trip Log', icon: ReceiptText, color: 'text-teal-600',  bg: 'bg-teal-50',    group: 'trips' },
  { href: '/driver-management/trip-management', label: 'Trip Management', resource: 'Trip Management', icon: LocateFixed, color: 'text-blue-600',   bg: 'bg-blue-50',    group: 'trips' },
];

const legacyResourceMap: Record<string, string[]> = {
  'Driver Mobile Hub':      ['Vehicle Management.Driver Mobile'],
  'Assigned Vehicle Details': ['Vehicle Management.Driver Mobile'],
  'Driver Fuel':            ['Vehicle Management.Driver Mobile Fuel'],
  'Driver Daily Status':    ['Vehicle Management.Driver Daily Status'],
  'Driver Trips':           ['Vehicle Management.Driver Mobile Trip'],
  'Employee Trip Log':      ['Vehicle Management.Employee Trip Reimbursement'],
  'Trip Management':        ['Vehicle Management.Trip Management'],
};

const driverSelfResources = new Set([
  'Driver Mobile Hub', 'Assigned Vehicle Details', 'Driver Fuel',
  'Driver Daily Status', 'Driver Trips', 'Employee Trip Log',
]);

// The phone's bottom bar, in priority order: the first four the user can open become the tabs,
// and "More" opens the full menu. A driver gets their day — trips, the daily status, fuel; a
// transport coordinator without the driver screens falls through to the management pages.
// This module is the driver app (AppShell drops the app header for it in the Android WebView),
// and none of its pages has a bottom bar of its own, so this is the only one on screen.
const bottomTabPriority: ModuleNavTab[] = [
  { href: '/driver-management',                 label: 'Home',     icon: Gauge, exact: true, ariaLabel: 'Overview' },
  { href: '/driver-management/trips',           label: 'Trips',    icon: LocateFixed, ariaLabel: 'Driver trips' },
  { href: '/driver-management/daily-status',    label: 'Status',   icon: ClipboardCheck, ariaLabel: 'Daily status' },
  { href: '/driver-management/fuel',            label: 'Fuel',     icon: Fuel, ariaLabel: 'Driver fuel' },
  { href: '/driver-management/trip-management', label: 'Manage',   icon: Route, ariaLabel: 'Trip management' },
  { href: '/driver-management/employee-trips',  label: 'Claims',   icon: ReceiptText, ariaLabel: 'Employee trip reimbursement' },
  { href: '/driver-management/trip-log',        label: 'Trip log', icon: ListFilter },
];

export default function DriverManagementLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const iconsOnly = useSidebarIconsOnly();

  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canViewModule =
    can('View Module', 'Driver Management') ||
    can('View', 'Driver Management.Driver Mobile Hub') ||
    can('View', 'Driver Management.Employee Trip Log') ||
    can('Add', 'Driver Management.Employee Trip Log') ||
    can('Edit', 'Driver Management.Employee Trip Log') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Add', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Edit', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;

  const canViewSection = (resource: string) => {
    if (!resource) return canViewModule;
    if (can('View', `Driver Management.${resource}`)) return true;
    if (can('Add', `Driver Management.${resource}`)) return true;
    if (can('Edit', `Driver Management.${resource}`)) return true;
    const legacy = legacyResourceMap[resource] || [];
    if (legacy.some((entry) => can('View', entry) || can('Add', entry) || can('Edit', entry))) return true;
    if (isAssignedDriver && driverSelfResources.has(resource)) return true;
    return false;
  };

  const availableSections = sections.filter((item) => canViewSection(item.resource));
  const bottomTabs = bottomTabPriority
    .filter((tab) => availableSections.some((item) => item.href === tab.href))
    .slice(0, 4);

  // `compact` is the desktop sidebar in icons mode; the phone sheet always passes labels.
  const navigationLinks = (onNavigate?: () => void, compact = false) => {
    let lastGroup = '';
    return availableSections.map((item) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/driver-management' && safePathname.startsWith(item.href));
      const Icon = item.icon;
      const showDivider = item.group !== lastGroup && lastGroup !== '';
      lastGroup = item.group;

      return (
        <div key={item.href}>
          {showDivider && <div className="my-1 h-px bg-white/40" />}
          <SidebarNavTooltip label={item.label} enabled={compact}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-3 lg:py-2 text-sm font-medium transition-all duration-200',
                active
                  ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_8px_24px_-8px_rgba(14,116,205,0.6)]'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                compact && 'justify-center'
              )}
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                  active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg)
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.color)} />
              </span>
              <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
            </Link>
          </SidebarNavTooltip>
        </div>
      );
    });
  };

  if (isDriverLoading) {
    return (
      <div className="w-full space-y-4 p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Driver Management.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl vm-gradient-atmosphere" />

      {/* Mobile header */}
      <div className="mb-3 lg:hidden">
        <Card className="vm-panel-strong">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                <Truck className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">Driver Management</p>
                <p className="text-xs text-muted-foreground">Control Center</p>
              </div>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="bg-white/90 gap-1.5">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-[320px] border-r border-white/70 bg-slate-50/95 p-0 backdrop-blur-xl flex flex-col">
                <SheetHeader className="shrink-0 border-b border-white/80 px-4 py-4 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                      <Truck className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm">Driver Management</SheetTitle>
                      <SheetDescription className="text-xs">Navigate between sections</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-3 pb-8">{navigationLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>

      {/* Desktop grid */}
      <div className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[240px_minmax(0,1fr)]'} lg:items-start`}>
        <TooltipProvider delayDuration={150}>
          <aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block">
            <Card className="overflow-hidden vm-panel-strong vm-reveal">
              {/* Sidebar header */}
              <div
                className={cn('border-b border-white/50 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3', iconsOnly && 'px-2')}
                title={iconsOnly ? 'Driver Management' : undefined}
              >
                <div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                    <Truck className="h-4 w-4 text-white" />
                  </div>
                  <div className={iconsOnly ? 'sr-only' : undefined}>
                    <p className="text-sm font-semibold tracking-tight text-slate-800">Driver Management</p>
                    <p className="text-[11px] text-muted-foreground">Control Center</p>
                  </div>
                </div>
              </div>
              <CardContent className="p-2 overflow-y-auto max-h-[calc(100vh-var(--app-header-offset,4rem)-8rem)]">
                {navigationLinks(undefined, iconsOnly)}
              </CardContent>
            </Card>
          </aside>
        </TooltipProvider>

        <main className="min-w-0 vm-reveal">{children}</main>
      </div>

      <ModuleBottomNav tabs={bottomTabs} onMore={() => setMobileMenuOpen(true)} moduleName="Driver Management" />
    </div>
  );
}
