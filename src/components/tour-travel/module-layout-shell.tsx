'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  Loader2,
  Menu,
  Plane,
  ReceiptIndianRupee,
  Settings,
  ShieldAlert,
  Undo2,
  UserRound,
  Wallet,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** The permission module name; must match the key in `permissionModules`. */
export const TT_PERMISSION_MODULE = 'Tour, Travel & Expense';

type NavItem = {
  href: string;
  label: string;
  resource: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  group: string;
};

/**
 * Navigation for the module, grouped in the order a tour actually moves: what's mine, what needs a
 * decision, where the money is, then configuration. Dividers are drawn wherever `group` changes.
 */
const navItems: NavItem[] = [
  { href: '/tour-travel', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, color: 'text-sky-600', bg: 'bg-sky-50', group: 'overview' },
  { href: '/tour-travel/my-travel', label: 'My Travel', resource: 'Tour Requests', icon: UserRound, color: 'text-cyan-600', bg: 'bg-cyan-50', group: 'overview' },

  { href: '/tour-travel/requests', label: 'Tour Requests', resource: 'Tour Requests', icon: Plane, color: 'text-blue-600', bg: 'bg-blue-50', group: 'tours' },

  { href: '/tour-travel/approvals', label: 'Approvals', resource: 'Approvals', icon: ClipboardCheck, color: 'text-amber-600', bg: 'bg-amber-50', group: 'control' },

  { href: '/tour-travel/advances', label: 'Travel Advances', resource: 'Advances', icon: Wallet, color: 'text-violet-600', bg: 'bg-violet-50', group: 'money' },
  { href: '/tour-travel/claims', label: 'Expense Claims', resource: 'Claims', icon: ReceiptIndianRupee, color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'money' },
  { href: '/tour-travel/payments', label: 'Reimbursements', resource: 'Payments', icon: Coins, color: 'text-teal-600', bg: 'bg-teal-50', group: 'money' },
  { href: '/tour-travel/recoveries', label: 'Recoveries', resource: 'Recoveries', icon: Undo2, color: 'text-rose-600', bg: 'bg-rose-50', group: 'money' },

  { href: '/tour-travel/settings', label: 'Settings', resource: 'Settings', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-50', group: 'settings' },
];
// Travel Desk (bookings), Travel Calendar and Reports are Phase 2/3 of the module plan; their
// permission resources already exist in `permissionModules` so the routes can be added without a
// role migration, but they are kept out of the nav until they're built rather than shipped as
// links to nothing.

function matchesPath(pathname: string, href: string) {
  if (href === '/tour-travel') return pathname === href || pathname === '/tour-travel/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function TourTravelLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  /**
   * Every employee needs their own travel, whatever their role — a module that only opened for
   * permission holders would make expense claims unreachable for exactly the people who file them.
   * So "My Travel" and the request form are available to anyone who can see the module at all, and
   * the role check governs the organization-wide registers instead.
   */
  const visibleItems = useMemo(
    () =>
      navItems.filter(item => {
        if (item.href === '/tour-travel' || item.href === '/tour-travel/my-travel') return true;
        return can('View', `${TT_PERMISSION_MODULE}.${item.resource}`);
      }),
    [can],
  );

  const canViewModule = can('View Module', TT_PERMISSION_MODULE);
  const currentPageAllowed =
    // The tour request form and a user's own records sit under routes the register permission
    // doesn't cover, so they're matched by prefix rather than by an exact nav entry.
    safePathname.startsWith('/tour-travel/my-travel') ||
    safePathname === '/tour-travel/requests/new' ||
    visibleItems.some(item => matchesPath(safePathname, item.href));

  const navigationLinks = (onNavigate?: () => void) => {
    let lastGroup = '';
    return visibleItems.map(item => {
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
                ? 'bg-gradient-to-r from-sky-500 to-cyan-600 text-white shadow-[0_8px_24px_-8px_rgba(14,165,233,0.5)]'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
            )}
          >
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg),
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'scale-110 text-white' : item.color)} />
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
        <Loader2 className="h-7 w-7 animate-spin text-sky-600" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You do not have permission to access Tour, Travel &amp; Expense.</CardDescription>
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
          <p className="mt-1 text-sm text-muted-foreground">You do not have permission to view this page.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Contact your administrator to request access.</p>
        </div>
      </CardContent>
    </Card>
  );

  return (
    // `tt-module-root` carries the module's mobile rules (44px tap targets, scrollable tab strips,
    // safe-area padding, compact card padding) — see globals.css.
    <div className="tour-travel-theme tt-module-root relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-50/60 via-white to-cyan-50/40" />
        <div className="absolute left-[8%] top-[8%] h-56 w-56 rounded-full bg-sky-300/20 blur-3xl" />
        <div className="absolute bottom-[6%] right-[10%] h-64 w-64 rounded-full bg-cyan-300/20 blur-3xl" />
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
              <SheetContent side="left" className="z-[60] flex w-[88vw] max-w-[300px] flex-col border-r border-slate-200 bg-slate-50 p-0">
                <SheetHeader className="shrink-0 border-b border-slate-200/60 px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 shadow">
                      <Plane className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">Tour &amp; Travel</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{navigationLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sm">
                <Plane className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight tracking-tight">Tour &amp; Travel</p>
                <p className="text-[11px] leading-tight text-muted-foreground">Travel &amp; Expense Manager</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
            <div className="border-b border-white/50 bg-gradient-to-r from-sky-500/10 to-cyan-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 shadow-sm">
                  <Plane className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">Tour &amp; Travel</p>
                  <p className="text-[11px] text-muted-foreground">Travel &amp; Expense Manager</p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">{navigationLinks()}</CardContent>
          </Card>
        </aside>

        <main className="tour-travel-content min-w-0">{currentPageAllowed ? children : pageAccessDenied}</main>
      </div>
    </div>
  );
}
