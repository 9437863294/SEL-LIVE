'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BadgeCheck,
  CarFront,
  FileArchive,
  Fuel,
  Gauge,
  LocateFixed,
  Landmark,
  Leaf,
  Settings,
  Menu,
  ScrollText,
  Shield,
  ShieldAlert,
  User,
  Wrench,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const sections = [
  { href: '/vehicle-management', label: 'Overview', resource: '', icon: Gauge },
  { href: '/vehicle-management/vehicle-master', label: 'Vehicle Master', resource: 'Vehicle Master', icon: CarFront },
  { href: '/vehicle-management/insurance', label: 'Insurance', resource: 'Insurance Management', icon: Shield },
  { href: '/vehicle-management/puc', label: 'PUC', resource: 'PUC Management', icon: Leaf },
  { href: '/vehicle-management/fitness', label: 'Fitness', resource: 'Fitness Certificate Management', icon: BadgeCheck },
  { href: '/vehicle-management/road-tax', label: 'Road Tax', resource: 'Road Tax Management', icon: Landmark },
  { href: '/vehicle-management/permit', label: 'Permit', resource: 'Permit Management', icon: ScrollText },
  { href: '/vehicle-management/maintenance', label: 'Maintenance', resource: 'Maintenance Management', icon: Wrench },
  { href: '/vehicle-management/fuel', label: 'Fuel', resource: 'Fuel Management', icon: Fuel },
  { href: '/vehicle-management/driver', label: 'Driver Master', resource: 'Driver Management', icon: User },
  { href: '/vehicle-management/trips', label: 'Trip Management', resource: 'Trip Management', icon: LocateFixed },
  { href: '/vehicle-management/documents', label: 'Documents', resource: 'Document Management', icon: FileArchive },
  { href: '/vehicle-management/settings', label: 'Settings', resource: 'Settings', icon: Settings },
  { href: '/vehicle-management/reports', label: 'Reports', resource: 'Reports', icon: Gauge },
];

export default function VehicleManagementLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const canViewModule =
    can('View Module', 'Vehicle Management') ||
    sections.some(
      (item) =>
        Boolean(item.resource) &&
        (can('View', `Vehicle Management.${item.resource}`) ||
          can('Add', `Vehicle Management.${item.resource}`) ||
          can('Edit', `Vehicle Management.${item.resource}`))
    );

  const availableSections = sections.filter((item) => {
    if (!item.resource) return canViewModule;
    if (can('View', `Vehicle Management.${item.resource}`)) return true;
    if (can('Add', `Vehicle Management.${item.resource}`)) return true;
    if (can('Edit', `Vehicle Management.${item.resource}`)) return true;

    return false;
  });

  const navigationLinks = (onNavigate?: () => void) =>
    availableSections.map((item) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/vehicle-management' && safePathname.startsWith(item.href));
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
          {!active && (
            <span className="pointer-events-none absolute right-2 h-1.5 w-1.5 rounded-full bg-cyan-400/0 transition-colors group-hover:bg-cyan-400/70" />
          )}
        </Link>
      );
    });

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Vehicle Management.</CardDescription>
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
      <div className="pointer-events-none absolute -z-10 left-[8%] top-[8%] h-56 w-56 rounded-full bg-cyan-300/20 blur-3xl vm-orb-a" />
      <div className="pointer-events-none absolute -z-10 right-[10%] bottom-[6%] h-64 w-64 rounded-full bg-blue-300/20 blur-3xl vm-orb-b" />
      <div className="mb-3 lg:hidden">
        <Card className="vm-panel-strong">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-semibold tracking-tight">Vehicle Management</p>
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
                  <SheetTitle>Vehicle Management</SheetTitle>
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
              <CardTitle className="text-base tracking-tight">Vehicle Management</CardTitle>
              <CardDescription>Command Center</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {navigationLinks()}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 vm-reveal">
          {children}
        </main>
      </div>
    </div>
  );
}
