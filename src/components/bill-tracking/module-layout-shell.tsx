'use client';

/**
 * Bill Tracking's module frame: sidebar on desktop, header and bottom bar on a phone, following the
 * Recurring Payments shell so the finance modules feel like one product.
 *
 * Access is decided by the server: the shell loads `/api/bill-tracking/lookups`, which refuses a user
 * without the module, and returns the user's permissions with project scope already applied. Each
 * page is listed only if that permission is held, and a page reached by URL without it is refused
 * here as well as by its API.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Clock,
  FileSpreadsheet,
  Hourglass,
  LayoutDashboard,
  Loader2,
  PiggyBank,
  Plus,
  ReceiptIndianRupee,
  Scissors,
  Settings,
  ShieldAlert,
  Target,
  Upload,
  UserCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { ModuleMobileHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { BillTrackingProvider, useBt } from './bt-client';

type NavItem = { href: string; label: string; resource: string; action?: string; icon: LucideIcon; color: string; bg: string; group: string };

const NAV: NavItem[] = [
  { href: '/bill-tracking/dashboard', label: 'Dashboard', resource: 'Dashboard', icon: LayoutDashboard, color: 'text-emerald-600', bg: 'bg-emerald-50', group: 'overview' },
  { href: '/bill-tracking/bills', label: 'Bill Register', resource: 'Bills', icon: ReceiptIndianRupee, color: 'text-blue-600', bg: 'bg-blue-50', group: 'bills' },
  { href: '/bill-tracking/outstanding', label: 'Outstanding', resource: 'Bills', icon: Clock, color: 'text-rose-600', bg: 'bg-rose-50', group: 'bills' },
  { href: '/bill-tracking/collections', label: 'Collections', resource: 'Collections', icon: Wallet, color: 'text-teal-600', bg: 'bg-teal-50', group: 'bills' },
  { href: '/bill-tracking/ageing', label: 'Ageing', resource: 'Reports', icon: Hourglass, color: 'text-amber-600', bg: 'bg-amber-50', group: 'control' },
  { href: '/bill-tracking/retention', label: 'Retention', resource: 'Retention', icon: PiggyBank, color: 'text-violet-600', bg: 'bg-violet-50', group: 'control' },
  { href: '/bill-tracking/deductions', label: 'Deductions', resource: 'Reports', icon: Scissors, color: 'text-orange-600', bg: 'bg-orange-50', group: 'control' },
  { href: '/bill-tracking/targets', label: 'Targets & Forecast', resource: 'Targets', icon: Target, color: 'text-sky-600', bg: 'bg-sky-50', group: 'control' },
  { href: '/bill-tracking/reports', label: 'Reports', resource: 'Reports', icon: BarChart3, color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', group: 'insights' },
  { href: '/bill-tracking/import', label: 'Excel Import', resource: 'Import', icon: Upload, color: 'text-indigo-600', bg: 'bg-indigo-50', group: 'data' },
  { href: '/bill-tracking/settings', label: 'Settings', resource: 'Settings', icon: Settings, color: 'text-slate-600', bg: 'bg-slate-50', group: 'data' },
];

const GROUP_LABELS: Record<string, string> = { overview: 'Overview', bills: 'Bills & Collections', control: 'Control', insights: 'Insights', data: 'Data & Settings' };

const matchesPath = (pathname: string, href: string) =>
  href === '/bill-tracking/dashboard' ? pathname === '/bill-tracking' || pathname.startsWith(href) : pathname === href || pathname.startsWith(`${href}/`);

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { lookups, loading, error, reload, can } = useBt();
  const iconsOnly = useSidebarIconsOnly();

  if (loading && !lookups) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    );
  }
  if (!lookups) {
    return (
      <div className="w-full p-6">
        <Card>
          <CardContent className="space-y-3 py-14 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
            <p className="font-semibold text-slate-800">Bill Tracking is not available</p>
            <p className="text-sm text-muted-foreground">{error ?? 'You do not have access to Bill Tracking.'}</p>
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Named on a Settings → Workflow stage: their queue, whatever their role permissions.
  const waitingItem: NavItem = { href: '/bill-tracking/bills?mine=1', label: 'Waiting for me', resource: 'Bills', icon: UserCheck, color: 'text-emerald-700', bg: 'bg-emerald-50', group: 'overview' };
  const navItems = [...(lookups.workflowAssigned ? [waitingItem] : []), ...NAV.filter((item) => can(item.resource, item.action ?? 'View'))];
  const pageAllowed = navItems.some((item) => matchesPath(pathname, item.href.split('?')[0]));
  const isVisible = (href: string) => navItems.some((item) => item.href === href);
  const bottomTabs: ModuleNavTab[] = [
    ...(isVisible('/bill-tracking/dashboard') ? [{ href: '/bill-tracking/dashboard', label: 'Home', icon: LayoutDashboard, match: (path: string) => matchesPath(path, '/bill-tracking/dashboard') }] : []),
    ...(isVisible('/bill-tracking/bills') ? [{ href: '/bill-tracking/bills', label: 'Bills', icon: ReceiptIndianRupee, exact: true }] : []),
    ...(can('Collections', 'Add') ? [{ href: '/bill-tracking/collections/new', label: 'Receive', icon: Plus, emphasized: true, ariaLabel: 'Record a receipt' }] : []),
    ...(isVisible('/bill-tracking/outstanding') ? [{ href: '/bill-tracking/outstanding', label: 'Outstanding', icon: Clock }] : []),
    ...(isVisible('/bill-tracking/import') ? [{ href: '/bill-tracking/import', label: 'Import', icon: FileSpreadsheet }] : []),
  ];

  const links = (compact: boolean) => {
    let lastGroup = '';
    return navItems.map((item) => {
      const active = matchesPath(pathname, item.href);
      const divider = item.group !== lastGroup && lastGroup !== '';
      lastGroup = item.group;
      const Icon = item.icon;
      return (
        <div key={item.href}>
          {divider && <div className="my-1 h-px bg-white/40" />}
          <SidebarNavTooltip label={item.label} enabled={compact}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={compact ? item.label : undefined}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-all duration-200 lg:py-2',
                active ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.5)]' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                compact && 'justify-center',
              )}
            >
              <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200', active ? 'bg-white/20' : cn('group-hover:scale-105', item.bg))}>
                <Icon className={cn('h-3.5 w-3.5', active ? 'text-white' : item.color)} />
              </span>
              <span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
            </Link>
          </SidebarNavTooltip>
        </div>
      );
    });
  };

  return (
    <div className="bill-tracking-theme relative w-full px-3 py-4 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-50/60 via-white to-teal-50/40" />
      </div>

      <ModuleMobileHeader icon={ReceiptIndianRupee} title="Bill Tracking" subtitle={lookups.allProjects ? 'All projects' : `${lookups.projects.length} assigned project${lookups.projects.length === 1 ? '' : 's'}`} hideFrom="lg" className="print:hidden" />

      <div className={cn('grid grid-cols-1 gap-4 lg:items-start', iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[230px_minmax(0,1fr)]')}>
        <TooltipProvider delayDuration={150}>
          <aside className="hidden print:hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block">
            <Card className="overflow-hidden border border-white/60 bg-white/80 shadow-sm backdrop-blur-sm">
              <div className={cn('border-b border-white/50 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 px-4 py-3', iconsOnly && 'px-2')} title={iconsOnly ? 'Bill Tracking' : undefined}>
                <div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 shadow-sm">
                    <ReceiptIndianRupee className="h-4 w-4 text-white" />
                  </div>
                  <div className={iconsOnly ? 'sr-only' : undefined}>
                    <p className="text-sm font-semibold tracking-tight text-slate-800">Bill Tracking</p>
                    <p className="text-[11px] text-muted-foreground">Billing &amp; Collections</p>
                  </div>
                </div>
              </div>
              <CardContent className="max-h-[calc(100vh-var(--app-header-offset,4rem)-8rem)] overflow-y-auto p-2">{links(iconsOnly)}</CardContent>
            </Card>
          </aside>
        </TooltipProvider>

        <TooltipProvider delayDuration={200}>
          <main className="min-w-0 space-y-4">
            {pageAllowed ? (
              children
            ) : (
              <Card className="border-white/60 bg-white/80 shadow-sm">
                <CardContent className="space-y-2 py-16 text-center">
                  <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
                  <p className="font-semibold text-slate-800">Access denied</p>
                  <p className="text-sm text-muted-foreground">You do not have permission to view this Bill Tracking page. Contact your administrator to request access.</p>
                </CardContent>
              </Card>
            )}
          </main>
        </TooltipProvider>
      </div>

      <ModuleBottomNav tabs={bottomTabs} pages={navItems} groupLabels={GROUP_LABELS} moduleName="Bill Tracking" />
    </div>
  );
}

export default function BillTrackingLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <BillTrackingProvider>
      <Shell>{children}</Shell>
    </BillTrackingProvider>
  );
}
