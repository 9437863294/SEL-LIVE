'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Menu,
  ReceiptIndianRupee,
  Repeat2,
  Settings,
  ShieldAlert,
  Tags,
  Users,
  WalletCards,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { DEFAULT_RECURRING_WORKFLOW, type RecurringWorkflowStep } from '@/lib/recurring-payments';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type NavItem = {
  href: string;
  label: string;
  resource: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  group: string;
};

const coreItems: NavItem[] = [
  { href: '/recurring-payments', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'overview' },
  { href: '/recurring-payments/payments', label: 'All Payments', resource: 'Payments', icon: ReceiptIndianRupee, color: 'text-blue-600', bg: 'bg-blue-50', group: 'payments' },
  { href: '/recurring-payments/upcoming', label: 'Upcoming', resource: 'Payments', icon: CalendarClock, color: 'text-cyan-600', bg: 'bg-cyan-50', group: 'payments' },
  { href: '/recurring-payments/overdue', label: 'Overdue', resource: 'Payments', icon: CircleDollarSign, color: 'text-rose-600', bg: 'bg-rose-50', group: 'payments' },
];

const managementItems: NavItem[] = [
  { href: '/recurring-payments/approvals', label: 'Pending Approvals', resource: 'Approvals', icon: ClipboardCheck, color: 'text-amber-600', bg: 'bg-amber-50', group: 'control' },
  { href: '/recurring-payments/calendar', label: 'Payment Calendar', resource: 'Payments', icon: CalendarDays, color: 'text-sky-600', bg: 'bg-sky-50', group: 'control' },
  { href: '/recurring-payments/masters', label: 'Recurring Masters', resource: 'Recurring Masters', icon: Repeat2, color: 'text-indigo-600', bg: 'bg-indigo-50', group: 'masters' },
  { href: '/recurring-payments/vendors', label: 'Vendors', resource: 'Vendors', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50', group: 'masters' },
  { href: '/recurring-payments/categories', label: 'Categories', resource: 'Categories', icon: Tags, color: 'text-orange-600', bg: 'bg-orange-50', group: 'masters' },
  { href: '/recurring-payments/reports', label: 'Reports', resource: 'Reports', icon: BarChart3, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', group: 'insights' },
  { href: '/recurring-payments/settings', label: 'Settings', resource: 'Settings', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-50', group: 'settings' },
];

const workflowPalette = [
  { color: 'text-violet-600', bg: 'bg-violet-50', icon: FileCheck2 },
  { color: 'text-amber-600', bg: 'bg-amber-50', icon: ClipboardCheck },
  { color: 'text-pink-600', bg: 'bg-pink-50', icon: ListChecks },
  { color: 'text-teal-600', bg: 'bg-teal-50', icon: WalletCards },
  { color: 'text-green-600', bg: 'bg-green-50', icon: FileCheck2 },
] as const;

function matchesPath(pathname: string, href: string) {
  if (href === '/recurring-payments') {
    return pathname === href || pathname === '/recurring-payments/dashboard';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function RecurringPaymentsLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);

  useEffect(
    () =>
      onSnapshot(doc(db, 'workflows', 'recurring-payments-workflow'), (snapshot) => {
        const steps = snapshot.data()?.steps as RecurringWorkflowStep[] | undefined;
        if (steps?.length) setWorkflowSteps(steps);
      }),
    [],
  );

  const workflowItems: NavItem[] = workflowSteps.map((step, index) => {
    const palette = workflowPalette[index % workflowPalette.length];
    const normalizedName = step.name.toLowerCase();
    const resource = normalizedName.includes('approval')
      ? 'Approvals'
      : normalizedName.includes('payment') || normalizedName.includes('closure')
        ? 'Payment Processing'
        : 'Payments';
    return {
      href: `/recurring-payments/stage/${step.id}`,
      label: step.name,
      resource,
      icon: palette.icon,
      color: palette.color,
      bg: palette.bg,
      group: 'workflow',
    };
  });

  const navItems = [...coreItems, ...workflowItems, ...managementItems].filter(
    (item) =>
      can('View', `Recurring Payments.${item.resource}`) ||
      (['Approvals', 'Payment Processing'].includes(item.resource) &&
        can('View', 'Recurring Payments.Payments')),
  );
  const canViewModule = can('View Module', 'Recurring Payments');
  const currentPageAllowed = safePathname.startsWith('/recurring-payments/settings/workflow')
    ? can('View Workflow', 'Recurring Payments.Settings')
    : navItems.some((item) => matchesPath(safePathname, item.href));

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return navItems.map((item) => {
      const active = matchesPath(safePathname, item.href);
      const showDivider = item.group !== lastGroup && lastGroup !== '';
      lastGroup = item.group;
      const Icon = item.icon;

      return (
        <div key={item.href}>
          {showDivider && <div className="my-1 h-px bg-white/40" />}
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-200 lg:py-2',
              active
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg),
              )}
            >
              <Icon
                className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  active ? 'scale-110 text-white' : item.color,
                )}
              />
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        </div>
      );
    });
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You do not have permission to access Recurring Payments.</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <ShieldAlert className="h-14 w-14 text-destructive" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const pageAccessDenied = (
    <Card className="border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
      <CardContent className="space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
        <div>
          <p className="font-semibold text-slate-800">Access denied</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You do not have permission to view this Recurring Payments page.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Contact your administrator to request access.
          </p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="recurring-payments-theme relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40" />
        <div className="absolute left-[8%] top-[8%] h-56 w-56 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="absolute bottom-[6%] right-[10%] h-64 w-64 rounded-full bg-teal-300/20 blur-3xl" />
      </div>

      <div className="mb-3 lg:hidden">
        <Card className="border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
          <CardContent className="flex items-center gap-3 px-3 py-2.5">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" className="h-10 shrink-0 gap-2 bg-white/90 px-3 text-sm font-medium">
                  <Menu className="h-4 w-4" /> Menu
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="z-[60] flex w-[88vw] max-w-[300px] flex-col border-r border-slate-200 bg-slate-50 p-0"
              >
                <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow">
                      <Repeat2 className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">Recurring Payments</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">
                  {navigationLinks(() => setMobileMenuOpen(false))}
                </div>
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                <Repeat2 className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight tracking-tight">Recurring Payments</p>
                <p className="text-[11px] leading-tight text-muted-foreground">Bill &amp; Workflow Manager</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
            <div className="border-b border-white/50 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-sm">
                  <Repeat2 className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Recurring Payments</p>
                  <p className="text-[11px] text-muted-foreground">Bill &amp; Workflow Manager</p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">
              {navigationLinks()}
            </CardContent>
          </Card>
        </aside>

        <main className="recurring-payments-content min-w-0">
          {currentPageAllowed ? children : pageAccessDenied}
        </main>
      </div>
    </div>
  );
}
