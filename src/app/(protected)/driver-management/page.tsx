'use client';

import Link from 'next/link';
import { CarFront, Fuel, Gauge, ListFilter, LocateFixed, User } from 'lucide-react';
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
    can('View', 'Vehicle Management.Driver Mobile') ||
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
        <CardHeader>
          <CardTitle className="tracking-tight">Driver Management</CardTitle>
          <CardDescription>Dedicated module for driver operations and trip execution.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleCards.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block h-full" aria-label={`Open ${item.title}`}>
              <Card className="vm-panel h-full overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-32px_rgba(14,116,205,0.55)]">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white/80 shadow-sm ring-1 ring-cyan-100">
                    <Icon className="h-5 w-5 text-cyan-700" />
                  </div>
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription>{item.description}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
