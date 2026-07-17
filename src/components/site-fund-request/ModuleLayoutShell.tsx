'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Calendar,
  FileText,
  FolderOpen,
  GitMerge,
  Layers,
  LayoutDashboard,
  Loader2,
  Menu,
  ScrollText,
  Settings,
  ShieldAlert,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SFR_COLLECTIONS } from '@/lib/site-fund-request';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const MODULE = 'Site Fund Request';

const sections = [
  { href: '/site-fund-request',                                   label: 'Dashboard',         resource: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600',  bg: 'bg-indigo-50',   group: 'core',     sub: false, viewAllAccess: true  },
  { href: '/site-fund-request/requests',                          label: 'All Requests',      resource: 'Requests',  icon: FileText,        color: 'text-blue-600',    bg: 'bg-blue-50',     group: 'requests', sub: false, viewAllAccess: true  },
  { href: '/site-fund-request/reports',                           label: 'Reports',           resource: 'Reports',   icon: BarChart3,       color: 'text-violet-600',  bg: 'bg-violet-50',   group: 'reports',  sub: false, viewAllAccess: true  },
  { href: '/site-fund-request/reports/summary',                   label: 'Summary',           resource: 'Reports',   icon: TrendingUp,      color: 'text-indigo-500',  bg: 'bg-indigo-50',   group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/project-wise',              label: 'Project-wise',      resource: 'Reports',   icon: FolderOpen,      color: 'text-sky-600',     bg: 'bg-sky-50',      group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/department-wise',           label: 'Dept-wise',         resource: 'Reports',   icon: Building2,       color: 'text-teal-600',    bg: 'bg-teal-50',     group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/monthly',                   label: 'Monthly',           resource: 'Reports',   icon: Calendar,        color: 'text-emerald-600', bg: 'bg-emerald-50',  group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/stage-wise',                label: 'Stage-wise',        resource: 'Reports',   icon: Layers,          color: 'text-fuchsia-600', bg: 'bg-fuchsia-50',  group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/overdue',                   label: 'Overdue',           resource: 'Reports',   icon: AlertTriangle,   color: 'text-rose-600',    bg: 'bg-rose-50',     group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/party-wise',                label: 'Party-wise',        resource: 'Reports',   icon: UserCheck,       color: 'text-amber-600',   bg: 'bg-amber-50',    group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/reports/approval-history',          label: 'Approval History',  resource: 'Reports',   icon: ScrollText,      color: 'text-slate-500',   bg: 'bg-slate-100',   group: 'reports',  sub: true,  viewAllAccess: true  },
  { href: '/site-fund-request/settings',                          label: 'Settings',          resource: 'Settings',  icon: Settings,        color: 'text-slate-600',   bg: 'bg-slate-50',    group: 'settings', sub: false, viewAllAccess: false },
];

export default function SiteFundRequestShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can, isLoading: authIsLoading } = useAuthorization();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isProjectMember, setIsProjectMember] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);

  const hasRbacAccess =
    can('View Module', MODULE) ||
    sections.some(s => Boolean(s.resource) && (
      can('View', `${MODULE}.${s.resource}`) ||
      can('Add', `${MODULE}.${s.resource}`)
    ));

  useEffect(() => {
    if (authIsLoading) return;
    if (hasRbacAccess) {
      setIsProjectMember(true);
      setMembershipChecked(true);
      return;
    }
    if (!user?.id) {
      setMembershipChecked(true);
      return;
    }
    getDocs(collection(db, SFR_COLLECTIONS.projects))
      .then(snap => {
        const member = snap.docs.some(d => {
          const p = d.data();
          return p.assignedPersonId === user.id || p.altUserId === user.id || p.viewerId === user.id;
        });
        setIsProjectMember(member);
      })
      .finally(() => setMembershipChecked(true));
  }, [authIsLoading, hasRbacAccess, user?.id]);

  const canViewModule = hasRbacAccess || isProjectMember;
  const hasAnyAccess = canViewModule;

  const availableSections = sections.filter(item => {
    if (isProjectMember && item.viewAllAccess) return true;
    if (!item.resource) return canViewModule;
    return (
      can('View', `${MODULE}.${item.resource}`) ||
      can('Add', `${MODULE}.${item.resource}`) ||
      can('Edit', `${MODULE}.${item.resource}`)
    );
  });

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return availableSections.map(item => {
      const active = item.sub
        ? safePathname.startsWith(item.href)
        : item.href === '/site-fund-request'
          ? safePathname === item.href
          : item.href === '/site-fund-request/reports'
            ? safePathname === item.href
            : safePathname.startsWith(item.href);

      const Icon = item.icon;
      const showDivider = item.group !== lastGroup && lastGroup !== '' && !item.sub;
      lastGroup = item.group;

      if (item.sub) {
        return (
          <div key={item.href} className="ml-3 pl-2 border-l border-slate-200/70">
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-200',
                active
                  ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-[0_4px_12px_-4px_rgba(99,102,241,0.4)]'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
              )}
            >
              <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all duration-200', active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg))}>
                <Icon className={cn('h-3 w-3 transition-transform', active ? 'text-white scale-110' : item.color)} />
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          </div>
        );
      }

      return (
        <div key={item.href}>
          {showDivider && <div className="my-1 h-px bg-white/40" />}
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 lg:py-2 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
            )}
          >
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200', active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg))}>
              <Icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.color)} />
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        </div>
      );
    });
  };

  if (authIsLoading || !membershipChecked) {
    return (
      <div className="flex w-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasAnyAccess) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Site Fund Request.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/40" />
      <div className="pointer-events-none absolute -z-10 left-[8%] top-[8%] h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -z-10 right-[10%] bottom-[6%] h-64 w-64 rounded-full bg-violet-300/20 blur-3xl" />

      {/* Mobile header */}
      <div className="mb-3 lg:hidden">
        <Card className="bg-white/80 backdrop-blur-sm border border-white/60 shadow-sm">
          <CardContent className="flex items-center gap-3 px-3 py-2.5">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="bg-white/90 gap-2 h-10 px-3 text-sm font-medium shrink-0">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[88vw] max-w-[300px] border-r border-slate-200 bg-slate-50 p-0 flex flex-col z-[60]">
                <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow">
                      <GitMerge className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">Site Fund Request</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">
                  {navigationLinks(() => setMobileMenuOpen(false))}
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                <GitMerge className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight leading-tight truncate">Site Fund Request</p>
                <p className="text-[11px] text-muted-foreground leading-tight">Workflow Approval</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Desktop grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden bg-white/80 backdrop-blur-sm border border-white/60 shadow-sm">
            <div className="border-b border-white/50 bg-gradient-to-r from-indigo-500/10 to-violet-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                  <GitMerge className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Site Fund Request</p>
                  <p className="text-[11px] text-muted-foreground">Workflow Approval</p>
                </div>
              </div>
            </div>
            <CardContent className="p-2 overflow-y-auto max-h-[calc(100vh-12rem)]">
              {navigationLinks()}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
