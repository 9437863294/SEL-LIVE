'use client';

import Link from 'next/link';
import { CarFront, Fuel, Gauge, ListFilter, LocateFixed, ReceiptText, User } from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useCurrentDriverProfile } from '@/components/vehicle-management/hooks';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type CardItem = {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  canView: boolean;
};

export default function DriverManagementOverviewPage() {
  const { can } = useAuthorization();
  const { driver, isLoading } = useCurrentDriverProfile();
  const isAssignedDriver = Boolean(driver?.id && (driver?.assignedVehicleId || driver?.assignedVehicleNumber));

  const canViewModule =
    can('View Module', 'Driver Management') ||
    can('View', 'Driver Management.Employee Trip Log') ||
    can('Add', 'Driver Management.Employee Trip Log') ||
    can('Edit', 'Driver Management.Employee Trip Log') ||
    can('View', 'Vehicle Management.Driver Mobile') ||
    can('View', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Add', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('Edit', 'Vehicle Management.Employee Trip Reimbursement') ||
    can('View', 'Vehicle Management.Driver Management') ||
    isAssignedDriver;

  const cards: CardItem[] = [
    {
      title: 'Driver Mobile Hub',
      description: 'Driver app dashboard for daily operations.',
      href: '/driver-management/mobile-hub',
      icon: Gauge,
      canView:
        can('View', 'Driver Management.Driver Mobile Hub') ||
        can('View', 'Vehicle Management.Driver Mobile') ||
        isAssignedDriver,
    },
    {
      title: 'Assigned Vehicle Details',
      description: 'See compliance, maintenance, and recent vehicle usage.',
      href: '/driver-management/vehicle-details',
      icon: CarFront,
      canView:
        can('View', 'Driver Management.Assigned Vehicle Details') ||
        can('View', 'Vehicle Management.Driver Mobile') ||
        isAssignedDriver,
    },
    {
      title: 'Driver Fuel',
      description: 'Capture fuel logs from driver workflow.',
      href: '/driver-management/fuel',
      icon: Fuel,
      canView:
        can('View', 'Driver Management.Driver Fuel') ||
        can('View', 'Vehicle Management.Driver Mobile Fuel') ||
        isAssignedDriver,
    },
    {
      title: 'Daily Status',
      description: 'Submit daily running status and trips.',
      href: '/driver-management/daily-status',
      icon: Gauge,
      canView:
        can('View', 'Driver Management.Driver Daily Status') ||
        can('View', 'Vehicle Management.Driver Daily Status') ||
        isAssignedDriver,
    },
    {
      title: 'Driver Trips',
      description: 'Start/stop trip and auto location tracking.',
      href: '/driver-management/trips',
      icon: LocateFixed,
      canView:
        can('View', 'Driver Management.Driver Trips') ||
        can('View', 'Vehicle Management.Driver Mobile Trip') ||
        isAssignedDriver,
    },
    {
      title: 'Driver Trip Log',
      description: 'Full trip table with summary, filters, and popup details.',
      href: '/driver-management/trip-log',
      icon: ListFilter,
      canView:
        can('View', 'Driver Management.Driver Trips') ||
        can('View', 'Vehicle Management.Driver Mobile Trip') ||
        isAssignedDriver,
    },
    {
      title: 'Employee Trip Reimbursement',
      description: 'Personal vehicle office trips and reimbursement records.',
      href: '/driver-management/employee-trips',
      icon: ReceiptText,
      canView:
        can('View', 'Driver Management.Employee Trip Log') ||
        can('Add', 'Driver Management.Employee Trip Log') ||
        can('View', 'Vehicle Management.Employee Trip Reimbursement') ||
        can('Add', 'Vehicle Management.Employee Trip Reimbursement') ||
        can('View', 'Vehicle Management.Driver Management') ||
        Boolean(driver?.id),
    },
    {
      title: 'Trip Management',
      description: 'Monitor all trips and route history.',
      href: '/driver-management/trip-management',
      icon: LocateFixed,
      canView:
        can('View', 'Driver Management.Trip Management') ||
        can('View', 'Vehicle Management.Trip Management'),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <Card className="vm-panel-strong">
        <CardHeader>
          <CardTitle>Access Restricted</CardTitle>
          <CardDescription>You do not have access to Driver Management.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const visibleCards = cards.filter((item) => item.canView);

  return (
    <div className="space-y-4">
      <Card className="vm-panel-strong overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-600 animate-bb-gradient" />
        <CardHeader className="pb-3">
          <CardTitle className="tracking-tight text-xl sm:text-2xl">Driver Management</CardTitle>
          <CardDescription>Dedicated module for driver operations and trip execution.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 pt-0">
          <Badge className="bg-cyan-600 text-white">
            {driver?.driverName || 'User'}
          </Badge>
          <Badge variant="outline">
            Vehicle: {driver?.assignedVehicleNumber || 'Not assigned'}
          </Badge>
          <Badge variant="outline">
            Auto Access: {isAssignedDriver ? 'Enabled' : 'Role Based'}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-4">
        {visibleCards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block h-full" aria-label={`Open ${item.title}`}>
              <Card className="vm-panel h-full min-h-[132px] overflow-hidden cursor-pointer border-white/70 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)] focus-within:ring-2 focus-within:ring-cyan-400/60">
                <CardHeader className="space-y-2 p-3 sm:p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/85 shadow-sm ring-1 ring-cyan-100 sm:h-10 sm:w-10">
                    <Icon className="h-4 w-4 text-cyan-700 sm:h-5 sm:w-5" />
                  </div>
                  <CardTitle className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">
                    {item.title}
                  </CardTitle>
                  <CardDescription className="hidden text-xs leading-relaxed text-slate-600 sm:line-clamp-2 sm:block">
                    {item.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
                  <p className="text-[11px] font-medium text-cyan-700/90 sm:text-xs">Tap to open</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
