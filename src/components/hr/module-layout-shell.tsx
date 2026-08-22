'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Banknote,
  Building2,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  FileText,
  FolderKanban,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Loader2,
  Menu,
  Settings,
  ShieldAlert,
  Sparkles,
  Target,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** The permission module name; must match the key in `permissionModules`. */
export const HR_PERMISSION_MODULE = 'HR & Recruitment';

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
 * Navigation grouped exactly as spec section 62 lays it out — Manpower, then Recruitment, then
 * Talent, then Reports and Settings — which is also the order a vacancy actually travels. Dividers
 * are drawn wherever `group` changes.
 */
const navItems: NavItem[] = [
  { href: '/hr', label: 'HR Dashboard', resource: 'Dashboard', icon: LayoutDashboard, color: 'text-indigo-600', bg: 'bg-indigo-50', group: 'overview' },
  { href: '/hr/tasks', label: 'My HR Tasks', resource: 'Dashboard', icon: ListChecks, color: 'text-violet-600', bg: 'bg-violet-50', group: 'overview' },

  { href: '/hr/manpower/planning', label: 'Manpower Planning', resource: 'Manpower Planning', icon: Target, color: 'text-sky-600', bg: 'bg-sky-50', group: 'manpower' },
  { href: '/hr/requirements', label: 'Requirement Register', resource: 'Requirements', icon: ClipboardList, color: 'text-blue-600', bg: 'bg-blue-50', group: 'manpower' },
  { href: '/hr/approvals', label: 'Approval Inbox', resource: 'Approvals', icon: ClipboardCheck, color: 'text-amber-600', bg: 'bg-amber-50', group: 'manpower' },
  { href: '/hr/manpower/project', label: 'Project Manpower', resource: 'Project Manpower', icon: Building2, color: 'text-cyan-600', bg: 'bg-cyan-50', group: 'manpower' },

  { href: '/hr/candidates', label: 'Candidate Database', resource: 'Candidates', icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'recruitment' },
  { href: '/hr/pipeline', label: 'Recruitment Pipeline', resource: 'Pipeline', icon: FolderKanban, color: 'text-teal-600', bg: 'bg-teal-50', group: 'recruitment' },
  { href: '/hr/interviews', label: 'Interviews', resource: 'Interviews', icon: CalendarCheck, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', group: 'recruitment' },
  { href: '/hr/interviews/my', label: 'My Interviews', resource: 'My Interviews', icon: UserRound, color: 'text-purple-600', bg: 'bg-purple-50', group: 'recruitment' },
  { href: '/hr/selection', label: 'Selection', resource: 'Selection', icon: BadgeCheck, color: 'text-lime-600', bg: 'bg-lime-50', group: 'recruitment' },
  { href: '/hr/offers', label: 'Offers', resource: 'Offers', icon: FileSignature, color: 'text-orange-600', bg: 'bg-orange-50', group: 'recruitment' },
  { href: '/hr/pre-joining', label: 'Pre-Joining', resource: 'Pre-Joining', icon: FileText, color: 'text-rose-600', bg: 'bg-rose-50', group: 'recruitment' },
  { href: '/hr/joining', label: 'Joining', resource: 'Joining', icon: UserPlus, color: 'text-green-600', bg: 'bg-green-50', group: 'recruitment' },

  { href: '/hr/talent-pool', label: 'Talent Pool', resource: 'Talent Pool', icon: Sparkles, color: 'text-yellow-600', bg: 'bg-yellow-50', group: 'talent' },
  { href: '/hr/referrals', label: 'Employee Referrals', resource: 'Referrals', icon: Handshake, color: 'text-pink-600', bg: 'bg-pink-50', group: 'talent' },
  { href: '/hr/agencies', label: 'Recruitment Agencies', resource: 'Agencies', icon: Banknote, color: 'text-slate-600', bg: 'bg-slate-50', group: 'talent' },

  { href: '/hr/reports', label: 'Reports', resource: 'Reports', icon: FileText, color: 'text-stone-600', bg: 'bg-stone-50', group: 'reports' },
  { href: '/hr/settings', label: 'Settings', resource: 'Settings', icon: Settings, color: 'text-zinc-600', bg: 'bg-zinc-50', group: 'settings' },
];

/**
 * Two screens are open to anyone who can see the module, for the same reason the travel module opens
 * "My Travel" to everyone: an interviewer has to reach their own feedback form and an employee has to
 * reach the referral form (spec sections 25, 46), and those are exactly the people a
 * recruitment-register permission would never be granted to.
 */
const ALWAYS_VISIBLE = ['/hr/interviews/my', '/hr/referrals'];

function matchesPath(pathname: string, href: string) {
  if (href === '/hr') return pathname === href || pathname === '/hr/dashboard';
  // 'My Interviews' sits under the interviews prefix, so the parent must not swallow it.
  if (href === '/hr/interviews') return pathname === href || /^\/hr\/interviews\/(?!my)/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function HrLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const safePathname = pathname || '';
  const { can, isLoading: authLoading } = useAuthorization();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleItems = useMemo(
    () =>
      navItems.filter(item => {
        if (item.href === '/hr' || ALWAYS_VISIBLE.includes(item.href)) return true;
        return can('View', `${HR_PERMISSION_MODULE}.${item.resource}`);
      }),
    [can],
  );

  const canViewModule = can('View Module', HR_PERMISSION_MODULE);
  const currentPageAllowed =
    // The requirement wizard and the workspace sit under routes the register permission covers by
    // prefix; 'My HR Tasks' is a view of work the user already has permission to act on.
    safePathname === '/hr/tasks' ||
    ALWAYS_VISIBLE.some(href => safePathname.startsWith(href)) ||
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
                ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)]'
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
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!canViewModule) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You do not have permission to access HR &amp; Recruitment.</CardDescription>
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
    // `hr-module-root` carries the module's mobile rules (44px tap targets, scrollable tab strips,
    // safe-area padding, compact card padding) — see globals.css.
    <div className="hr-theme hr-module-root relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/60 via-white to-violet-50/40" />
        <div className="absolute left-[8%] top-[8%] h-56 w-56 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="absolute bottom-[6%] right-[10%] h-64 w-64 rounded-full bg-violet-300/20 blur-3xl" />
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
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow">
                      <Users className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm font-semibold">HR &amp; Recruitment</SheetTitle>
                      <SheetDescription className="text-[11px]">Tap a section to navigate</SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-2 pb-8">{navigationLinks(() => setMobileMenuOpen(false))}</div>
              </SheetContent>
            </Sheet>

            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                <Users className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight tracking-tight">HR &amp; Recruitment</p>
                <p className="text-[11px] leading-tight text-muted-foreground">Manpower &amp; Recruitment Control</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block">
          <Card className="overflow-hidden border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
            <div className="border-b border-white/50 bg-gradient-to-r from-indigo-500/10 to-violet-500/5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
                  <Users className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold tracking-tight text-slate-800">HR &amp; Recruitment</p>
                  <p className="text-[11px] text-muted-foreground">Manpower &amp; Recruitment Control</p>
                </div>
              </div>
            </div>
            <CardContent className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">{navigationLinks()}</CardContent>
          </Card>
        </aside>

        <main className="hr-content min-w-0">{currentPageAllowed ? children : pageAccessDenied}</main>
      </div>
    </div>
  );
}
