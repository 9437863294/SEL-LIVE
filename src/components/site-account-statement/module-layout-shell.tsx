'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  Layers,
  LayoutDashboard,
  Loader2,
  Menu,
  PieChart,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tags,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS } from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const MODULE = 'Site Account Statement';

const sections = [
  { href: '/site-account-statement',                    label: 'Dashboard',          resource: 'Dashboard',          icon: LayoutDashboard, color: 'text-emerald-600', bg: 'bg-emerald-50',  group: 'core',         viewAllAccess: true  },
  { href: '/site-account-statement/payments',           label: 'Payments Received',  resource: 'Payments',           icon: TrendingUp,      color: 'text-blue-600',    bg: 'bg-blue-50',     group: 'transactions', viewAllAccess: true  },
  { href: '/site-account-statement/expenses',           label: 'Site Expenses',      resource: 'Expenses',           icon: TrendingDown,    color: 'text-rose-600',    bg: 'bg-rose-50',     group: 'transactions', viewAllAccess: true  },
  { href: '/site-account-statement/reports/receipts',  label: 'Receipt Report',     resource: 'Reports',            icon: FileText,        color: 'text-teal-600',    bg: 'bg-teal-50',     group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/expenses',  label: 'Expense Report',     resource: 'Reports',            icon: Receipt,         color: 'text-orange-600',  bg: 'bg-orange-50',   group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/statement', label: 'Account Statement',  resource: 'Reports',            icon: BookOpen,        color: 'text-violet-600',  bg: 'bg-violet-50',   group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/summary',   label: 'Project Summary',    resource: 'Reports',            icon: BarChart3,       color: 'text-indigo-600',  bg: 'bg-indigo-50',   group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/category',  label: 'Category Analysis',  resource: 'Reports',            icon: PieChart,        color: 'text-purple-600',  bg: 'bg-purple-50',   group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/cashflow',  label: 'Cash Flow',          resource: 'Reports',            icon: Activity,        color: 'text-sky-600',     bg: 'bg-sky-50',      group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/person',    label: 'Person Expenses',    resource: 'Reports',            icon: Users,           color: 'text-pink-600',    bg: 'bg-pink-50',     group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/balance',   label: 'Balance Status',     resource: 'Reports',            icon: ShieldCheck,     color: 'text-green-600',   bg: 'bg-green-50',    group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/reports/daywise',   label: 'Day-wise Statement', resource: 'Reports',            icon: CalendarDays,    color: 'text-cyan-600',    bg: 'bg-cyan-50',     group: 'reports',      viewAllAccess: true  },
  { href: '/site-account-statement/expense-categories',label: 'Expense Categories', resource: 'Expense Categories', icon: Tags,            color: 'text-amber-600',   bg: 'bg-amber-50',    group: 'master',       viewAllAccess: false },
  { href: '/site-account-statement/settings',          label: 'Project Settings',   resource: 'Project Settings',   icon: Settings,        color: 'text-slate-600',   bg: 'bg-slate-50',    group: 'master',       viewAllAccess: false },
];

export default function SiteAccountStatementShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isProjectMember, setIsProjectMember] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);

  const canViewAll = can('View', `${MODULE}.All Projects`);

  const hasRbacAccess =
    canViewAll ||
    can('View Module', MODULE) ||
    sections.some(s => Boolean(s.resource) && (
      can('View', `${MODULE}.${s.resource}`) ||
      can('Add', `${MODULE}.${s.resource}`)
    ));

  // Check if the user is assigned to any project (primary, alt, or viewer) — allows
  // project-level members through even when they have no RBAC module permissions.
  useEffect(() => {
    if (hasRbacAccess) {
      setIsProjectMember(true);
      setMembershipChecked(true);
      return;
    }
    if (!user?.id) {
      setMembershipChecked(true);
      return;
    }
    getDocs(collection(db, SAS_COLLECTIONS.projects))
      .then(snap => {
        const member = snap.docs.some(d => {
          const p = d.data();
          return p.assignedPersonId === user.id || p.altUserId === user.id || p.viewerId === user.id;
        });
        setIsProjectMember(member);
      })
      .finally(() => setMembershipChecked(true));
  }, [user?.id, hasRbacAccess]);

  const canViewModule = hasRbacAccess || isProjectMember;

  const availableSections = sections.filter(item => {
    if (canViewAll && item.viewAllAccess) return true;
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
      const active =
        safePathname === item.href ||
        (item.href !== '/site-account-statement' && safePathname.startsWith(item.href));
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
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 lg:py-2 text-sm font-medium transition-all duration-200',
              active
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]'
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

  if (!membershipChecked && !hasRbacAccess) {
    return (
      <div className="flex w-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have permission to access Site Account Statement.</CardDescription>
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
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40" />
      <div className="pointer-events-none absolute -z-10 left-[8%] top-[8%] h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
      <div className="pointer-events-none absolute -z-10 right-[10%] bottom-[6%] h-64 w-64 rounded-full bg-teal-300/20 blur-3xl" />

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
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow">
                      <Wallet className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">Site Account</SheetTitle>
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
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                <Wallet className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight leading-tight truncate">Site Account Statement</p>
                <p className="text-[11px] text-muted-foreground leading-tight">Fund Tracker</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Desktop grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden bg-white/80 backdrop-blur-sm border border-white/60 shadow-sm">
            <div className="border-b border-white/50 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                  <Wallet className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Site Account</p>
                  <p className="text-[11px] text-muted-foreground">Fund Tracker</p>
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
