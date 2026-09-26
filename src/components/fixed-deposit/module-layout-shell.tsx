'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  BadgeIndianRupee,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FilePlus2,
  FileDown,
  FileText,
  FileUp,
  Landmark,
  LayoutDashboard,
  ListTree,
  Menu,
  Plus,
  RefreshCcw,
  Replace,
  Settings2,
  ShieldAlert,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Section = { href: string; label: string; resource: string; icon: LucideIcon; color: string; bg: string };

const sections: Section[] = [
  { href: '/fixed-deposit', label: 'Dashboard', resource: 'Dashboard', icon: BarChart3, color: 'text-cyan-700', bg: 'bg-cyan-50' },
  { href: '/fixed-deposit/new', label: 'Create New FD', resource: 'FD Register', icon: FilePlus2, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { href: '/fixed-deposit/register', label: 'FD Register', resource: 'FD Register', icon: ListTree, color: 'text-blue-700', bg: 'bg-blue-50' },
  { href: '/fixed-deposit/maturity-calendar', label: 'Maturity Calendar', resource: 'Maturity Calendar', icon: CalendarClock, color: 'text-amber-700', bg: 'bg-amber-50' },
  { href: '/fixed-deposit/available', label: 'Available FDs', resource: 'Available FDs', icon: CheckCircle2, color: 'text-teal-700', bg: 'bg-teal-50' },
  { href: '/fixed-deposit/assignments', label: 'BG / LC Assignments', resource: 'Assignments', icon: Landmark, color: 'text-indigo-700', bg: 'bg-indigo-50' },
  { href: '/fixed-deposit/renewals', label: 'Renewals', resource: 'Renewals', icon: RefreshCcw, color: 'text-sky-700', bg: 'bg-sky-50' },
  { href: '/fixed-deposit/closures', label: 'Closures', resource: 'Closures', icon: Replace, color: 'text-rose-700', bg: 'bg-rose-50' },
  { href: '/fixed-deposit/releases', label: 'Assignment Releases', resource: 'Releases', icon: Unlink, color: 'text-orange-700', bg: 'bg-orange-50' },
  { href: '/fixed-deposit/approvals', label: 'Pending Approvals', resource: 'Approvals', icon: ClipboardCheck, color: 'text-violet-700', bg: 'bg-violet-50' },
  { href: '/fixed-deposit/reports', label: 'Reports', resource: 'Reports', icon: FileText, color: 'text-blue-700', bg: 'bg-blue-50' },
  { href: '/fixed-deposit/import', label: 'Import & Reconcile', resource: 'Import & Reconciliation', icon: FileUp, color: 'text-emerald-700', bg: 'bg-emerald-50' },
  { href: '/fixed-deposit/export', label: 'Export Centre', resource: 'FD Register', icon: FileDown, color: 'text-fuchsia-700', bg: 'bg-fuchsia-50' },
  { href: '/fixed-deposit/settings', label: 'Settings', resource: 'Settings', icon: Settings2, color: 'text-slate-700', bg: 'bg-slate-100' },
];

export default function FixedDepositLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const { can, isLoading } = useAuthorization();
  const [mobileOpen, setMobileOpen] = useState(false);
  const iconsOnly = useSidebarIconsOnly();
  const canViewModule = can('View Module', 'Fixed Deposit Management') || sections.some((item) => can('View', `Fixed Deposit Management.${item.resource}`));
  const visibleSections = sections.filter((item) => canViewModule && (item.resource === 'Dashboard' || can('View', `Fixed Deposit Management.${item.resource}`) || can('Add', `Fixed Deposit Management.${item.resource}`)));

  // The phone's bottom bar: the dashboard, the register, creating an FD in the middle, approvals,
  // and "More" opening the full menu. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) => visibleSections.some((item) => item.href === href);
  const bottomTabs: ModuleNavTab[] = [
    { href: '/fixed-deposit', label: 'Home', icon: LayoutDashboard, match: (path) => path === '/fixed-deposit' || path === '/fixed-deposit/dashboard' },
    ...(isVisible('/fixed-deposit/register') ? [{ href: '/fixed-deposit/register', label: 'Register', icon: ListTree }] : []),
    ...(can('Add', 'Fixed Deposit Management.FD Register')
      ? [{ href: '/fixed-deposit/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'Create new fixed deposit' }]
      : []),
    ...(isVisible('/fixed-deposit/approvals') ? [{ href: '/fixed-deposit/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  // `compact` is the desktop sidebar in icons mode; the phone sheet always passes labels.
  const links = (onNavigate?: () => void, compact = false) => visibleSections.map((item) => {
    const active = pathname === item.href || (item.href !== '/fixed-deposit' && pathname.startsWith(item.href));
    const Icon = item.icon;
    return <SidebarNavTooltip key={item.href} label={item.label} enabled={compact}><Link href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={compact ? item.label : undefined} className={cn('group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all', active ? 'bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-md' : 'text-slate-600 hover:bg-white/80 hover:text-slate-950', compact && 'relative justify-center')}>
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', active ? 'bg-white/20' : item.bg)}><Icon className={cn('h-3.5 w-3.5', active ? 'text-white' : item.color)} /></span><span className={compact ? 'sr-only' : 'truncate'}>{item.label}</span>
    </Link></SidebarNavTooltip>;
  });

  if (isLoading) return <div className="min-h-[50vh]" />;
  if (!canViewModule) return <div className="w-full p-6"><Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access Fixed Deposit Management.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card></div>;

  return <div className="relative w-full px-4 py-5 sm:px-6 lg:px-8">
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-50/70 via-white to-blue-50/60" />
    <div className="mb-3 lg:hidden"><Card className="border-white/80 bg-white/90"><CardContent className="flex items-center justify-between px-4 py-3"><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BadgeIndianRupee className="h-4 w-4 text-white" /></div><div><p className="text-sm font-semibold">Fixed Deposit Management</p><p className="text-xs text-muted-foreground">Treasury Control</p></div></div><Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger asChild><Button size="sm" variant="outline"><Menu className="mr-1.5 h-4 w-4" />Menu</Button></SheetTrigger><SheetContent side="left" className="w-[88vw] max-w-[320px] bg-slate-50/95 p-0"><SheetHeader className="border-b px-4 py-4 text-left"><SheetTitle>Fixed Deposit Management</SheetTitle><SheetDescription>Navigate between FD workspaces</SheetDescription></SheetHeader><div className="space-y-1 p-2">{links(() => setMobileOpen(false))}</div></SheetContent></Sheet></CardContent></Card></div>
    <div className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[240px_minmax(0,1fr)]'} lg:items-start`}>
      <TooltipProvider delayDuration={150}><aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block"><Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm"><div className={cn('border-b bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3', iconsOnly && 'px-2')} title={iconsOnly ? 'Fixed Deposits' : undefined}><div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BadgeIndianRupee className="h-4 w-4 text-white" /></div><div className={iconsOnly ? 'sr-only' : undefined}><p className="text-sm font-semibold text-slate-800">Fixed Deposits</p><p className="text-[11px] text-muted-foreground">Treasury Control</p></div></div></div><CardContent className="space-y-1 p-2">{links(undefined, iconsOnly)}</CardContent></Card></aside></TooltipProvider>
      <main className="min-w-0">{children}</main>
    </div>
    <ModuleBottomNav tabs={bottomTabs} onMore={() => setMobileOpen(true)} moduleName="Fixed Deposit Management" />
  </div>;
}
