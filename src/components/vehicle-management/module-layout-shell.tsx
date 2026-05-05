'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  CarFront,
  FileArchive,
  Fuel,
  Gauge,
  History,
  LocateFixed,
  Landmark,
  Leaf,
  RefreshCw,
  Settings,
  Menu,
  ScrollText,
  Shield,
  ShieldAlert,
  Truck,
  User,
  Wrench,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// ─── Per-section color config ────────────────────────────────────────────────

const sections = [
  { href: '/vehicle-management',                label: 'Overview',        resource: '',                          icon: Gauge,       color: 'text-cyan-600',    bg: 'bg-cyan-50',    group: 'core' },
  { href: '/vehicle-management/renewals',       label: 'Renewals Hub',    resource: '',                          icon: RefreshCw,   color: 'text-rose-600',    bg: 'bg-rose-50',    group: 'core' },
  { href: '/vehicle-management/renewals/history', label: 'Renewal History', resource: '',                        icon: History,     color: 'text-slate-600',   bg: 'bg-slate-50',   group: 'core' },
  { href: '/vehicle-management/vehicle-health', label: 'Vehicle Health',  resource: '',                          icon: Activity,    color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'core' },
  { href: '/vehicle-management/vehicle-master', label: 'Vehicle Master',  resource: 'Vehicle Master',            icon: CarFront,    color: 'text-blue-600',    bg: 'bg-blue-50',    group: 'fleet' },
  { href: '/vehicle-management/insurance',      label: 'Insurance',       resource: 'Insurance Management',     icon: Shield,      color: 'text-violet-600',  bg: 'bg-violet-50',  group: 'compliance' },
  { href: '/vehicle-management/puc',            label: 'PUC',             resource: 'PUC Management',            icon: Leaf,        color: 'text-green-600',   bg: 'bg-green-50',   group: 'compliance' },
  { href: '/vehicle-management/fitness',        label: 'Fitness',         resource: 'Fitness Certificate Management', icon: BadgeCheck, color: 'text-indigo-600', bg: 'bg-indigo-50', group: 'compliance' },
  { href: '/vehicle-management/road-tax',       label: 'Road Tax',        resource: 'Road Tax Management',       icon: Landmark,    color: 'text-amber-600',   bg: 'bg-amber-50',   group: 'compliance' },
  { href: '/vehicle-management/permit',         label: 'Permit',          resource: 'Permit Management',         icon: ScrollText,  color: 'text-orange-600',  bg: 'bg-orange-50',  group: 'compliance' },
  { href: '/vehicle-management/maintenance',    label: 'Maintenance',     resource: 'Maintenance Management',    icon: Wrench,      color: 'text-red-600',     bg: 'bg-red-50',     group: 'ops' },
  { href: '/vehicle-management/fuel',           label: 'Fuel',            resource: 'Fuel Management',           icon: Fuel,        color: 'text-sky-600',     bg: 'bg-sky-50',     group: 'ops' },
  { href: '/vehicle-management/driver',         label: 'Driver Master',   resource: 'Driver Management',         icon: User,        color: 'text-teal-600',    bg: 'bg-teal-50',    group: 'ops' },
  { href: '/vehicle-management/trips',          label: 'Trip Management', resource: 'Trip Management',           icon: LocateFixed, color: 'text-blue-600',    bg: 'bg-blue-50',    group: 'ops' },
  { href: '/vehicle-management/documents',      label: 'Documents',       resource: 'Document Management',       icon: FileArchive, color: 'text-slate-600',   bg: 'bg-slate-50',   group: 'ops' },
  { href: '/vehicle-management/reports',        label: 'Reports',         resource: 'Reports',                   icon: BarChart3,   color: 'text-indigo-600',  bg: 'bg-indigo-50',  group: 'ops' },
  { href: '/vehicle-management/settings',       label: 'Settings',        resource: 'Settings',                  icon: Settings,    color: 'text-slate-600',   bg: 'bg-slate-50',   group: 'ops' },
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

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return availableSections.map((item) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/vehicle-management' && safePathname.startsWith(item.href));
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
            {/* Icon container — colored bg when inactive, white when active */}
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                active
                  ? 'bg-white/20'
                  : cn('group-hover:scale-105', item.bg)
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

      {/* Mobile header */}
      <div className="mb-3 lg:hidden">
        <Card className="vm-panel-strong">
          <CardContent className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                <Truck className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">Vehicle Management</p>
                <p className="text-xs text-muted-foreground">Command Center</p>
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
                      <SheetTitle className="text-sm">Vehicle Management</SheetTitle>
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
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Vehicle Management</p>
                  <p className="text-[11px] text-muted-foreground">Command Center</p>
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
