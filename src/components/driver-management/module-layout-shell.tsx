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
  User,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const sections = [
  { href: '/driver-management', label: 'Overview', resource: '', icon: Gauge },
  { href: '/driver-management/mobile-hub', label: 'Driver Mobile', resource: 'Driver Mobile Hub', icon: User },
  { href: '/driver-management/vehicle-details', label: 'Vehicle Details', resource: 'Assigned Vehicle Details', icon: CarFront },
  { href: '/driver-management/fuel', label: 'Driver Fuel', resource: 'Driver Fuel', icon: Fuel },
  { href: '/driver-management/daily-status', label: 'Daily Status', resource: 'Driver Daily Status', icon: Gauge },
  { href: '/driver-management/trips', label: 'Driver Trips', resource: 'Driver Trips', icon: LocateFixed },
  { href: '/driver-management/trip-log', label: 'Trip Log', resource: 'Driver Trips', icon: ListFilter },
  { href: '/driver-management/employee-trips', label: 'Employee Trips', resource: 'Employee Trip Log', icon: ReceiptText },
  { href: '/driver-management/trip-management', label: 'Trip Management', resource: 'Trip Management', icon: LocateFixed },
];

const legacyResourceMap: Record<string, string[]> = {
  'Driver Mobile Hub': ['Vehicle Management.Driver Mobile'],
  'Assigned Vehicle Details': ['Vehicle Management.Driver Mobile'],
  'Driver Fuel': ['Vehicle Management.Driver Mobile Fuel'],
  'Driver Daily Status': ['Vehicle Management.Driver Daily Status'],
  'Driver Trips': ['Vehicle Management.Driver Mobile Trip'],
  'Employee Trip Log': ['Vehicle Management.Employee Trip Reimbursement'],
  'Trip Management': ['Vehicle Management.Trip Management'],
};

const driverSelfResources = new Set([
  'Driver Mobile Hub',
  'Assigned Vehicle Details',
  'Driver Fuel',
  'Driver Daily Status',
  'Driver Trips',
  'Employee Trip Log',
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

  const navigationLinks = (onNavigate?: () => void) =>
    availableSections.map((item) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/driver-management' && safePathname.startsWith(item.href));
      const Icon = item.icon;

      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            'group relative flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-300',
            active
              ? 'vm-nav-active bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_16px_36px_-22px_rgba(14,116,205,0.85)]'
              : 'text-slate-600 hover:bg-white/75 hover:text-slate-900 hover:translate-x-1'
          )}
        >
          <span className={cn('h-5 w-5 shrink-0 transition-transform duration-300', active ? 'scale-110' : 'group-hover:scale-110')}>
            <Icon className="h-5 w-5" />
          </span>
          <span>{item.label}</span>
        </Link>
      );
    });

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
      <div className="mb-3 lg:hidden">
        <Card className="vm-panel-strong">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-semibold tracking-tight">Driver Management</p>
              <p className="text-xs text-muted-foreground">Use menu to switch sections</p>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="bg-white/90">
                  <Menu className="mr-2 h-4 w-4" />
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-[360px] border-r border-white/70 bg-slate-50/95 p-0 backdrop-blur-xl">
                <SheetHeader className="border-b border-white/80 px-4 py-4 text-left">
                  <SheetTitle>Driver Management</SheetTitle>
                  <SheetDescription>Navigate between modules</SheetDescription>
                </SheetHeader>
                <div className="space-y-1 p-3">
                  {navigationLinks(() => setMobileMenuOpen(false))}
                </div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden vm-panel-strong vm-reveal">
            <CardHeader className="pb-3 border-b border-white/60">
              <CardTitle className="text-base tracking-tight">Driver Management</CardTitle>
              <CardDescription>Control Center</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {navigationLinks()}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 vm-reveal">{children}</main>
      </div>
    </div>
  );
}
