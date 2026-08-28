'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  BadgeCheck,
  BarChart3,
  BookOpen,
  Building2,
  CheckCircle2,
  FilePlus2,
  FileStack,
  FileText,
  Gauge,
  Inbox,
  Menu,
  ShieldAlert,
  Settings,
  Stamp,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { E_APPROVAL_BASE_PATH } from '@/lib/e-approval';
import { useEApprovalPermissions } from './hooks';

type NavKey =
  | 'always'
  | 'create'
  | 'inbox'
  | 'mine'
  | 'department'
  | 'all'
  | 'reports'
  | 'delegations'
  | 'settings';

const sections: Array<{
  href: string;
  label: string;
  icon: typeof Gauge;
  color: string;
  bg: string;
  group: string;
  gate: NavKey;
}> = [
  { href: E_APPROVAL_BASE_PATH, label: 'Dashboard', icon: Gauge, color: 'text-sky-600', bg: 'bg-sky-100', group: 'work', gate: 'always' },
  { href: `${E_APPROVAL_BASE_PATH}/create`, label: 'Create Approval', icon: FilePlus2, color: 'text-emerald-600', bg: 'bg-emerald-100', group: 'work', gate: 'create' },
  { href: `${E_APPROVAL_BASE_PATH}/inbox`, label: 'My Inbox', icon: Inbox, color: 'text-indigo-600', bg: 'bg-indigo-100', group: 'work', gate: 'inbox' },
  { href: `${E_APPROVAL_BASE_PATH}/created-by-me`, label: 'Created by Me', icon: FileText, color: 'text-violet-600', bg: 'bg-violet-100', group: 'work', gate: 'mine' },
  { href: `${E_APPROVAL_BASE_PATH}/drafts`, label: 'Drafts', icon: FileStack, color: 'text-slate-600', bg: 'bg-slate-200', group: 'work', gate: 'mine' },

  { href: `${E_APPROVAL_BASE_PATH}/department`, label: 'Department Inbox', icon: Building2, color: 'text-amber-600', bg: 'bg-amber-100', group: 'registers', gate: 'department' },
  { href: `${E_APPROVAL_BASE_PATH}/all`, label: 'All Approvals', icon: BadgeCheck, color: 'text-teal-600', bg: 'bg-teal-100', group: 'registers', gate: 'all' },
  { href: `${E_APPROVAL_BASE_PATH}/completed`, label: 'Completed', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100', group: 'registers', gate: 'mine' },
  { href: `${E_APPROVAL_BASE_PATH}/rejected`, label: 'Rejected', icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-100', group: 'registers', gate: 'mine' },

  { href: `${E_APPROVAL_BASE_PATH}/delegations`, label: 'Delegations', icon: UserCheck, color: 'text-fuchsia-600', bg: 'bg-fuchsia-100', group: 'config', gate: 'delegations' },
  { href: `${E_APPROVAL_BASE_PATH}/reports`, label: 'Reports', icon: BarChart3, color: 'text-blue-600', bg: 'bg-blue-100', group: 'config', gate: 'reports' },
  { href: `${E_APPROVAL_BASE_PATH}/settings`, label: 'Settings', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-200', group: 'config', gate: 'settings' },
  // Ungated on purpose: the person who cannot find anything is exactly the person who needs the guide.
  { href: `${E_APPROVAL_BASE_PATH}/help`, label: 'Guide', icon: BookOpen, color: 'text-rose-600', bg: 'bg-rose-100', group: 'config', gate: 'always' },
];

const groupLabels: Record<string, string> = {
  work: 'My Work',
  registers: 'Registers',
  config: 'Configuration',
};

export default function EApprovalLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const permissions = useEApprovalPermissions();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const gates: Record<NavKey, boolean> = {
    always: true,
    create: permissions.canCreate,
    inbox: true,
    mine: true,
    department: permissions.canViewDepartment,
    all: permissions.canViewAll,
    reports: permissions.canViewReports,
    delegations: permissions.canViewDelegations,
    settings: permissions.canManageSettings,
  };

  const availableSections = sections.filter((item) => gates[item.gate]);
  // Longest match first, so `/e-approval/inbox` does not light up the dashboard link too.
  const currentSection = [...availableSections]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => pathname === item.href || (item.href !== E_APPROVAL_BASE_PATH && pathname.startsWith(item.href)));

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return availableSections.map((item) => {
      const active = currentSection?.href === item.href;
      const Icon = item.icon;
      const showGroupTitle = item.group !== lastGroup;
      lastGroup = item.group;
      return (
        <div key={item.href}>
          {showGroupTitle && (
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 first:pt-1">
              {groupLabels[item.group] || item.group}
            </p>
          )}
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-200 lg:py-2',
              active
                ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-[0_8px_24px_-8px_rgba(79,70,229,0.5)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 transition-all duration-200',
                active ? 'bg-white/20 ring-white/30' : cn('ring-black/[0.03] group-hover:scale-105', item.bg),
              )}
            >
              <Icon className={cn('h-4 w-4 transition-transform', active ? 'scale-110 text-white' : item.color)} />
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        </div>
      );
    });
  };

  if (!permissions.isLoading && !permissions.canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access E-Approval.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative w-full px-2 py-2 sm:px-6 sm:py-4 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-sky-50/60 via-white to-indigo-50/60" />

      <div className="mb-2 sm:mb-3 lg:hidden">
        <Card>
          <CardContent className="flex items-center gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-2.5">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10 shrink-0 gap-2 bg-white/90 px-3 text-sm font-medium">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex w-[88vw] max-w-[300px] flex-col border-r border-white/70 bg-slate-50 p-0">
                <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow">
                      <Stamp className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">E-Approval</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{navigationLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
                <Stamp className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight tracking-tight">E-Approval</p>
                <p className="truncate text-[11px] leading-tight text-muted-foreground">
                  {currentSection?.label || 'E-Notesheet'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden">
            <div className="border-b border-white/50 bg-gradient-to-r from-sky-500/10 to-indigo-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 shadow-sm">
                  <Stamp className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">E-Approval</p>
                  <p className="text-[11px] text-muted-foreground">E-Notesheet</p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">{navigationLinks()}</CardContent>
          </Card>
        </aside>

        <main className="min-w-0 w-full overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
