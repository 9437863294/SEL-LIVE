'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleDollarSign, LayoutDashboard, ListChecks, Loader2, Repeat2, Settings, ShieldAlert, Tags, Users } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DEFAULT_RECURRING_WORKFLOW, type RecurringWorkflowStep } from '@/lib/recurring-payments';
import { useAuthorization } from '@/hooks/useAuthorization';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const items = [
  ['/recurring-payments', LayoutDashboard, 'Dashboard', 'Dashboard'],
  ['/recurring-payments/payments', ListChecks, 'All Payments', 'Payments'],
  ['/recurring-payments/upcoming', CalendarDays, 'Upcoming', 'Payments'],
  ['/recurring-payments/overdue', CircleDollarSign, 'Overdue', 'Payments'],
  ['/recurring-payments/masters', Repeat2, 'Recurring Masters', 'Recurring Masters'],
  ['/recurring-payments/vendors', Users, 'Vendors', 'Vendors'],
  ['/recurring-payments/categories', Tags, 'Categories', 'Categories'],
  ['/recurring-payments/reports', BarChart3, 'Reports', 'Reports'],
  ['/recurring-payments/settings', Settings, 'Settings', 'Settings'],
] as const;

export default function RecurringPaymentsLayoutShell({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<RecurringWorkflowStep[]>(DEFAULT_RECURRING_WORKFLOW);
  const pathname = usePathname();
  const { can, isLoading: authLoading } = useAuthorization();
  useEffect(()=>onSnapshot(doc(db,'workflows','recurring-payments-workflow'),snap=>{
    const steps=snap.data()?.steps as RecurringWorkflowStep[]|undefined;
    if(steps?.length)setWorkflowSteps(steps);
  }),[]);
  const navItems = [
    ...items.slice(0,4),
    ...workflowSteps.map(step=>[`/recurring-payments/stage/${step.id}`, ListChecks, step.name, 'Payments'] as const),
    ...items.slice(4),
  ].filter(([, , , resource]) => can('View', `Recurring Payments.${resource}`));
  const canViewModule = can('View Module', 'Recurring Payments');
  const safePathname = pathname || '';
  const currentPageAllowed = safePathname.startsWith('/recurring-payments/settings/workflow')
    ? can('View Workflow', 'Recurring Payments.Settings')
    : navItems.some(([href]) => href === '/recurring-payments' ? safePathname === href : safePathname.startsWith(href));
  if (authLoading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-indigo-600"/></div>;
  if (!canViewModule || !currentPageAllowed) return <div className="p-6"><Card><CardHeader><CardTitle>Access denied</CardTitle><CardDescription>You do not have permission to view this Recurring Payments page.</CardDescription></CardHeader><CardContent className="flex justify-center py-8"><ShieldAlert className="h-14 w-14 text-destructive"/></CardContent></Card></div>;
  return <div className="flex w-full min-h-screen">
    <aside className={cn('fixed left-0 top-16 z-40 flex h-[calc(100vh-4rem)] flex-col border-r bg-background/95 shadow-sm backdrop-blur transition-all', expanded ? 'w-60' : 'w-14')}>
      <div className={cn('flex items-center gap-2 border-b px-3 py-3', !expanded && 'justify-center')}><div className="rounded-lg bg-indigo-100 p-1.5"><Repeat2 className="h-4 w-4 text-indigo-600" /></div>{expanded && <span className="truncate text-sm font-semibold">Recurring Payments</span>}</div>
      <TooltipProvider delayDuration={0}><nav className="flex-1 space-y-1 overflow-y-auto p-2">{navItems.map(([href, Icon, label]) => {
        const active = href === '/recurring-payments' ? pathname === href : pathname?.startsWith(href);
        return <Tooltip key={href}><TooltipTrigger asChild><Link href={href} className={cn('flex items-center rounded-lg transition-colors', expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-2', active ? 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}><Icon className="h-4 w-4 shrink-0" />{expanded && <span className="truncate text-sm font-medium">{label}</span>}</Link></TooltipTrigger>{!expanded && <TooltipContent side="right">{label}</TooltipContent>}</Tooltip>;
      })}</nav></TooltipProvider>
      <button onClick={() => setExpanded(v => !v)} className="m-2 flex items-center justify-center gap-2 rounded-lg border p-2 text-sm text-muted-foreground hover:bg-muted">{expanded ? <><ChevronLeft className="h-4 w-4" /> Collapse</> : <ChevronRight className="h-4 w-4" />}</button>
    </aside>
    <main className={cn('min-w-0 flex-1 p-4 transition-all sm:p-6', expanded ? 'ml-60' : 'ml-14')}>{children}</main>
  </div>;
}
