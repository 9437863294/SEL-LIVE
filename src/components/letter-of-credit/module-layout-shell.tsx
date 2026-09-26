'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode } from 'react';
import {
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ClipboardCheck,
  FileArchive,
  FileDown,
  FilePlus2,
  FileSearch,
  FileText,
  Landmark,
  LayoutDashboard,
  LayoutList,
  Link2,
  PencilRuler,
  Plus,
  ReceiptIndianRupee,
  Settings2,
  ShieldAlert,
  Ship,
  Undo2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useAuthorization } from '@/hooks/useAuthorization';
import { LC_PERMISSION_MODULE } from '@/lib/letter-of-credit';
import { ModuleBottomNav, type ModuleNavTab } from '@/components/navigation/ModuleBottomNav';
import { SIDEBAR_ICONS_GRID, SidebarNavTooltip, useSidebarIconsOnly } from '@/components/navigation/use-sidebar-mode';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type Section = { href: string; label: string; resource: string; icon: LucideIcon; tone: string };

const sections: Section[] = [
  { href: '/letter-of-credit', label: 'LC Dashboard', resource: 'Dashboard', icon: BarChart3, tone: 'bg-cyan-50 text-cyan-700' },
  { href: '/letter-of-credit/new', label: 'New LC Request', resource: 'LC Requests', icon: FilePlus2, tone: 'bg-emerald-50 text-emerald-700' },
  { href: '/letter-of-credit/register', label: 'LC Register', resource: 'LC Register', icon: LayoutList, tone: 'bg-blue-50 text-blue-700' },
  { href: '/letter-of-credit/approvals', label: 'Pending Approvals', resource: 'Pending Approvals', icon: ClipboardCheck, tone: 'bg-violet-50 text-violet-700' },
  { href: '/letter-of-credit/opening', label: 'LC Opening', resource: 'LC Opening', icon: Landmark, tone: 'bg-indigo-50 text-indigo-700' },
  { href: '/letter-of-credit/hundis', label: 'Hundis & Bills', resource: 'Hundis & Bills', icon: ReceiptIndianRupee, tone: 'bg-amber-50 text-amber-800' },
  { href: '/letter-of-credit/documents', label: 'Shipments & Documents', resource: 'Shipment & Documents', icon: Ship, tone: 'bg-sky-50 text-sky-700' },
  { href: '/letter-of-credit/due-calendar', label: 'Payment Due Calendar', resource: 'Payment Due Calendar', icon: CalendarClock, tone: 'bg-orange-50 text-orange-700' },
  { href: '/letter-of-credit/payments', label: 'Payment Processing', resource: 'Payment Processing', icon: WalletCards, tone: 'bg-rose-50 text-rose-700' },
  { href: '/letter-of-credit/amendments', label: 'LC Amendments', resource: 'LC Amendments', icon: PencilRuler, tone: 'bg-fuchsia-50 text-fuchsia-700' },
  { href: '/letter-of-credit/vendor-settlement', label: 'Vendor Settlement', resource: 'Vendor Settlement', icon: UsersRound, tone: 'bg-teal-50 text-teal-700' },
  { href: '/letter-of-credit/client-recovery', label: 'Client Recovery', resource: 'Client Recovery', icon: Undo2, tone: 'bg-lime-50 text-lime-700' },
  { href: '/letter-of-credit/margins', label: 'Margin & FD Linkage', resource: 'Margin & FD Linkage', icon: Link2, tone: 'bg-cyan-50 text-cyan-700' },
  { href: '/letter-of-credit/closures', label: 'LC Closure', resource: 'LC Closure', icon: FileArchive, tone: 'bg-slate-100 text-slate-700' },
  { href: '/letter-of-credit/reports', label: 'Reports', resource: 'Reports', icon: FileText, tone: 'bg-blue-50 text-blue-700' },
  { href: '/letter-of-credit/import', label: 'Import & Reconcile', resource: 'Import & Reconciliation', icon: FileDown, tone: 'bg-emerald-50 text-emerald-700' },
  { href: '/letter-of-credit/settings', label: 'Settings', resource: 'Settings', icon: Settings2, tone: 'bg-slate-100 text-slate-700' },
];

export default function LetterOfCreditLayoutShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '';
  const { can, isLoading } = useAuthorization();
  const iconsOnly = useSidebarIconsOnly();
  const canViewModule = can('View Module', LC_PERMISSION_MODULE) || sections.some((section) => can('View', `${LC_PERMISSION_MODULE}.${section.resource}`));
  const visibleSections = sections.filter((section) => canViewModule && (section.resource === 'Dashboard' || can('View', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Add', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Request', `${LC_PERMISSION_MODULE}.${section.resource}`)));

  // The phone's bottom bar: the dashboard, the register, raising an LC request in the middle,
  // approvals, and "More" opening the pop-up of every page. Each tab only if its menu entry is visible too.
  const isVisible = (href: string) => visibleSections.some((section) => section.href === href);
  const bottomTabs: ModuleNavTab[] = [
    { href: '/letter-of-credit', label: 'Home', icon: LayoutDashboard, match: (path) => path === '/letter-of-credit' || path === '/letter-of-credit/dashboard' },
    ...(isVisible('/letter-of-credit/register') ? [{ href: '/letter-of-credit/register', label: 'Register', icon: LayoutList }] : []),
    ...(can('Add', `${LC_PERMISSION_MODULE}.LC Requests`)
      ? [{ href: '/letter-of-credit/new', label: 'New', icon: Plus, emphasized: true, ariaLabel: 'New letter of credit request' }]
      : []),
    ...(isVisible('/letter-of-credit/approvals') ? [{ href: '/letter-of-credit/approvals', label: 'Approvals', icon: ClipboardCheck }] : []),
  ];

  // `compact` is the desktop sidebar in icons mode.
  const links = (compact = false) => visibleSections.map((section) => {
    const active = pathname === section.href || (section.href !== '/letter-of-credit' && pathname.startsWith(section.href));
    const Icon = section.icon;
    return (
      <SidebarNavTooltip key={section.href} label={section.label} enabled={compact}>
        <Link href={section.href} aria-current={active ? 'page' : undefined} title={compact ? section.label : undefined} className={cn('group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all', active ? 'bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-md' : 'text-slate-600 hover:bg-white hover:text-slate-950', compact && 'relative justify-center')}>
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white/20 text-white' : section.tone)}><Icon className="h-3.5 w-3.5" /></span>
          <span className={compact ? 'sr-only' : 'truncate'}>{section.label}</span>
        </Link>
      </SidebarNavTooltip>
    );
  });

  if (isLoading) return <div className="min-h-[50vh]" />;
  if (!canViewModule) return <div className="w-full p-6"><Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access Letter of Credit Management.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card></div>;

  return (
    <div className="relative w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-50/70 via-white to-blue-50/60" />
      <div className="mb-3 lg:hidden">
        <Card className="border-white/80 bg-white/90"><CardContent className="flex items-center gap-2.5 px-4 py-3"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BookOpenCheck className="h-4 w-4 text-white" /></div><div><p className="text-sm font-semibold">Letter of Credit</p><p className="text-xs text-muted-foreground">Trade Finance Control</p></div></CardContent></Card>
      </div>
      <div className={`grid grid-cols-1 gap-4 ${iconsOnly ? SIDEBAR_ICONS_GRID : 'lg:grid-cols-[250px_minmax(0,1fr)]'} lg:items-start`}>
        <TooltipProvider delayDuration={150}><aside className="hidden lg:sticky lg:top-[calc(var(--app-header-offset,4rem)+1rem)] lg:block"><Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm"><div className={cn('border-b bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3', iconsOnly && 'px-2')} title={iconsOnly ? 'Letter of Credit' : undefined}><div className={cn('flex items-center gap-2.5', iconsOnly && 'justify-center')}><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BookOpenCheck className="h-4 w-4 text-white" /></div><div className={iconsOnly ? 'sr-only' : undefined}><p className="text-sm font-semibold text-slate-800">Letter of Credit</p><p className="text-[11px] text-muted-foreground">Trade Finance Control</p></div></div></div><CardContent className="max-h-[calc(100vh-var(--app-header-offset,4rem)-8rem)] space-y-1 overflow-y-auto p-2">{links(iconsOnly)}</CardContent></Card></aside></TooltipProvider>
        <main className="min-w-0">{children}</main>
      </div>

      <ModuleBottomNav tabs={bottomTabs} pages={visibleSections} moduleName="Letter of Credit" />
    </div>
  );
}
