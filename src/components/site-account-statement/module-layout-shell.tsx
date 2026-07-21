'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Loader2,
  Menu,
  PieChart,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { SAS_COLLECTIONS } from '@/lib/site-account-statement';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const MODULE = 'Site Account Statement';

/*
 * accessMode controls who can see each nav entry:
 *   'admin'         – only canViewAll (super-admin)
 *   'rbac'          – has explicit RBAC permission for the resource
 *   'member+rbac'   – project member (any role) OR explicit RBAC
 *   'module'        – any user who can access the module at all (Dashboard)
 *
 * Settings uses a dedicated check, so its accessMode is ignored.
 */
type AccessMode = 'admin' | 'rbac' | 'member+rbac' | 'module';

const sections: {
  href: string;
  label: string;
  resource: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  group: string;
  accessMode: AccessMode;
}[] = [
  { href: '/site-account-statement',                    label: 'Dashboard',          resource: 'Dashboard',        icon: LayoutDashboard, color: 'text-emerald-600', bg: 'bg-emerald-50',  group: 'core',         accessMode: 'module'     },
  { href: '/site-account-statement/payments',           label: 'Payments Received',  resource: 'Payments',         icon: TrendingUp,      color: 'text-blue-600',    bg: 'bg-blue-50',     group: 'transactions', accessMode: 'member+rbac' },
  { href: '/site-account-statement/expenses',           label: 'Site Expenses',      resource: 'Expenses',         icon: TrendingDown,    color: 'text-rose-600',    bg: 'bg-rose-50',     group: 'transactions', accessMode: 'member+rbac' },
  { href: '/site-account-statement/budget',             label: 'Site Fund Budget',   resource: 'Budget',           icon: Target,          color: 'text-emerald-700', bg: 'bg-emerald-50',  group: 'transactions', accessMode: 'rbac'       },
  { href: '/site-account-statement/tender-forecast',    label: 'Tender Forecast',    resource: 'Tender Forecast',  icon: BarChart3,       color: 'text-teal-700',    bg: 'bg-teal-50',     group: 'transactions', accessMode: 'rbac'       },
  { href: '/site-account-statement/reports/receipts',  label: 'Receipt Report',     resource: 'Reports',          icon: FileText,        color: 'text-teal-600',    bg: 'bg-teal-50',     group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/expenses',  label: 'Expense Report',     resource: 'Reports',          icon: Receipt,         color: 'text-orange-600',  bg: 'bg-orange-50',   group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/statement', label: 'Account Statement',  resource: 'Reports',          icon: BookOpen,        color: 'text-violet-600',  bg: 'bg-violet-50',   group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/summary',   label: 'Project Summary',    resource: 'Reports',          icon: BarChart3,       color: 'text-indigo-600',  bg: 'bg-indigo-50',   group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/category',  label: 'Category Analysis',  resource: 'Reports',          icon: PieChart,        color: 'text-purple-600',  bg: 'bg-purple-50',   group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/cashflow',  label: 'Cash Flow',          resource: 'Reports',          icon: Activity,        color: 'text-sky-600',     bg: 'bg-sky-50',      group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/person',    label: 'Person Expenses',    resource: 'Reports',          icon: Users,           color: 'text-pink-600',    bg: 'bg-pink-50',     group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/balance',   label: 'Balance Status',     resource: 'Reports',          icon: ShieldCheck,     color: 'text-green-600',   bg: 'bg-green-50',    group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/daywise',             label: 'Day-wise Statement', resource: 'Reports', icon: CalendarDays,  color: 'text-cyan-600',    bg: 'bg-cyan-50',     group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/monthly-comparison', label: 'Month Comparison',   resource: 'Reports', icon: ArrowLeftRight, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/reports/budget',            label: 'Budget Report',      resource: 'Reports', icon: Target,         color: 'text-emerald-700', bg: 'bg-emerald-50',  group: 'reports',      accessMode: 'member+rbac' },
  { href: '/site-account-statement/settings',          label: 'Settings',           resource: 'Project Settings', icon: Settings,        color: 'text-slate-600',   bg: 'bg-slate-50',    group: 'master',       accessMode: 'rbac'       },
];

export default function SiteAccountStatementShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname ?? '';
  const { can } = useAuthorization();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Separate state: is the user actually assigned to a project (any role)?
  // We always check this — previously the check was skipped for RBAC users,
  // which caused all RBAC users to be treated as project members for nav purposes.
  const [isProjectMember, setIsProjectMember] = useState(false);
  const [membershipChecked, setMembershipChecked] = useState(false);

  const canViewAll = can('View', `${MODULE}.All Projects`);

  const hasRbacAccess =
    canViewAll ||
    can('View Module', MODULE) ||
    sections.some(s => Boolean(s.resource) && (
      can('View', `${MODULE}.${s.resource}`) ||
      can('Add',  `${MODULE}.${s.resource}`)
    )) ||
    ['Budget Alerts', 'Expense Categories'].some(r =>
      can('View', `${MODULE}.${r}`) ||
      can('Add',  `${MODULE}.${r}`) ||
      can('Edit', `${MODULE}.${r}`)
    );

  useEffect(() => {
    if (!user?.id) { setMembershipChecked(true); return; }
    const col = collection(db, SAS_COLLECTIONS.projects);
    Promise.all([
      getDocs(query(col, where('assignedPersonId', '==', user.id))),
      getDocs(query(col, where('altUserId',        '==', user.id))),
      getDocs(query(col, where('viewerId',         '==', user.id))),
    ])
      .then(([a, b, c]) => setIsProjectMember(!a.empty || !b.empty || !c.empty))
      .finally(() => setMembershipChecked(true));
  }, [user?.id, canViewAll]);

  const canViewModule = hasRbacAccess || isProjectMember;

  // Determine which sections the current user can access.
  function canAccessSection(item: typeof sections[0]): boolean {
    // Settings: requires explicit Settings-family RBAC
    if (item.href === '/site-account-statement/settings') {
      return ['Project Settings', 'Expense Categories', 'Budget Alerts', 'Tender Budget'].some(r =>
        can('View', `${MODULE}.${r}`) || can('Add', `${MODULE}.${r}`) || can('Edit', `${MODULE}.${r}`)
      );
    }

    switch (item.accessMode) {
      case 'module':
        return canViewModule;
      case 'member+rbac':
        return (
          isProjectMember ||
          can('View', `${MODULE}.${item.resource}`) ||
          can('Add',  `${MODULE}.${item.resource}`) ||
          can('Edit', `${MODULE}.${item.resource}`)
        );
      case 'rbac':
        return (
          can('View', `${MODULE}.${item.resource}`) ||
          can('Add',  `${MODULE}.${item.resource}`) ||
          can('Edit', `${MODULE}.${item.resource}`)
        );
      default:
        return false;
    }
  }

  const availableSections = membershipChecked ? sections.filter(canAccessSection) : [];

  // Check whether the CURRENT page is in the user's allowed set.
  function isPathInSections(path: string, sectionList: typeof sections): boolean {
    return sectionList.some(s => {
      const isSettings = s.href === '/site-account-statement/settings';
      return (
        path === s.href ||
        (s.href !== '/site-account-statement' && path.startsWith(s.href + '/')) ||
        (isSettings && (
          path.startsWith('/site-account-statement/expense-categories') ||
          path.startsWith('/site-account-statement/budget-alerts')
        ))
      );
    });
  }

  const isCurrentPageAccessible = !membershipChecked || isPathInSections(safePathname, availableSections);

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return availableSections.map(item => {
      const isSettingsEntry = item.href === '/site-account-statement/settings';
      const active =
        safePathname === item.href ||
        (item.href !== '/site-account-statement' && safePathname.startsWith(item.href + '/')) ||
        (isSettingsEntry && (
          safePathname.startsWith('/site-account-statement/expense-categories') ||
          safePathname.startsWith('/site-account-statement/budget-alerts')
        ));
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
            <span className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
              active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg)
            )}>
              <Icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.color)} />
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        </div>
      );
    });
  };

  // Show full-screen loading while we wait for the membership check
  if (!membershipChecked) {
    return (
      <div className="flex w-full items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Full module access denied
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

  // Page-level access denied content (nav still visible so user can navigate to allowed pages)
  const pageAccessDenied = (
    <Card>
      <CardContent className="py-16 text-center space-y-3">
        <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
        <div>
          <p className="font-semibold text-slate-800">Access Denied</p>
          <p className="text-sm text-muted-foreground mt-1">You don&apos;t have permission to view this page.</p>
          <p className="text-xs text-muted-foreground mt-0.5">Contact your administrator to request access.</p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40" />
        <div className="absolute left-[8%] top-[8%] h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="absolute right-[10%] bottom-[6%] h-64 w-64 rounded-full bg-teal-300/20 blur-3xl" />
      </div>

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

        <main className="min-w-0">
          {isCurrentPageAccessible ? children : pageAccessDenied}
        </main>
      </div>
    </div>
  );
}
