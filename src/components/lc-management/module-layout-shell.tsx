'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BookOpenCheck,
  FileText,
  BarChart3,
  Wallet,
  Landmark,
  ListTree,
  Menu,
  PencilRuler,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type Section = {
  href: string;
  label: string;
  resource: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  group: 'core' | 'workflow' | 'analysis';
};

const sections: Section[] = [
  {
    href: '/lc-management',
    label: 'Dashboard',
    resource: 'Dashboard',
    icon: BarChart3,
    color: 'text-sky-600',
    bg: 'bg-sky-50',
    group: 'core',
  },
  {
    href: '/lc-management/request',
    label: 'LC Request',
    resource: 'LC Request',
    icon: FileText,
    color: 'text-cyan-600',
    bg: 'bg-cyan-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/detail',
    label: 'LC Detail',
    resource: 'LC Detail',
    icon: ListTree,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/opening',
    label: 'LC Opening',
    resource: 'LC Opening',
    icon: Landmark,
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/documents',
    label: 'LC Documents',
    resource: 'LC Documents',
    icon: BookOpenCheck,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/payments',
    label: 'LC Payments',
    resource: 'LC Payments',
    icon: Wallet,
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/amendments',
    label: 'LC Amendments',
    resource: 'LC Amendments',
    icon: PencilRuler,
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    group: 'workflow',
  },
  {
    href: '/lc-management/reports',
    label: 'LC Reports',
    resource: 'LC Reports',
    icon: BarChart3,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    group: 'analysis',
  },
];

export default function LcManagementLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { can } = useAuthorization();

  const canViewModule =
    can('View Module', 'LC Management') ||
    sections.some(
      (item) =>
        can('View', `LC Management.${item.resource}`) ||
        can('Add', `LC Management.${item.resource}`) ||
        can('Edit', `LC Management.${item.resource}`)
    );

  const availableSections = sections.filter((item) => {
    if (item.resource === 'Dashboard' && canViewModule) return true;
    return (
      can('View', `LC Management.${item.resource}`) ||
      can('Add', `LC Management.${item.resource}`) ||
      can('Edit', `LC Management.${item.resource}`)
    );
  });

  const renderLinks = (onNavigate?: () => void) => {
    let lastGroup: Section['group'] | '' = '';
    return availableSections.map((item) => {
      const active =
        safePathname === item.href ||
        (item.href !== '/lc-management' && safePathname.startsWith(item.href));
      const Icon = item.icon;
      const showDivider = lastGroup && lastGroup !== item.group;
      lastGroup = item.group;

      return (
        <div key={item.href}>
          {showDivider ? <div className="my-1 h-px bg-white/40" /> : null}
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

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access LC Management.</CardDescription>
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
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                <BookOpenCheck className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">LC Management</p>
                <p className="text-xs text-muted-foreground">Payment Control</p>
              </div>
            </div>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="bg-white/90 gap-1.5">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[88vw] max-w-[320px] border-r border-white/70 bg-slate-50/95 p-0 backdrop-blur-xl flex flex-col"
              >
                <SheetHeader className="shrink-0 border-b border-white/80 px-4 py-4 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                      <BookOpenCheck className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm">LC Management</SheetTitle>
                      <SheetDescription className="text-xs">Navigate between sections</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{renderLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden vm-panel-strong vm-reveal">
            <div className="border-b border-white/50 bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-sm">
                  <BookOpenCheck className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">LC Management</p>
                  <p className="text-[11px] text-muted-foreground">Payment Control</p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">{renderLinks()}</CardContent>
          </Card>
        </aside>

        <main className="min-w-0 vm-reveal">{children}</main>
      </div>
    </div>
  );
}
