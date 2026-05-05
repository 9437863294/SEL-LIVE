'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  CarFront,
  Fuel,
  Gauge,
  ListFilter,
  LocateFixed,
  Menu,
  ReceiptText,
  ShieldAlert,
  Truck,
  User,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
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

export default function DriverManagementLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const { driver, isLoading: isDriverLoading } = useCurrentDriverProfile();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  const navigationLinks = (onNavigate?: () => void) => {
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
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_8px_24px_-8px_rgba(14,116,205,0.6)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
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
            <span className="truncate">{item.label}</span>
          </Link>
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
              <SheetContent side="left" className="w-[88vw] max-w-[320px] border-r border-white/70 bg-slate-50/95 p-0 backdrop-blur-xl">
                <SheetHeader className="border-b border-white/80 px-4 py-4 text-left">
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
                <div className="overflow-y-auto p-2">{navigationLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>

      {/* Desktop grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden vm-panel-strong vm-reveal">
            {/* Sidebar header */}
            <div className="border-b border-white/50 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                  <Truck className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Driver Management</p>
                  <p className="text-[11px] text-muted-foreground">Control Center</p>
                </div>
              </div>
            </div>
            <CardContent className="p-2 overflow-y-auto max-h-[calc(100vh-12rem)]">
              {navigationLinks()}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 vm-reveal">{children}</main>
      </div>
    </div>
  );
}
