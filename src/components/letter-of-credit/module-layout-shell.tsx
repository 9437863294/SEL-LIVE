'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
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
  LayoutList,
  Link2,
  Menu,
  PencilRuler,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const canViewModule = can('View Module', LC_PERMISSION_MODULE) || sections.some((section) => can('View', `${LC_PERMISSION_MODULE}.${section.resource}`));
  const visibleSections = sections.filter((section) => canViewModule && (section.resource === 'Dashboard' || can('View', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Add', `${LC_PERMISSION_MODULE}.${section.resource}`) || can('Request', `${LC_PERMISSION_MODULE}.${section.resource}`)));

  const links = (onNavigate?: () => void) => visibleSections.map((section) => {
    const active = pathname === section.href || (section.href !== '/letter-of-credit' && pathname.startsWith(section.href));
    const Icon = section.icon;
    return (
      <Link key={section.href} href={section.href} onClick={onNavigate} className={cn('group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all', active ? 'bg-gradient-to-r from-cyan-600 to-blue-700 text-white shadow-md' : 'text-slate-600 hover:bg-white hover:text-slate-950')}>
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white/20 text-white' : section.tone)}><Icon className="h-3.5 w-3.5" /></span>
        <span className="truncate">{section.label}</span>
      </Link>
    );
  });

  if (isLoading) return <div className="min-h-[50vh]" />;
  if (!canViewModule) return <div className="w-full p-6"><Card><CardHeader><CardTitle>Access Denied</CardTitle><CardDescription>You do not have permission to access Letter of Credit Management.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive" /></CardContent></Card></div>;

  return (
    <div className="relative w-full px-4 py-5 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl bg-gradient-to-br from-cyan-50/70 via-white to-blue-50/60" />
      <div className="mb-3 lg:hidden">
        <Card className="border-white/80 bg-white/90"><CardContent className="flex items-center justify-between px-4 py-3"><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BookOpenCheck className="h-4 w-4 text-white" /></div><div><p className="text-sm font-semibold">Letter of Credit</p><p className="text-xs text-muted-foreground">Trade Finance Control</p></div></div><Sheet open={mobileOpen} onOpenChange={setMobileOpen}><SheetTrigger asChild><Button size="sm" variant="outline"><Menu className="mr-1.5 h-4 w-4" />Menu</Button></SheetTrigger><SheetContent side="left" className="w-[88vw] max-w-[330px] bg-slate-50/95 p-0"><SheetHeader className="border-b px-4 py-4 text-left"><SheetTitle>Letter of Credit Management</SheetTitle><SheetDescription>Navigate across the LC lifecycle</SheetDescription></SheetHeader><div className="max-h-[calc(100vh-90px)] space-y-1 overflow-y-auto p-2 pb-8">{links(() => setMobileOpen(false))}</div></SheetContent></Sheet></CardContent></Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:items-start">
        <aside className="hidden lg:sticky lg:top-20 lg:block"><Card className="overflow-hidden border-white/80 bg-white/90 shadow-sm"><div className="border-b bg-gradient-to-r from-cyan-500/10 to-blue-500/5 px-4 py-3"><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-600 to-blue-700"><BookOpenCheck className="h-4 w-4 text-white" /></div><div><p className="text-sm font-semibold text-slate-800">Letter of Credit</p><p className="text-[11px] text-muted-foreground">Trade Finance Control</p></div></div></div><CardContent className="max-h-[calc(100vh-12rem)] space-y-1 overflow-y-auto p-2">{links()}</CardContent></Card></aside>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
