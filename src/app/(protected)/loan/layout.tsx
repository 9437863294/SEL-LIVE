
'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { BarChart3, Briefcase, CalendarCheck, ChevronLeft, ChevronRight, CreditCard, LayoutDashboard, Plus } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthorization } from '@/hooks/useAuthorization';
import { usePathname } from 'next/navigation';

export default function LoanLayout({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { can } = useAuthorization();
  const pathname = usePathname();

  const navItems = [
    { href: '/loan', icon: LayoutDashboard, label: 'Dashboard', permission: can('View', 'Loan.Dashboard'), iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', activeGradient: 'from-emerald-500 to-teal-600', exact: true },
    { href: '/loan/manage', icon: Briefcase, label: 'Manage Loans', permission: can('View', 'Loan.Dashboard'), iconBg: 'bg-blue-100', iconColor: 'text-blue-600', activeGradient: 'from-blue-500 to-indigo-600' },
    { href: '/loan/emi-summary', icon: CalendarCheck, label: 'EMI Tracker', permission: can('View', 'Loan.Dashboard'), iconBg: 'bg-violet-100', iconColor: 'text-violet-600', activeGradient: 'from-violet-500 to-purple-600' },
    { href: '/loan/reports', icon: BarChart3, label: 'Reports', permission: can('View', 'Loan.Reports'), iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600', activeGradient: 'from-indigo-500 to-blue-600' },
  ].filter(i => i.permission);

  const isPrintPage = pathname?.includes('/print');
  if (isPrintPage) return <>{children}</>;

  function isActive(item: typeof navItems[0]) {
    if (item.exact) return pathname === item.href;
    return pathname?.startsWith(item.href) ?? false;
  }

  return (
    <div className="flex w-full h-full">
      <aside className={cn(
        'fixed left-0 top-16 h-[calc(100vh-4rem)] z-40 flex flex-col border-r border-border/60 bg-background/95 backdrop-blur-sm transition-all duration-300 shadow-sm',
        isExpanded ? 'w-56' : 'w-14',
      )}>
        <div className={cn('flex items-center gap-2 px-3 py-3 border-b border-border/40 shrink-0', !isExpanded && 'justify-center')}>
          <div className="rounded-lg bg-emerald-100 p-1.5 shrink-0">
            <CreditCard className="h-4 w-4 text-emerald-600" />
          </div>
          {isExpanded && <span className="text-sm font-semibold text-foreground/80 truncate">Loans</span>}
        </div>

        <TooltipProvider delayDuration={0}>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {navItems.map(item => {
              const active = isActive(item);
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <Link href={item.href}>
                      <div className={cn(
                        'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group',
                        isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                        active
                          ? cn('bg-gradient-to-r text-white shadow-sm', item.activeGradient)
                          : 'hover:bg-muted/40',
                      )}>
                        <div className={cn(
                          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200',
                          active ? 'bg-white/25' : cn(item.iconBg, 'group-hover:scale-105'),
                        )}>
                          <item.icon className={cn('h-3.5 w-3.5 transition-transform', active ? 'text-white scale-110' : item.iconColor)} />
                        </div>
                        {isExpanded && (
                          <span className={cn('text-sm truncate', active ? 'font-semibold' : 'font-medium text-foreground/80')}>
                            {item.label}
                          </span>
                        )}
                      </div>
                    </Link>
                  </TooltipTrigger>
                  {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">{item.label}</TooltipContent>}
                </Tooltip>
              );
            })}
          </div>

          <div className="shrink-0 border-t border-border/40 p-2 space-y-0.5">
            {can('Create', 'Loan') && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/loan/new">
                    <div className={cn(
                      'relative flex cursor-pointer items-center rounded-lg transition-all duration-200 group hover:bg-muted/40',
                      isExpanded ? 'px-2 py-1.5 gap-2.5' : 'p-1.5 justify-center',
                    )}>
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 group-hover:scale-105 transition-all">
                        <Plus className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                      {isExpanded && <span className="text-sm font-medium text-foreground/80 truncate">New Loan</span>}
                    </div>
                  </Link>
                </TooltipTrigger>
                {!isExpanded && <TooltipContent side="right" className="text-xs font-medium">New Loan</TooltipContent>}
              </Tooltip>
            )}
            <button
              className={cn('w-full flex items-center rounded-lg px-2 py-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-200 text-sm gap-2', !isExpanded && 'justify-center')}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <><ChevronLeft className="h-4 w-4 shrink-0" /><span>Collapse</span></> : <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        </TooltipProvider>
      </aside>

      <div className={cn('flex-1 flex flex-col min-h-screen transition-all duration-300', isExpanded ? 'ml-56' : 'ml-14')}>
        <main className="flex-grow p-4 sm:p-6">{children}</main>
        <footer className="shrink-0 flex items-center text-muted-foreground text-xs py-3 px-6 border-t border-border/40">
          <span>Copyright © 2025 SEL. All Rights Reserved.</span>
        </footer>
      </div>
    </div>
  );
}
